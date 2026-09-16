import { describe, expect, it } from "vitest";

import { inspectChunkSequence } from "./recording-store";

// -------------------------------------------------------------------
// Whether a set of stored chunks adds up to a file anything can read.
//
// This is the conclusion that decides between somebody getting their meeting
// back and an upload that Azure refuses several minutes later with "the
// audio format is invalid or cannot be detected" - a message that reads as a
// fault in the transcription service rather than in what was recorded.
//
// The asymmetry between chunk 0 and the rest is the whole subject. Every
// chunk MediaRecorder writes is a self-contained cluster, which is why a
// recording cut short by a crash generally still plays. The first one also
// carries the EBML header that says what the file IS, and without that there
// is no format to detect and every later cluster is unreadable however
// complete it is.
// -------------------------------------------------------------------

describe("inspectChunkSequence", () => {
  it("is happy with a complete run from zero", () => {
    expect(inspectChunkSequence([0, 1, 2, 3])).toEqual({ hasHeader: true, gaps: [] });
  });

  it("does not care what ORDER it is handed them in", () => {
    // IndexedDB returns index matches in key order, not insertion order, and
    // the caller sorts afterwards. This must not depend on that having
    // happened yet.
    expect(inspectChunkSequence([3, 0, 2, 1])).toEqual({ hasHeader: true, gaps: [] });
  });

  it("reports NO HEADER when chunk zero is missing, which is the failure that matters", () => {
    // The write is best-effort and not awaited, so a failed or in-flight
    // write when the tab dies leaves exactly this.
    expect(inspectChunkSequence([1, 2, 3])).toEqual({ hasHeader: false, gaps: [0] });
  });

  it("reports a gap in the middle without calling the recording unreadable", () => {
    // Survivable: it costs the seconds in the hole and the rest decodes.
    // Somebody who has lost a meeting would much rather have most of it.
    expect(inspectChunkSequence([0, 1, 3, 4])).toEqual({ hasHeader: true, gaps: [2] });
  });

  it("finds every gap, not just the first", () => {
    expect(inspectChunkSequence([0, 3, 5])).toEqual({ hasHeader: true, gaps: [1, 2, 4] });
  });

  it("does not invent a gap past the last chunk it was given", () => {
    // A recording that stopped at chunk 4 is complete at chunk 4. Treating
    // the end as a hole would warn about every single recording.
    expect(inspectChunkSequence([0, 1, 2])).toEqual({ hasHeader: true, gaps: [] });
  });

  it("treats an empty set as having no header rather than as complete", () => {
    // Nothing was written. It must not come back as a readable file with no
    // gaps, which is what a naive "no missing seqs" check would say.
    expect(inspectChunkSequence([])).toEqual({ hasHeader: false, gaps: [] });
  });

  it("handles a single chunk, which is what a very short recording is", () => {
    expect(inspectChunkSequence([0])).toEqual({ hasHeader: true, gaps: [] });
  });

  it("copes with a lone chunk that is NOT the first", () => {
    // One write landed and the header's did not. Every byte present is
    // unreadable, and saying so is the point.
    expect(inspectChunkSequence([7])).toEqual({
      hasHeader: false,
      gaps: [0, 1, 2, 3, 4, 5, 6],
    });
  });

  it("ignores a duplicate sequence rather than counting it as a gap", () => {
    // A retried write could leave two records with one seq. put() is keyed,
    // so this should not arise - but a duplicate must never be reported as a
    // hole, because that would warn about a recording with nothing wrong.
    expect(inspectChunkSequence([0, 1, 1, 2])).toEqual({ hasHeader: true, gaps: [] });
  });
});
