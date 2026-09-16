import { describe, expect, it } from "vitest";

import { isReplacementMediaKey, mediaStorageKey, nextMediaStorageKey } from "./media-keys";

// -------------------------------------------------------------------
// These decide where a re-encoded recording is written and whether the
// screen offers to convert one again.
//
// Worth testing directly because both failure modes are quiet and
// expensive: a key that collides overwrites the only copy of a meeting
// somebody has already had, and a suffix the reader cannot recognise makes
// the page re-convert an hour of audio on every single visit.
// -------------------------------------------------------------------

describe("nextMediaStorageKey", () => {
  it("adds a first attempt suffix to an original key", () => {
    expect(nextMediaStorageKey("transcription/user-1/rec-1")).toBe("transcription/user-1/rec-1-r1");
  });

  it("counts up rather than stacking suffixes", () => {
    // Stacking would give ...-r1-r1: still unique, but it makes the attempt
    // count unreadable and grows the key without limit.
    expect(nextMediaStorageKey("transcription/user-1/rec-1-r1")).toBe("transcription/user-1/rec-1-r2");
    expect(nextMediaStorageKey("transcription/user-1/rec-1-r9")).toBe("transcription/user-1/rec-1-r10");
  });

  it("never returns the key it was given, which would be an overwrite", () => {
    for (const key of ["transcription/u/r", "transcription/u/r-r1", "transcription/u/r-r42"]) {
      expect(nextMediaStorageKey(key)).not.toBe(key);
    }
  });

  it("stays under the same per-user prefix, which cleanup walks", () => {
    expect(nextMediaStorageKey(mediaStorageKey("user-1", "rec-1")).startsWith("transcription/user-1/")).toBe(
      true,
    );
  });

  it("is not fooled by an id that merely ends in something similar", () => {
    // `-r` with no digits after it is part of the id, not an attempt marker.
    expect(nextMediaStorageKey("transcription/user-1/rec-r")).toBe("transcription/user-1/rec-r-r1");
  });
});

describe("isReplacementMediaKey", () => {
  it("recognises exactly what nextMediaStorageKey produces", () => {
    // The pairing IS the contract. If these two ever disagree, the screen
    // converts a recording that has already been converted and refused.
    expect(isReplacementMediaKey(nextMediaStorageKey("transcription/u/rec"))).toBe(true);
    expect(isReplacementMediaKey(nextMediaStorageKey(nextMediaStorageKey("transcription/u/rec")))).toBe(true);
  });

  it("says no to an original key", () => {
    expect(isReplacementMediaKey("transcription/u/rec")).toBe(false);
    expect(isReplacementMediaKey("transcription/u/rec-r")).toBe(false);
  });

  it("treats a missing key as not replaced rather than throwing", () => {
    // A Teams import has no media at all, and it reaches this through the
    // detail mapper on every render.
    expect(isReplacementMediaKey(null)).toBe(false);
  });
});
