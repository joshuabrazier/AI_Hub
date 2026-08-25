import { afterAll, describe, expect, it } from "vitest";

import {
  createUploadUrl,
  deleteMedia,
  getMediaInfo,
  isMediaStorageConfigured,
  listAllMediaKeys,
  mediaBlobUrl,
  mediaStorageKey,
} from "./media-storage";

// -------------------------------------------------------------------
// A real round trip against real blob storage, THROUGH THE SIGNED URL.
//
// Runs against whatever AZURE_STORAGE_CONNECTION_STRING points at, which
// locally is Azurite (`pnpm dev:storage`). Skipped when nothing is
// configured, so a checkout with no storage - and CI, which has no .env -
// still passes rather than failing on an absent dependency.
//
// WHY IT UPLOADS RATHER THAN CALLING putBlob. The upload is the one part
// of this feature the app never performs: the browser does it, with a
// credential the app hands out and then has no further involvement in. So
// a test that wrote the blob with the account key would exercise
// everything except the thing that can actually be wrong.
//
// It has already earned its place. The SAS was pinned to `protocol: https`,
// which is correct for Azure and rejected outright by the emulator's plain
// HTTP endpoint - a 403 that surfaced in the browser as "something went
// wrong" and appeared nowhere in the server logs at all.
// -------------------------------------------------------------------
const describeStorage = isMediaStorageConfigured() ? describe : describe.skip;

// Namespaced so a failed run cannot collide with a later one, and so the
// cleanup below can never touch a real recording.
const testUserId = `test-user-${Date.now()}`;

const keysToClean: string[] = [];

function testKey(transcriptionId: string): string {
  const key = mediaStorageKey(testUserId, transcriptionId);
  keysToClean.push(key);

  return key;
}

// The content is arbitrary - nothing in this path decodes it. Azure Speech
// would reject this as audio, which is exactly why the format warning
// exists in the UI, but storage does not care and neither does this test.
const mediaBody = "pretend this is a webm recording";
const mediaByteSize = Buffer.byteLength(mediaBody);

async function putThroughSas(url: string): Promise<Response> {
  return fetch(url, {
    method: "PUT",
    headers: {
      // Required on every block blob PUT. Azure rejects the request without
      // it, which is why the browser sends it too.
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": "video/webm",
    },
    body: mediaBody,
  });
}

describeStorage("media storage", () => {
  afterAll(async () => {
    for (const key of keysToClean) {
      await deleteMedia(key);
    }
  });

  it("issues an upload URL the browser can actually PUT to", async () => {
    // The whole point. A SAS that the endpoint refuses is indistinguishable
    // from a broken feature, and the failure appears only in the browser.
    const key = testKey("upload-round-trip");

    const response = await putThroughSas(await createUploadUrl(key));

    expect(response.status).toBe(201);

    const info = await getMediaInfo(key);

    expect(info.exists).toBe(true);
    expect(info.byteSize).toBe(mediaByteSize);
  });

  it("issues a WRITE-ONLY URL, so a leaked one cannot read anything back", async () => {
    // The credential handed to the browser is `cw`. If it ever gains read
    // permission, a URL copied out of the network tab becomes a way to
    // fetch somebody's meeting recording.
    const key = testKey("write-only");

    await putThroughSas(await createUploadUrl(key));

    const read = await fetch(await createUploadUrl(key));

    expect(read.ok).toBe(false);
  });

  it("hands the Speech service a plain URL with no token on it", async () => {
    // Azure Speech reads the blob with its own managed identity, so this
    // URL carries no authority of its own and is useless to anybody else.
    // A query string here would mean a credential was being handed out.
    const url = await mediaBlobUrl(mediaStorageKey(testUserId, "plain-url"));

    expect(url).not.toContain("?");
    expect(url).toContain("plain-url");
  });

  it("reports a recording that never arrived, rather than throwing", async () => {
    // The upload never touches the app, so asking storage is the only way
    // to know it finished. This is the answer that becomes "the recording
    // did not finish uploading" instead of an unhandled error.
    const info = await getMediaInfo(mediaStorageKey(testUserId, "never-uploaded"));

    expect(info.exists).toBe(false);
    expect(info.byteSize).toBeNull();
  });

  it("deletes a recording, and deleting it twice is not an error", async () => {
    // Idempotent by design: a successful transcription clears the media,
    // and the retention sweep can reach the same key afterwards.
    const key = testKey("delete-twice");

    await putThroughSas(await createUploadUrl(key));

    await deleteMedia(key);
    await deleteMedia(key);

    expect((await getMediaInfo(key)).exists).toBe(false);
  });

  it("lists keys for the reconciliation sweep", async () => {
    // The sweep diffs this against the database, so a key that is present
    // must appear here or a live recording would be deleted as an orphan.
    const key = testKey("reconciliation");

    await putThroughSas(await createUploadUrl(key));

    expect(await listAllMediaKeys()).toContain(key);
  });
});
