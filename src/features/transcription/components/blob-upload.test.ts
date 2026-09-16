import { describe, expect, it } from "vitest";

import { blockIdFor, isWorthRetrying, UploadRequestError } from "./blob-upload";

// -------------------------------------------------------------------
// The two rules in the uploader that fail QUIETLY and expensively.
//
// Block ids that differ in length are refused by Azure at the commit - that
// is, after the whole file has already been sent, and only ever on files
// needing more than ten blocks. Which is to say: never in testing, and
// always on somebody's three hour workshop.
//
// And a retry decision that is wrong in the generous direction turns one
// clear refusal into three slow identical ones, while a retry decision that
// is wrong in the strict direction loses a meeting to a dropped connection.
// -------------------------------------------------------------------

describe("blockIdFor", () => {
  it("gives every id the same length, which is what Azure requires", () => {
    // The failure this prevents: base64 of "9" and of "10" differ in
    // length, so an upload works up to ten blocks and is refused at the
    // eleventh - 88 MB in, at the very end of the transfer.
    const lengths = new Set([0, 1, 9, 10, 99, 100, 999, 1000, 99_999].map((i) => blockIdFor(i).length));

    expect(lengths.size).toBe(1);
  });

  it("gives every block a different id", () => {
    const ids = new Set(Array.from({ length: 200 }, (_, index) => blockIdFor(index)));

    expect(ids.size).toBe(200);
  });

  it("holds well past the number of blocks either service allows", () => {
    // 50,000 blocks is Azure's cap and 1 GiB is the Speech service's, so
    // six digits is far more headroom than either can use.
    expect(blockIdFor(999_999).length).toBe(blockIdFor(0).length);
  });
});

describe("isWorthRetrying", () => {
  it("retries a request that got no answer at all", () => {
    // A dropped connection, a blocked cross-origin request, or the idle
    // watchdog giving up. The case the retry exists for.
    expect(isWorthRetrying(new UploadRequestError("dropped", 0))).toBe(true);
  });

  it("retries throttling and Azure's own faults", () => {
    expect(isWorthRetrying(new UploadRequestError("busy", 429))).toBe(true);
    expect(isWorthRetrying(new UploadRequestError("timeout", 408))).toBe(true);
    expect(isWorthRetrying(new UploadRequestError("server", 500))).toBe(true);
    expect(isWorthRetrying(new UploadRequestError("unavailable", 503))).toBe(true);
  });

  it("does NOT retry an expired or insufficient credential", () => {
    // A 403 is the SAS window having closed mid-upload. It will be a 403
    // again in two seconds, and in four, and the person just waits longer
    // for the same sentence.
    expect(isWorthRetrying(new UploadRequestError("forbidden", 403))).toBe(false);
  });

  it("does NOT retry a malformed request or a missing container", () => {
    expect(isWorthRetrying(new UploadRequestError("bad request", 400))).toBe(false);
    expect(isWorthRetrying(new UploadRequestError("not found", 404))).toBe(false);
  });

  it("does not retry a cancellation, which is somebody leaving the page", () => {
    // Deliberately a plain Error rather than an UploadRequestError, so it
    // cannot be mistaken for a fault worth trying again.
    expect(isWorthRetrying(new Error("The upload was cancelled."))).toBe(false);
  });
});
