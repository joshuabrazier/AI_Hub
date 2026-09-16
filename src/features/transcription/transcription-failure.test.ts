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

describe("classifyTranscriptionFailure - the kinds added after reading Azure's schemas", () => {
  it("recognises the DOCUMENTED detailed codes, which are a contract where prose is not", () => {
    expect(classifyTranscriptionFailure("InvalidAudioFormat: could not decode")).toBe(
      TRANSCRIPTION_FAILURE_KINDS.UNDECODABLE,
    );
    expect(classifyTranscriptionFailure("InvalidRecordingsUri")).toBe(
      TRANSCRIPTION_FAILURE_KINDS.UNREACHABLE,
    );
    expect(classifyTranscriptionFailure("AudioLengthLimitExceeded")).toBe(
      TRANSCRIPTION_FAILURE_KINDS.TOO_LARGE,
    );
  });

  it("separates a file with nothing in it from a file that cannot be read", () => {
    // Converting a video with no sound produces a smaller file with no
    // sound. The screen must not offer it, so this cannot be undecodable.
    const message =
      "This file contains video and no audio track, so there is no speech in it to transcribe.";

    expect(classifyTranscriptionFailure(message)).toBe(TRANSCRIPTION_FAILURE_KINDS.UNUSABLE);
    expect(canRetryByReencoding(classifyTranscriptionFailure(message))).toBe(false);
  });

  it("reads an encrypted recording as unusable rather than as a decode failure", () => {
    expect(classifyTranscriptionFailure("This recording is encrypted (DRM)")).toBe(
      TRANSCRIPTION_FAILURE_KINDS.UNUSABLE,
    );
  });

  it("reads a rotated Speech key as a SERVICE credentials fault, not a storage one", () => {
    // Both are "Azure will not let us at something" and both are unfixable
    // from a browser, which is why they were one kind at first. They are
    // two because the advice differs: one is the Speech resource's key,
    // the other is a Storage Blob Data Reader role assignment, and they
    // live in different parts of the portal.
    expect(
      classifyTranscriptionFailure("This is a credentials problem on the transcription service"),
    ).toBe(TRANSCRIPTION_FAILURE_KINDS.SERVICE_CREDENTIALS);
  });

  it("still classifies the full paragraph a failure now produces", () => {
    // Azure's headline, its report, and this app's reading of the bytes,
    // joined. The kind has to survive the extra prose around it.
    const paragraph = [
      "InvalidData: The audio format is invalid or cannot be detected.",
      "The stored file is WebM (DocType webm), Opus, mono, 48,000 Hz, about 23 seconds, 99.2 MB.",
    ].join(" ");

    expect(classifyTranscriptionFailure(paragraph)).toBe(TRANSCRIPTION_FAILURE_KINDS.UNDECODABLE);
  });
});

describe("classifyTranscriptionFailure - the app's OWN refusals", () => {
  // -----------------------------------------------------------------
  // A message this app writes and a classifier this app owns can drift
  // apart without anything failing, and the symptom is not an error: the
  // screen simply offers two buttons for a dead end. So the literal
  // sentences are pinned here rather than paraphrased.
  // -----------------------------------------------------------------
  it("classifies the over-length refusal it writes itself", () => {
    const tooLong =
      "That recording is 310 minutes long, and the transcription service accepts up to 240 minutes in one file when it is separating speakers. Split it and upload the parts, or record longer meetings in sections.";

    expect(classifyTranscriptionFailure(tooLong)).toBe(TRANSCRIPTION_FAILURE_KINDS.TOO_LARGE);
    expect(canRetryByReencoding(classifyTranscriptionFailure(tooLong))).toBe(false);
  });

  it("classifies the over-size refusal it writes itself", () => {
    const tooBig = "That file is larger than the 1024 MB the transcription service accepts.";

    expect(classifyTranscriptionFailure(tooBig)).toBe(TRANSCRIPTION_FAILURE_KINDS.TOO_LARGE);
  });

  it("sends a rotated Speech key to the Speech resource, not to a storage role", () => {
    // Two different blades of the Azure portal. Naming the wrong one costs
    // whoever can fix it an afternoon.
    const refused =
      "The transcription service refused to say how this job is going, and it will keep refusing. This is a credentials problem on the transcription service rather than anything wrong with your recording.";

    expect(classifyTranscriptionFailure(refused)).toBe(TRANSCRIPTION_FAILURE_KINDS.SERVICE_CREDENTIALS);
  });

  it("still sends an unreadable blob to the storage role", () => {
    expect(classifyTranscriptionFailure("InvalidUri: the recordings URI is invalid")).toBe(
      TRANSCRIPTION_FAILURE_KINDS.UNREACHABLE,
    );
  });

  it("offers a re-encode for no kind but a decode failure", () => {
    for (const kind of Object.values(TRANSCRIPTION_FAILURE_KINDS)) {
      expect(canRetryByReencoding(kind)).toBe(kind === TRANSCRIPTION_FAILURE_KINDS.UNDECODABLE);
    }
  });
});
