import { describe, expect, it } from "vitest";

import {
  canRetryByReencoding,
  classifyTranscriptionFailure,
  TRANSCRIPTION_FAILURE_KINDS,
} from "./transcription-failure";

// -------------------------------------------------------------------
// The exact strings production has produced.
//
// Getting one of these wrong is not a cosmetic fault: classifying a decode
// failure as `other` takes away the re-encode that would have fixed it, and
// classifying an unreachable blob as `undecodable` sends somebody's phone
// through a full re-encode of an hour-long meeting to be refused for the
// same reason as before.
// -------------------------------------------------------------------

describe("classifyTranscriptionFailure", () => {
  it("reads the message a converted file produced as undecodable", () => {
    expect(classifyTranscriptionFailure("InvalidData: The recordings URI contains invalid data.")).toBe(
      TRANSCRIPTION_FAILURE_KINDS.UNDECODABLE,
    );
  });

  it("reads the message the 99 MB recording produced as undecodable", () => {
    expect(
      classifyTranscriptionFailure("InvalidData: The audio format is invalid or cannot be detected."),
    ).toBe(TRANSCRIPTION_FAILURE_KINDS.UNDECODABLE);
  });

  it("tells InvalidUri apart from InvalidData, which is the whole point", () => {
    // Both contain "invalid". One is a storage configuration problem no
    // browser can fix; the other is fixed by re-encoding.
    expect(classifyTranscriptionFailure("InvalidUri: The recordings URI is invalid.")).toBe(
      TRANSCRIPTION_FAILURE_KINDS.UNREACHABLE,
    );
  });

  it("reads a download failure as unreachable", () => {
    expect(classifyTranscriptionFailure("The file could not be downloaded from the given URI.")).toBe(
      TRANSCRIPTION_FAILURE_KINDS.UNREACHABLE,
    );
  });

  it("reads this app's own size refusal as too-large, not as a decode failure", () => {
    // Written by startTranscriptionService, which deletes the media - so
    // offering a re-encode would be offering to convert a file that is gone.
    expect(
      classifyTranscriptionFailure(
        "That file is larger than the 1024 MB the transcription service accepts.",
      ),
    ).toBe(TRANSCRIPTION_FAILURE_KINDS.TOO_LARGE);
  });

  it("falls back to other for a message it does not recognise", () => {
    // Degrading to `other` means retrying as-is, which is the old behaviour.
    // Degrading to a WRONG kind would be worse than not classifying at all.
    expect(classifyTranscriptionFailure("Something nobody has seen before.")).toBe(
      TRANSCRIPTION_FAILURE_KINDS.OTHER,
    );
  });

  it("treats no error at all as other rather than throwing", () => {
    expect(classifyTranscriptionFailure(null)).toBe(TRANSCRIPTION_FAILURE_KINDS.OTHER);
    expect(classifyTranscriptionFailure("")).toBe(TRANSCRIPTION_FAILURE_KINDS.OTHER);
  });

  it("does not care about case, because the kind and the prose differ in it", () => {
    expect(classifyTranscriptionFailure("invaliddata: THE AUDIO FORMAT IS INVALID")).toBe(
      TRANSCRIPTION_FAILURE_KINDS.UNDECODABLE,
    );
  });
});

describe("canRetryByReencoding", () => {
  it("offers a re-encode only for a decode failure", () => {
    expect(canRetryByReencoding(TRANSCRIPTION_FAILURE_KINDS.UNDECODABLE)).toBe(true);
    expect(canRetryByReencoding(TRANSCRIPTION_FAILURE_KINDS.UNREACHABLE)).toBe(false);
    expect(canRetryByReencoding(TRANSCRIPTION_FAILURE_KINDS.TOO_LARGE)).toBe(false);
    expect(canRetryByReencoding(TRANSCRIPTION_FAILURE_KINDS.OTHER)).toBe(false);
  });
});
