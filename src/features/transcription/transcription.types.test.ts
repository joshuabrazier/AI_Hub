import { describe, expect, it } from "vitest";

import { deriveTranscriptionTitle } from "./transcription.mappers";
import {
  MEDIA_ACCEPT_ATTRIBUTE,
  MEDIA_TYPES_BY_EXTENSION,
  RECORDING_FORMAT_CANDIDATES,
  formatDuration,
  formatTimestamp,
  isGuaranteedFormat,
  mediaTypeForFileName,
  speakerLabel,
} from "./transcription.types";

// -------------------------------------------------------------------
// The media type is DERIVED FROM THE FILENAME on the server and never
// taken from the browser, so these are the tests for the one thing
// standing between a request and what ends up in the column.
// -------------------------------------------------------------------
describe("mediaTypeForFileName", () => {
  it("maps a known extension to its type", () => {
    expect(mediaTypeForFileName("standup.mp3")).toBe("audio/mpeg");
    expect(mediaTypeForFileName("recording.webm")).toBe("video/webm");
  });

  it("ignores the case of the extension", () => {
    expect(mediaTypeForFileName("MEETING.MP4")).toBe("video/mp4");
  });

  it("reads the LAST extension, so an inner one cannot decide the type", () => {
    // "notes.mp3.exe" is an executable named to look like audio. Taking the
    // first dot would store it as audio/mpeg and hand it to the Speech
    // service as a recording.
    expect(mediaTypeForFileName("notes.mp3.exe")).toBeNull();
    expect(mediaTypeForFileName("notes.exe.mp3")).toBe("audio/mpeg");
  });

  it("refuses a file with no extension at all", () => {
    expect(mediaTypeForFileName("recording")).toBeNull();
  });

  it("refuses an extension that is not on the list", () => {
    expect(mediaTypeForFileName("minutes.docx")).toBeNull();
    expect(mediaTypeForFileName("script.js")).toBeNull();
  });

  it("takes what real devices actually produce", () => {
    // Each of these is something somebody will genuinely arrive with, and
    // each was a silent rejection before: iPhone and Windows voice memos,
    // Android recorders, Teams and Zoom exports, screen recorders.
    const realWorld = [
      "voice memo.m4a", // iPhone, Windows Voice Recorder
      "meeting.mp4", // Teams, Zoom
      "screen recording.mov", // macOS
      "recording.3gp", // older Android recorders
      "capture.mkv", // OBS and most screen recorders
      "dictation.wma", // dictaphones and older Windows
      "call.amr", // phone call recorders
      "notes.aiff", // macOS uncompressed
    ];

    for (const fileName of realWorld) {
      expect(mediaTypeForFileName(fileName), fileName).not.toBeNull();
    }
  });
});

describe("isGuaranteedFormat", () => {
  it("is true for the formats Microsoft documents", () => {
    expect(isGuaranteedFormat("call.wav")).toBe(true);
    expect(isGuaranteedFormat("call.webm")).toBe(true);
  });

  it("is false for the video containers, which are accepted but not promised", () => {
    // These are what a screen recorder or an old camera produces, so they
    // are accepted - but the UI warns, because the Speech service does not
    // list them and may refuse one.
    //
    // .m4a is deliberately NOT in this list any more. It is a phone voice
    // memo, which makes it the most common upload there is, and a warning
    // shown on the most common case is one people learn to click past -
    // which then costs it its effect on .mov and .avi, where it is doing
    // real work.
    for (const fileName of ["meeting.mp4", "meeting.mov", "clip.m4v", "call.3gp", "old.avi"]) {
      expect(isGuaranteedFormat(fileName), fileName).toBe(false);
    }
  });

  it("does not warn on a phone voice memo", () => {
    // The regression this guards: .m4a is AAC in an MP4 container, and
    // Microsoft documents AAC. It is accepted, and the composer must not
    // caveat it.
    expect(isGuaranteedFormat("voice memo.m4a")).toBe(true);
  });

  it("is true for every format Microsoft lists, including the ones nobody remembers", () => {
    // SPEEX and Ogg audio are on the documented list and were missing from
    // the table entirely, so a .spx or .oga file was refused outright even
    // though the service handles both.
    for (const fileName of ["a.wav", "a.mp3", "a.flac", "a.ogg", "a.oga", "a.opus", "a.spx", "a.wma", "a.aac", "a.amr", "a.webm"]) {
      expect(isGuaranteedFormat(fileName), fileName).toBe(true);
    }
  });
});

describe("the accepted formats and the recorder agree", () => {
  it("offers every accepted extension to the file picker", () => {
    const offered = MEDIA_ACCEPT_ATTRIBUTE.split(",");

    expect(offered.sort()).toEqual(Object.keys(MEDIA_TYPES_BY_EXTENSION).sort());
  });

  it("only records into formats the server will accept", () => {
    // The recorder names its file with the extension it chose, and the
    // server derives the media type from that name. A candidate missing
    // from the table would upload and then be refused on start.
    for (const candidate of RECORDING_FORMAT_CANDIDATES) {
      expect(mediaTypeForFileName(`recording${candidate.extension}`)).not.toBeNull();
    }
  });

  it("prefers a documented format, and only falls back to an undocumented one", () => {
    // The order is the whole point. Every browser but Safari supports the
    // first candidate; Safari supports none of the Opus ones and lands on
    // MP4/AAC. A reordering that put a riskier format first would take that
    // risk for everybody rather than only for the browser that forces it.
    expect(isGuaranteedFormat(`recording${RECORDING_FORMAT_CANDIDATES[0].extension}`)).toBe(true);

    const firstUndocumented = RECORDING_FORMAT_CANDIDATES.findIndex(
      (candidate) => !isGuaranteedFormat(`recording${candidate.extension}`),
    );

    // Every candidate is documented now that .m4a is on the guaranteed list,
    // which is the good case and not something to assert against - findIndex
    // answers -1, and sliceing from 0 would read the whole list back as
    // "documented formats after the fallback" and fail.
    if (firstUndocumented === -1) return;

    const documentedAfterIt = RECORDING_FORMAT_CANDIDATES.slice(firstUndocumented + 1).filter((candidate) =>
      isGuaranteedFormat(`recording${candidate.extension}`),
    );

    expect(documentedAfterIt).toEqual([]);
  });
});

describe("deriveTranscriptionTitle", () => {
  it("drops the path and the extension", () => {
    expect(deriveTranscriptionTitle("C:\\Users\\sam\\Board meeting.mp3")).toBe("Board meeting");
  });

  it("turns separators into spaces", () => {
    expect(deriveTranscriptionTitle("weekly_stand-up.m4a")).toBe("weekly stand up");
  });

  it("falls back rather than producing an empty name", () => {
    expect(deriveTranscriptionTitle(".webm")).toBe("Recording");
  });
});

describe("formatDuration", () => {
  it("reads as hours and minutes once it is long enough to", () => {
    expect(formatDuration(3_725)).toBe("1h 2m");
  });

  it("reads as minutes and seconds for a short meeting", () => {
    expect(formatDuration(150)).toBe("2m 30s");
  });

  it("reads as seconds for anything under a minute", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  it("is empty when the duration is not known", () => {
    expect(formatDuration(null)).toBe("");
  });
});

describe("formatTimestamp", () => {
  it("pads the seconds", () => {
    expect(formatTimestamp(65_000)).toBe("1:05");
  });

  it("adds an hours field only once there is one", () => {
    expect(formatTimestamp(3_725_000)).toBe("1:02:05");
    expect(formatTimestamp(5_000)).toBe("0:05");
  });
});

describe("speakerLabel", () => {
  it("numbers a separated speaker", () => {
    expect(speakerLabel({ speaker: 2, speakerName: null })).toBe("Speaker 2");
  });

  it("says only 'Speaker' when the service could not tell voices apart", () => {
    expect(speakerLabel({ speaker: null, speakerName: null })).toBe("Speaker");
  });

  it("prefers a real name over a number", () => {
    // A Teams import carries both: Teams knows who was talking, and the
    // numeric field is what Azure would have guessed. Printing the number
    // over a name it actually has is the mistake this ordering prevents.
    expect(speakerLabel({ speaker: 1, speakerName: "Joshua Brazier" })).toBe("Joshua Brazier");
  });

  it("falls back to the number when the name is empty rather than absent", () => {
    expect(speakerLabel({ speaker: 0, speakerName: "" })).toBe("Speaker 0");
  });

  it("works on a segment that predates the name field", () => {
    // Rows written before Teams import existed have no speakerName at all.
    expect(speakerLabel({ speaker: 3 })).toBe("Speaker 3");
  });
});
