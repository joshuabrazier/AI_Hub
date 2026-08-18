import { afterAll, describe, expect, it } from "vitest";

import {
  attachmentStorageKey,
  deleteAttachment,
  deleteAttachmentsForSubject,
  getAttachment,
  isAttachmentStorageConfigured,
  listAllAttachmentKeys,
  putAttachment,
} from "./attachment-storage";

// -------------------------------------------------------------------
// A real round trip against real blob storage.
//
// Runs against whatever AZURE_STORAGE_CONNECTION_STRING points at, which
// locally is Azurite (`pnpm dev:storage`). Skipped when nothing is
// configured, so a checkout with no storage - and CI, which has no .env -
// still passes rather than failing on an absent dependency.
//
// It asserts the two behaviours the delete paths depend on and which are
// easy to get quietly wrong: that a prefix delete removes a whole
// conversation, and that a missing blob reads as null rather than throwing.
// Both are what stops an orphaned file being paid for forever, and neither
// is provable by inspection.
// -------------------------------------------------------------------
const describeStorage = isAttachmentStorageConfigured() ? describe : describe.skip;

// Namespaced so a failed run cannot collide with a later one, and so the
// cleanup below can never touch a real conversation.
const SUBJECT_A = `test-subject-a-${process.pid}`;
const SUBJECT_B = `test-subject-b-${process.pid}`;

describeStorage("attachment storage", () => {
  afterAll(async () => {
    if (!isAttachmentStorageConfigured()) return;

    await deleteAttachmentsForSubject(SUBJECT_A);
    await deleteAttachmentsForSubject(SUBJECT_B);
  });

  it("stores a file and reads back exactly the same bytes", async () => {
    const key = attachmentStorageKey(SUBJECT_A, "round-trip");
    // Deliberately binary, including a NUL and a high byte: a path that
    // stringified anywhere would corrupt this and pass a text-only test.
    const bytes = Buffer.from([0x89, 0x50, 0x00, 0xff, 0x0d, 0x0a, 0x41]);

    await putAttachment(key, bytes, "image/png");

    const read = await getAttachment(key);

    expect(read).not.toBeNull();
    expect(read!.equals(bytes)).toBe(true);
  });

  it("reads a missing blob as null rather than throwing", async () => {
    // The download route and the send path both rely on this: a row can
    // outlive its blob, and neither should turn that into a 500.
    const missing = await getAttachment(attachmentStorageKey(SUBJECT_A, "never-written"));

    expect(missing).toBeNull();
  });

  it("deletes one file without touching its neighbours", async () => {
    const doomed = attachmentStorageKey(SUBJECT_A, "doomed");
    const survivor = attachmentStorageKey(SUBJECT_A, "survivor");

    await putAttachment(doomed, Buffer.from("a"), "text/plain");
    await putAttachment(survivor, Buffer.from("b"), "text/plain");

    await deleteAttachment(doomed);

    expect(await getAttachment(doomed)).toBeNull();
    expect(await getAttachment(survivor)).not.toBeNull();
  });

  it("deleting a blob that is already gone is not an error", async () => {
    // Idempotent by design: the retention job and the remove path can both
    // reach the same key, and a second attempt must not fail the run.
    await expect(deleteAttachment(attachmentStorageKey(SUBJECT_A, "absent"))).resolves.toBeUndefined();
  });

  it("removes a whole conversation by prefix, and only that conversation", async () => {
    // This is the behaviour every delete path depends on. Once the rows are
    // gone nothing knows which files belonged to a thread, so the prefix is
    // the only handle left - and if it over-reached it would destroy
    // somebody else's files instead.
    await putAttachment(attachmentStorageKey(SUBJECT_B, "one"), Buffer.from("1"), "text/plain");
    await putAttachment(attachmentStorageKey(SUBJECT_B, "two"), Buffer.from("2"), "text/plain");

    const keptElsewhere = attachmentStorageKey(SUBJECT_A, "unrelated");
    await putAttachment(keptElsewhere, Buffer.from("3"), "text/plain");

    const removed = await deleteAttachmentsForSubject(SUBJECT_B);

    expect(removed).toBe(2);
    expect(await getAttachment(attachmentStorageKey(SUBJECT_B, "one"))).toBeNull();
    expect(await getAttachment(keptElsewhere)).not.toBeNull();
  });

  it("lists keys for the reconciliation sweep", async () => {
    // The sweep diffs this against the database, so a key that is present
    // must appear here or a live file would be deleted as an orphan.
    const key = attachmentStorageKey(SUBJECT_A, "listed");
    await putAttachment(key, Buffer.from("x"), "text/plain");

    const keys = await listAllAttachmentKeys();

    expect(keys).toContain(key);
    expect(keys.every((entry) => entry.startsWith("ai-chat/"))).toBe(true);
  });
});
