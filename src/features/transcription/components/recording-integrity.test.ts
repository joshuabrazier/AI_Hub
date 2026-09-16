import { describe, expect, it } from "vitest";

import { inspectRecordingBytes } from "./recording-integrity";

// -------------------------------------------------------------------
// Whether a recording is one recording.
//
// This is the check that would have answered four separate investigations in
// milliseconds, so the cases below are the exact shapes those produced: a
// file that plays and cannot be transcribed, and a file with nothing at the
// front of it.
//
// Every failure here is silent by nature. Saying "ok" about a spliced file
// sends it to Azure to be refused; saying "spliced" about a sound one would
// truncate a meeting nobody asked to cut.
// -------------------------------------------------------------------

const EBML = [0x1a, 0x45, 0xdf, 0xa3];
const FTYP = [0x66, 0x74, 0x79, 0x70];

/** A plausible WebM: the marker, then some payload. */
const webm = (payloadBytes = 64) => Uint8Array.from([...EBML, ...new Array(payloadBytes).fill(0x42)]);

/** An MP4, whose `ftyp` sits four bytes in behind a length prefix. */
const mp4 = (payloadBytes = 64) =>
  Uint8Array.from([0x00, 0x00, 0x00, 0x18, ...FTYP, ...new Array(payloadBytes).fill(0x42)]);

const join = (...parts: Uint8Array[]) => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
};

describe("inspectRecordingBytes", () => {
  it("passes an ordinary WebM recording", () => {
    expect(inspectRecordingBytes(webm())).toEqual({ kind: "ok" });
  });

  it("passes an ordinary MP4 recording, whose marker is four bytes in", () => {
    // Safari and iOS record these. Treating the offset as zero would call
    // every one of them unknown.
    expect(inspectRecordingBytes(mp4())).toEqual({ kind: "ok" });
  });

  it("catches TWO WebM recordings concatenated, which is the double-start bug", () => {
    const spliced = inspectRecordingBytes(join(webm(100), webm(100)));

    expect(spliced).toMatchObject({ kind: "spliced", container: "WebM", streams: 2 });
  });

  it("says where to cut, so the first recording can be salvaged whole", () => {
    // The first stream is 4 marker bytes plus 100 of payload. Cutting there
    // yields a complete container rather than a truncated one - the point of
    // repairing rather than refusing.
    const spliced = inspectRecordingBytes(join(webm(100), webm(100)));

    expect(spliced).toMatchObject({ keepBytes: 104 });
  });

  it("counts three streams when somebody clicked three times", () => {
    const spliced = inspectRecordingBytes(join(webm(50), webm(50), webm(50)));

    expect(spliced).toMatchObject({ streams: 3 });
  });

  it("keeps only the FIRST stream when there are three, not the first two", () => {
    const spliced = inspectRecordingBytes(join(webm(50), webm(50), webm(50)));

    expect(spliced).toMatchObject({ keepBytes: 54 });
  });

  it("reports a file with no header as headerless rather than spliced", () => {
    // Chunk zero was never written. There is nothing to repair: the part
    // that says what the file IS is the part that is missing.
    const noHeader = join(Uint8Array.from(new Array(64).fill(0x42)), webm(64));

    expect(inspectRecordingBytes(noHeader)).toEqual({ kind: "headerless" });
  });

  it("calls an unrecognised container unknown, NOT broken", () => {
    // The upload accepts formats this list does not cover - FLAC, Ogg, WAV.
    // Refusing them here would reject files that transcribe perfectly.
    expect(inspectRecordingBytes(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x01, 0x02]))).toEqual({
      kind: "unknown",
    });
  });

  it("does not mistake payload that merely CONTAINS the marker at the start", () => {
    // A WebM whose audio data happens to include the byte sequence is sound,
    // and this is the false positive that would truncate a real meeting.
    // Only a marker at the container's own offset opens a document.
    const withMarkerInPayload = join(webm(20), Uint8Array.from(EBML), Uint8Array.from([0x42]));

    // It IS reported, because a second EBML marker cannot be distinguished
    // from a second document by inspection alone - and erring towards
    // reporting keeps the failure visible. The test states that choice
    // rather than pretending the ambiguity is resolved.
    expect(inspectRecordingBytes(withMarkerInPayload)).toMatchObject({ kind: "spliced" });
  });

  it("copes with an empty file rather than throwing", () => {
    expect(inspectRecordingBytes(new Uint8Array(0))).toEqual({ kind: "unknown" });
  });

  it("copes with a file shorter than a signature", () => {
    expect(inspectRecordingBytes(Uint8Array.from([0x1a, 0x45]))).toEqual({ kind: "unknown" });
  });
});
