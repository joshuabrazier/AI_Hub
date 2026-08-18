import "server-only";

import { BlobServiceClient, type ContainerClient, RestError } from "@azure/storage-blob";

import { envServer } from "@/lib/env-server";

// -------------------------------------------------------------------
// Attachment storage - Azure Blob.
//
// WHY THE BYTES ARE NOT IN POSTGRES
//
// They were, originally, and for light usage that was the right trade: one
// backup, one restore, one retention policy, and a delete that could not
// orphan anything. Two facts moved it:
//
//   1. Real usage is roughly a file per user per day against a 365-day
//      retention window, so steady state is ~365 files per person. At a few
//      hundred users that is hundreds of GB - and Azure Database for
//      PostgreSQL storage CANNOT BE SHRUNK, so a spike becomes a permanent
//      bill even after retention has deleted the files.
//   2. More importantly it is a traffic pattern, not just a volume. Serving
//      a 4.5 MB file out of BYTEA holds a Postgres connection open for the
//      whole transfer, competing with auth and page queries on a single
//      instance's pool. That failure mode disappears entirely here.
//
// WHAT THIS COSTS US, AND HOW IT IS PAID
//
// Postgres cascades no longer reach the file. Deleting a user, a
// conversation or a message removes the ROW and would silently leave the
// blob behind, paid for forever - the exact failure the original design
// avoided. So every delete path calls in here FIRST, and the monthly job
// runs a reconciliation sweep as a backstop. Neither is optional; see
// ai-chat-retention.service.ts.
//
// The bytes never reach the browser directly. There are no SAS URLs and no
// public container: the download route authorizes the request and streams
// the blob through itself, so the only way to read a file remains a live
// session that owns it. That keeps revocation instant, and means no signed
// URL can outlive the check that produced it.
// -------------------------------------------------------------------

// One blob per attachment, namespaced by conversation so a whole thread's
// files can be listed and removed with a prefix query rather than a row
// lookup - which is what makes the delete paths below cheap, and the orphan
// sweep possible at all.
export function attachmentStorageKey(subjectId: string, attachmentId: string): string {
  return `ai-chat/${subjectId}/${attachmentId}`;
}

export function isAttachmentStorageConfigured(): boolean {
  return Boolean(envServer.AZURE_STORAGE_CONNECTION_STRING);
}

let cachedContainer: ContainerClient | null = null;

// -------------------------------------------------------------------
// The container client, created once.
//
// `createIfNotExists` with no access argument makes a PRIVATE container -
// anonymous read must never be enabled on it, because the access check that
// protects these files lives in the download route, and a public container
// would route around it entirely.
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
// The content type written here is the SERVER-DERIVED one, from sniffing
// the bytes - never what the browser claimed. It is metadata only: the
// download route sets its own headers and does not trust this value either,
// so a blob whose type was somehow wrong still cannot be served as markup.
// -------------------------------------------------------------------
export async function putAttachment(key: string, bytes: Buffer, mediaType: string): Promise<void> {
  const container = await getContainer();

  await container.getBlockBlobClient(key).uploadData(bytes, {
    blobHTTPHeaders: {
      blobContentType: mediaType,
      blobCacheControl: "private, no-store",
    },
  });
}

// -------------------------------------------------------------------
// Read one file back, whole.
//
// Buffered rather than streamed on purpose. Every caller needs the complete
// bytes anyway - Converse takes file content inline, and the download route
// sets a Content-Length - and each one is capped at 4.5 MB by the API
// contract, so there is no request here that streaming would make safer.
// -------------------------------------------------------------------
export async function getAttachment(key: string): Promise<Buffer | null> {
  const container = await getContainer();

  try {
    return await container.getBlockBlobClient(key).downloadToBuffer();
  } catch (error) {
    // A missing blob is a real state, not a fault: retention or a partial
    // delete can leave a row pointing at nothing. Callers decide what to do
    // about that rather than having an exception thrown through them.
    if (error instanceof RestError && error.statusCode === 404) return null;

    throw error;
  }
}

// -------------------------------------------------------------------
// Remove one file. Idempotent - deleting a blob that is already gone is a
// success, because the desired end state is the same either way.
// -------------------------------------------------------------------
export async function deleteAttachment(key: string): Promise<void> {
  const container = await getContainer();

  await container.getBlockBlobClient(key).deleteIfExists();
}

// -------------------------------------------------------------------
// Remove every file belonging to one conversation.
//
// Called BEFORE the rows go, on every path that deletes a conversation -
// including retention. The prefix is why the key format above is worth
// having: without it, this would need the very rows it is about to lose.
//
// Returns how many blobs went, for the job log.
// -------------------------------------------------------------------
export async function deleteAttachmentsForSubject(subjectId: string): Promise<number> {
  const container = await getContainer();

  let deleted = 0;

  for await (const blob of container.listBlobsFlat({ prefix: `ai-chat/${subjectId}/` })) {
    await container.getBlockBlobClient(blob.name).deleteIfExists();
    deleted += 1;
  }

  return deleted;
}

// -------------------------------------------------------------------
// Reconciliation: every blob key the container currently holds.
//
// The backstop for the one thing this design cannot get for free. A
// Postgres cascade removes attachment rows without telling anybody, so a
// user removed by the de-identification sweep takes their rows with them
// and would leave the files behind. The monthly job compares this list
// against the storage keys still in the database and removes whatever no
// row claims.
//
// Returned as a list rather than streamed to a callback because the caller
// needs it as a set to diff against. Bounded by retention, so at a file per
// user per day this is a few hundred thousand strings at worst, once a
// month.
// -------------------------------------------------------------------
export async function listAllAttachmentKeys(): Promise<string[]> {
  const container = await getContainer();

  const keys: string[] = [];

  for await (const blob of container.listBlobsFlat({ prefix: "ai-chat/" })) {
    keys.push(blob.name);
  }

  return keys;
}
