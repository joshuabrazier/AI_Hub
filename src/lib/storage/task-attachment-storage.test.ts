import { afterAll, describe, expect, it } from "vitest";

import {
  deleteTaskAttachmentBlob,
  deleteTaskAttachmentBlobsForProject,
  deleteTaskAttachmentBlobsForTask,
  isTaskAttachmentStorageConfigured,
  listAllTaskAttachmentKeys,
  openTaskAttachmentStream,
  putTaskAttachment,
  taskAttachmentStorageKey,
} from "./task-attachment-storage";

// -------------------------------------------------------------------
// The key shape, and a real round trip against real blob storage.
//
// The shape is asserted WITHOUT storage, because it is the part the whole
// design rests on and it has to be checked in CI: the project segment is
// what makes a per-project prefix delete possible, the task segment is what
// a phase delete needs, and the `delivery/` prefix is what stops the chat
// sweep collecting these files as orphans and the delivery sweep collecting
// chat's.
//
// The round trip runs against whatever AZURE_STORAGE_CONNECTION_STRING
// points at, which locally is Azurite (`pnpm dev:storage`). Skipped when
// nothing is configured, so a checkout with no storage - and CI, which has
// no .env - still passes rather than failing on an absent dependency.
// -------------------------------------------------------------------

// Namespaced so a failed run cannot collide with a later one, and so the
// prefix deletes below can never reach a real project.
const PROJECT_A = `test-project-a-${process.pid}`;
const PROJECT_B = `test-project-b-${process.pid}`;

describe("task attachment storage keys", () => {
  it("namespaces a file under the delivery prefix, then the project, then the task", () => {
    expect(taskAttachmentStorageKey("proj", "task", "file")).toBe("delivery/proj/task/file");
  });

  it("keeps delivery files out of the prefixes the other two sweeps list", () => {
    // Both of those sweeps DELETE what their tables do not claim, so an
    // overlap here would not be untidy, it would be destructive.
    const key = taskAttachmentStorageKey("proj", "task", "file");

    expect(key.startsWith("delivery/")).toBe(true);
    expect(key.startsWith("ai-chat/")).toBe(false);
    expect(key.startsWith("transcription/")).toBe(false);
  });
});

const describeStorage = isTaskAttachmentStorageConfigured() ? describe : describe.skip;

async function readAll(key: string): Promise<Buffer | null> {
  const opened = await openTaskAttachmentStream(key);

  if (!opened) return null;

  const chunks: Buffer[] = [];

  for await (const chunk of opened.stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }

  return Buffer.concat(chunks);
}

describeStorage("task attachment storage", () => {
  afterAll(async () => {
    if (!isTaskAttachmentStorageConfigured()) return;

    await deleteTaskAttachmentBlobsForProject(PROJECT_A);
    await deleteTaskAttachmentBlobsForProject(PROJECT_B);
  });

  it("stores a file and streams back exactly the same bytes", async () => {
    const key = taskAttachmentStorageKey(PROJECT_A, "task-round-trip", "file");
    // Deliberately binary, including a NUL and a high byte: a path that
    // stringified anywhere would corrupt this and pass a text-only test.
    const bytes = Buffer.from([0x25, 0x50, 0x00, 0xff, 0x0d, 0x0a, 0x41]);

    await putTaskAttachment(key, bytes, "application/pdf");

    const read = await readAll(key);

    expect(read).not.toBeNull();
    expect(read!.equals(bytes)).toBe(true);
  });

  it("opens a missing blob as null rather than throwing", async () => {
    // The download route relies on this: a row can outlive its file after a
    // partial delete, and that has to be a 404 rather than a 500.
    const missing = await openTaskAttachmentStream(
      taskAttachmentStorageKey(PROJECT_A, "task-round-trip", "never-written"),
    );

    expect(missing).toBeNull();
  });

  it("deletes one file without touching its neighbours", async () => {
    const doomed = taskAttachmentStorageKey(PROJECT_A, "task-one", "doomed");
    const survivor = taskAttachmentStorageKey(PROJECT_A, "task-one", "survivor");

    await putTaskAttachment(doomed, Buffer.from("a"), "text/plain");
    await putTaskAttachment(survivor, Buffer.from("b"), "text/plain");

    await deleteTaskAttachmentBlob(doomed);

    expect(await openTaskAttachmentStream(doomed)).toBeNull();
    expect(await openTaskAttachmentStream(survivor)).not.toBeNull();
  });

  it("deleting a blob that is already gone is not an error", async () => {
    // Idempotent by design: the remove path and the reconciliation sweep can
    // both reach the same key, and a second attempt must not fail the run.
    await expect(
      deleteTaskAttachmentBlob(taskAttachmentStorageKey(PROJECT_A, "task-one", "absent")),
    ).resolves.toBeUndefined();
  });

  it("removes one task's files by prefix, and only that task's", async () => {
    // What a phase delete depends on. It holds task ids and never sees an
    // attachment, so the prefix is the only handle - and if it over-reached
    // it would take another card's files with it.
    await putTaskAttachment(taskAttachmentStorageKey(PROJECT_A, "task-doomed", "one"), Buffer.from("1"), "text/plain");
    await putTaskAttachment(taskAttachmentStorageKey(PROJECT_A, "task-doomed", "two"), Buffer.from("2"), "text/plain");

    const neighbour = taskAttachmentStorageKey(PROJECT_A, "task-kept", "one");
    await putTaskAttachment(neighbour, Buffer.from("3"), "text/plain");

    const removed = await deleteTaskAttachmentBlobsForTask(PROJECT_A, "task-doomed");

    expect(removed).toBe(2);
    expect(await openTaskAttachmentStream(taskAttachmentStorageKey(PROJECT_A, "task-doomed", "one"))).toBeNull();
    expect(await openTaskAttachmentStream(neighbour)).not.toBeNull();
  });

  it("removes one project's files by prefix, and only that project's", async () => {
    await putTaskAttachment(taskAttachmentStorageKey(PROJECT_B, "task-x", "one"), Buffer.from("1"), "text/plain");
    await putTaskAttachment(taskAttachmentStorageKey(PROJECT_B, "task-y", "one"), Buffer.from("2"), "text/plain");

    const otherProject = taskAttachmentStorageKey(PROJECT_A, "task-kept", "two");
    await putTaskAttachment(otherProject, Buffer.from("3"), "text/plain");

    const removed = await deleteTaskAttachmentBlobsForProject(PROJECT_B);

    expect(removed).toBe(2);
    expect(await openTaskAttachmentStream(taskAttachmentStorageKey(PROJECT_B, "task-x", "one"))).toBeNull();
    expect(await openTaskAttachmentStream(otherProject)).not.toBeNull();
  });

  it("lists delivery keys for the reconciliation sweep, and nothing else", async () => {
    // The sweep deletes whatever this returns and no row claims, so a live
    // key missing from it would be destroyed, and a chat key appearing in it
    // would be destroyed too.
    const key = taskAttachmentStorageKey(PROJECT_A, "task-listed", "file");
    await putTaskAttachment(key, Buffer.from("x"), "text/plain");

    const keys = await listAllTaskAttachmentKeys();

    expect(keys).toContain(key);
    expect(keys.every((entry) => entry.startsWith("delivery/"))).toBe(true);
  });
});
