import "server-only";

import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";

import { envServer } from "@/lib/env-server";

// -------------------------------------------------------------------
// Task attachment storage - Azure Blob.
//
// The files people hang off a card: a scope document, a signed variation, a
// screenshot of the thing that is broken. `task_attachments` holds the
// metadata and a `storage_key`; the bytes are here.
//
// WHY THIS IS NOT attachment-storage.ts
//
// That module is CHAT's. Its key builder and its reconciliation listing are
// both hard-coded to the `ai-chat/` prefix, and that listing is the input to
// a sweep that DELETES anything the chat tables do not claim. Reusing it
// would mean either the chat sweep collecting every delivery file as an
// orphan, or the two features sharing a namespace and each having to know
// about the other's rows. Both are worse than a second small module.
//
// Same container, different prefix. The container is deliberately shared
// with chat (`AZURE_STORAGE_ATTACHMENT_CONTAINER`), because a separate one
// buys no isolation that the prefix does not already give - both sweeps
// list by prefix and neither can see the other's keys - and would cost a
// new environment variable to set on every deployment plus a second
// container to remember when access is reviewed. `deleteAttachment` over
// there IS key-agnostic and does the same job as the delete here; the
// duplication is one line, and the alternative was chat exporting a
// primitive that any feature could point at any prefix.
//
// THE SHARP EDGE: A POSTGRES CASCADE CANNOT DELETE AN AZURE BLOB.
//
// `task_attachments.task_id` is ON DELETE CASCADE, so the rows go quietly
// and the files stay, paid for forever, with nothing left that knows they
// exist. The chain is longer than it looks:
//
//   - deleting a TASK takes its attachment rows;
//   - deleting a PHASE takes the phase's tasks and therefore their rows,
//     and `deletePhaseRepo` never sees an attachment at all;
//   - archiving a PROJECT takes nothing, because archiving is a status
//     change and the files must survive it;
//   - deleting a CLIENT is refused for other reasons (projects reference it
//     ON DELETE RESTRICT), so it is not a path that can orphan anything
//     today - and if that is ever relaxed, this is the module it has to
//     come through first.
//
// So the rule is the one chat and transcription already live by: EVERY
// DELETE PATH CLEARS STORAGE FIRST, and a monthly reconciliation pass
// collects whatever a cascade removed behind its back, exactly as
// `aiChatOrphanedBlobsPurged` and `transcriptionOrphanedMediaPurged` do. If
// that count is steadily non-zero, a delete path is missing its cleanup -
// it is a signal, not a garbage collector to lean on.
//
// (One documented inversion: `deleteTaskReturningBlobKeysRepo` deletes the
// rows first and hands the keys back, because that delete CAN be refused by
// `time_entries` ON DELETE RESTRICT and clearing the bytes out from under a
// task that then survives has no way back. It is the recoverable failure,
// and the sweep is its backstop.)
//
// NOTHING HERE VALIDATES THE FILE. This module writes bytes and reads them
// back; it does not decide whether the bytes are acceptable. That is the
// upload path's job, and it MUST derive the media type by SNIFFING THE
// BYTES rather than trusting the filename or the browser's Content-Type -
// the way src/lib/ai/attachment-formats.ts does. A type taken from the
// client and then served back from this origin is stored XSS, decided in
// the wrong file.
//
// The bytes never reach the browser directly. No SAS URLs, no public
// container: the download route authorises the request and streams the blob
// through itself, so the only way to read a file stays a live session with
// access to the project. A signed read URL would be a bearer token for a
// client's contract that outlives the check which produced it.
// -------------------------------------------------------------------

// The one prefix this module owns. Everything below is under it, which is
// what keeps the reconciliation sweep from ever looking at chat's files.
const DELIVERY_PREFIX = "delivery/";

// -------------------------------------------------------------------
// One blob per attachment, namespaced by PROJECT and then TASK.
//
// WHAT IT IS KEYED ON, AND WHY.
//
// Chat keys on the CONVERSATION so a whole thread's files can be removed
// with a prefix query rather than from the rows that are about to be lost.
// Transcription keys on the OWNER, because a recording belongs to one person
// and de-identifying them has to be able to clear their files after the rows
// that named them have already gone.
//
// Neither answer transfers. A task attachment is part of the PROJECT's
// record of work, not of the uploader's: `uploaded_by` is ON DELETE SET
// NULL, so de-identifying somebody deliberately leaves the file in place
// with the row that points at it. Keying on the user would promise a
// per-person purge that must never run - it would take a client's signed
// variation with the contractor who uploaded it.
//
// So the prefix mirrors the ownership chain that actually cascades:
// project -> task -> attachment. Each level is the handle one delete path
// needs. A project's files clear with one prefix; a task's clear with one
// prefix, which is what a phase delete needs, since it holds task ids and
// no attachment ever reaches it.
//
// THE PHASE IS DELIBERATELY ABSENT even though it sits between the two. A
// card is dragged between phases all day (`moveTaskRepo` rewrites
// `phase_id`), and a key is written once and then stored - so a phase in
// the path would be a lie after the first move, and a prefix delete for a
// phase would miss exactly the files that had been moved into it. Every
// segment here is immutable: `tasks.project_id` never changes, which the
// tasks repository states as a contract, and the ids are generated.
//
// DERIVED, NEVER ACCEPTED FROM A CALLER. A service that took a
// `storageKey` from its caller would let a row on one task point at any
// blob in the container, including another client's project, while the
// download route authorised on the task. Building the key from ids the
// caller has already been authorised for means a row can only ever address
// its own task's prefix.
// -------------------------------------------------------------------
export function taskAttachmentStorageKey(
  projectId: string,
  taskId: string,
  attachmentId: string,
): string {
  return `${DELIVERY_PREFIX}${projectId}/${taskId}/${attachmentId}`;
}

export function isTaskAttachmentStorageConfigured(): boolean {
  return Boolean(envServer.AZURE_STORAGE_CONNECTION_STRING);
}

let cachedContainer: ContainerClient | null = null;

// -------------------------------------------------------------------
// The container client, created once.
//
// `createIfNotExists` with no access argument makes a PRIVATE container.
// Anonymous read must never be enabled on it: the check that decides who
// may read a project's files lives in the service, and a public container
// routes around it entirely.
// -------------------------------------------------------------------
async function getContainer(): Promise<ContainerClient> {
  if (cachedContainer) return cachedContainer;

  const connectionString = envServer.AZURE_STORAGE_CONNECTION_STRING;

  if (!connectionString) {
    throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set");
  }

  const container = BlobServiceClient.fromConnectionString(connectionString).getContainerClient(
    envServer.AZURE_STORAGE_ATTACHMENT_CONTAINER,
  );

  await container.createIfNotExists();

  cachedContainer = container;

  return container;
}

// -------------------------------------------------------------------
// Store one file.
//
// `mediaType` must be the SERVER-DERIVED type, from sniffing the bytes -
// never what the browser claimed. It is metadata only: the download route
// sets its own headers with `nosniff` and does not trust this value either,
// so a blob whose type was somehow wrong still cannot be served as markup.
//
// `no-store` because these are private files behind a session check, and a
// cached copy in a shared proxy is a copy the revoked session still reaches.
// -------------------------------------------------------------------
export async function putTaskAttachment(key: string, bytes: Buffer, mediaType: string): Promise<void> {
  const container = await getContainer();

  await container.getBlockBlobClient(key).uploadData(bytes, {
    blobHTTPHeaders: {
      blobContentType: mediaType,
      blobCacheControl: "private, no-store",
    },
  });
}

// -------------------------------------------------------------------
// Open one file for reading, as a STREAM.
//
// Streamed rather than buffered into a Buffer, which is the transcription
// media choice rather than chat's. Chat buffers because Converse takes file
// content inline and the API contract caps a chat attachment at 4.5 MB, so
// there is nothing there that streaming would make safer. A delivery
// attachment has no such ceiling - the thing somebody wants on a card is a
// scope document, a screen recording, a whole design pack - and reading one
// of those into memory to hand to a Response would hold it in the
// instance's memory for the length of the transfer, with two concurrent
// downloads enough to take the process down.
//
// Null when the blob is gone, which is a real state rather than a fault: a
// row can outlive its file after a partial delete, and the download route
// should answer a 404 rather than a 500.
// -------------------------------------------------------------------
export async function openTaskAttachmentStream(key: string): Promise<{
  stream: NodeJS.ReadableStream;
  byteSize: number | null;
  mediaType: string | null;
} | null> {
  const container = await getContainer();
  const blob = container.getBlockBlobClient(key);

  if (!(await blob.exists())) return null;

  const download = await blob.download();

  if (!download.readableStreamBody) return null;

  return {
    stream: download.readableStreamBody,
    byteSize: download.contentLength ?? null,
    mediaType: download.contentType ?? null,
  };
}

// -------------------------------------------------------------------
// Remove one file. Idempotent - a blob that is already gone is a success,
// because the desired end state is the same either way, and both the remove
// path and the reconciliation sweep can reach the same key.
// -------------------------------------------------------------------
export async function deleteTaskAttachmentBlob(key: string): Promise<void> {
  const container = await getContainer();

  await container.getBlockBlobClient(key).deleteIfExists();
}

// -------------------------------------------------------------------
// Delete everything under a prefix.
//
// PRIVATE, and only ever reached through the two named wrappers below.
// Exporting it would put a string in a caller's hands whose empty value
// empties the container and whose value `delivery/` empties the module -
// a one-character bug with no undo. The wrappers take ids, so the widest
// thing any caller can ask for is one project.
//
// Returns how many blobs went, for the job log.
// -------------------------------------------------------------------
async function deleteBlobsUnderPrefix(prefix: string): Promise<number> {
  const container = await getContainer();

  let deleted = 0;

  for await (const blob of container.listBlobsFlat({ prefix })) {
    await container.getBlockBlobClient(blob.name).deleteIfExists();
    deleted += 1;
  }

  return deleted;
}

// -------------------------------------------------------------------
// Remove every file belonging to one task.
//
// This is what a PHASE delete needs. `deletePhaseRepo` cascades to the
// phase's tasks and therefore to their attachment rows without an
// attachment being mentioned anywhere in it, so the caller has to hold the
// task ids and clear each one's prefix BEFORE the phase goes. Once the rows
// are gone nothing knows which files belonged to what, and the prefix is
// the only handle left - which is the whole reason the key is shaped the
// way it is.
// -------------------------------------------------------------------
export async function deleteTaskAttachmentBlobsForTask(projectId: string, taskId: string): Promise<number> {
  return deleteBlobsUnderPrefix(`${DELIVERY_PREFIX}${projectId}/${taskId}/`);
}

// -------------------------------------------------------------------
// Remove every file belonging to one project.
//
// Nothing calls this yet, and that is correct: archiving a project is the
// module's soft delete and must NOT touch the files, while a client cannot
// be removed while a project references it. It exists because the prefix is
// free to have and a hard project delete added later without it would
// orphan every file the project ever held in a single statement - the exact
// failure this module is written to prevent, at its largest possible size.
// -------------------------------------------------------------------
export async function deleteTaskAttachmentBlobsForProject(projectId: string): Promise<number> {
  return deleteBlobsUnderPrefix(`${DELIVERY_PREFIX}${projectId}/`);
}

// -------------------------------------------------------------------
// Reconciliation: every delivery blob key the container currently holds.
//
// The other half of `getAllTaskAttachmentKeysRepo`, which reads every
// `storage_key` the database still claims. Anything here that no row claims
// is orphaned and can go. It is the ONLY thing that catches a file lost to
// a cascade nobody wrote code for - a phase delete taking its tasks with
// it, or a crash between a committed row delete and the storage clear that
// was meant to follow it.
//
// Scoped to `delivery/` and that is load-bearing: the sweep DELETES what it
// does not recognise, so an unprefixed listing would hand chat's and
// transcription's files to a diff against `task_attachments` and destroy
// every one of them.
//
// Returned as a list rather than streamed to a callback because the caller
// needs it as a set to diff against, once a month. Bounded by how many
// files a delivery team actually attaches to cards, which is orders of
// magnitude below chat's file-per-user-per-day.
// -------------------------------------------------------------------
export async function listAllTaskAttachmentKeys(): Promise<string[]> {
  const container = await getContainer();

  const keys: string[] = [];

  for await (const blob of container.listBlobsFlat({ prefix: DELIVERY_PREFIX })) {
    keys.push(blob.name);
  }

  return keys;
}

// -------------------------------------------------------------------
// ===================================================================
// WHAT IS OWED, AND IS NOT IN THIS FILE
// ===================================================================
//
// Written down rather than half-done, because each of these lives in a file
// this change does not own.
//
//   1. THE RECONCILIATION SWEEP ITSELF. `listAllTaskAttachmentKeys` above
//      and `getAllTaskAttachmentKeysRepo` are the two halves; the pass that
//      diffs them belongs in the monthly retention job alongside the chat
//      and transcription ones, reporting a
//      `deliveryOrphanedAttachmentsPurged` count next to
//      `aiChatOrphanedBlobsPurged`. Until it is wired up, a file orphaned
//      by a phase delete is paid for indefinitely and nothing says so.
//
//   2. THE KEY BUILDER MOVING HERE. `delivery-board.service.ts` carries its
//      own `taskAttachmentStorageKey(taskId, attachmentId)` on the
//      `delivery/tasks/...` shape, written before this module existed and
//      annotated as belonging in it. It should import this one and delete
//      its copy - the project segment is what makes a per-project prefix
//      delete possible, and two builders disagreeing about the shape would
//      leave the sweep unable to recognise its own files. Nothing has been
//      uploaded yet (there is no upload route), so there is no data to
//      migrate, and doing it before there is is the cheap moment.
//
//   3. THE PHASE DELETE CLEARING BLOBS. `deletePhaseRepo` cascades to tasks
//      and their attachment rows and clears nothing.
//      `deleteTaskAttachmentBlobsForTask` is what it needs, per task id,
//      before the phase goes.
// -------------------------------------------------------------------
