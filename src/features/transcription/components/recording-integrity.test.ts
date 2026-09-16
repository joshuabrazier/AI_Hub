import { describe, expect, it } from "vitest";

import { inspectRecording } from "./recording-integrity";

// -------------------------------------------------------------------
// What the app decides to do with a recording before it uploads it.
//
// The parsing itself is tested in audio-probe.test.ts. What is tested here
// is the DECISION - send it, mend it, or refuse it - and the full-file scan
// that finds a join the head-only probe cannot see.
//
// Every failure here is quiet and expensive. Calling a sound recording
// spliced truncates a meeting nobody asked to cut; missing a real splice
// sends a file to be refused half an hour later; and refusing an
// unrecognised container throws away a recording that would have worked.
// -------------------------------------------------------------------

const EBML = [0x1a, 0x45, 0xdf, 0xa3];

const ascii = (text: string): number[] => Array.from(text, (character) => character.charCodeAt(0));

const vint = (value: number): number[] => (value < 0x7f ? [0x80 | value] : [0x40 | (value >> 8), value & 0xff]);

const el = (id: number[], payload: number[]): number[] => [...id, ...vint(payload.length), ...payload];

/**
 * A WebM with one Opus audio track, padded to `padBytes` so a splice can be
 * placed somewhere realistic rather than in the first few bytes.
 */
function webm(padBytes = 0): number[] {
  const trackEntry = el(
    [0xae],
    [
      ...el([0x83], [0x02]),
      ...el([0x86], ascii("A_OPUS")),
      ...el([0xe1], [...el([0x9f], [0x01])]),
    ],
  );

  return [
    ...el(EBML, el([0x42, 0x82], ascii("webm"))),
    // Unknown-size Segment, as MediaRecorder writes.
    ...[0x18, 0x53, 0x80, 0x67],
    0xff,
    ...el([0x16, 0x54, 0xae, 0x6b], trackEntry),
    ...el([0x1f, 0x43, 0xb6, 0x75], [0x11, 0x22]),
    ...new Array(padBytes).fill(0x5a),
  ];
}

const blobOf = (parts: number[]): Blob => new Blob([Uint8Array.from(parts)], { type: "audio/webm" });

describe("inspectRecording", () => {
  it("sends an ordinary recording as it is", async () => {
    const verdict = await inspectRecording(blobOf(webm(2_000)));

    expect(verdict.kind).toBe("ok");
    expect(verdict.probe.audioCodec).toBe("Opus");
  });

  it("mends two recordings joined together, keeping the first", async () => {
    const first = webm(1_000);
    const verdict = await inspectRecording(blobOf([...first, ...webm(500)]));

    expect(verdict.kind).toBe("repaired");

    if (verdict.kind !== "repaired") return;

    // Exactly the first recording, not a byte more or less.
    expect(verdict.media.size).toBe(first.length);
    expect(verdict.message).toContain("separate takes");
  });

  it("finds a join far past the head the probe reads", async () => {
    // The head probe only looks at the first 512 KB. A real splice sits
    // wherever the first take happened to end, which on a meeting is many
    // megabytes in - so this is the case the chunked scan exists for.
    const first = webm(700_000);
    const verdict = await inspectRecording(blobOf([...first, ...webm(1_000)]));

    expect(verdict.kind).toBe("repaired");

    if (verdict.kind !== "repaired") return;

    expect(verdict.media.size).toBe(first.length);
  });

  it("does not report a join in a recording that has none", async () => {
    // The false positive that would truncate a real meeting. A megabyte of
    // payload gives chance a fair opportunity to produce the marker.
    const verdict = await inspectRecording(blobOf(webm(1_000_000)));

    expect(verdict.kind).toBe("ok");
  });

  it("refuses a recording whose beginning was never saved, and says so", async () => {
    const verdict = await inspectRecording(blobOf([...new Array(500).fill(0x22), ...webm()]));

    expect(verdict.kind).toBe("refused");

    if (verdict.kind !== "refused") return;

    expect(verdict.message).toContain("beginning of the recording was not saved");
  });

  it("refuses an empty file with a reason rather than an upload", async () => {
    const verdict = await inspectRecording(new Blob([], { type: "audio/webm" }));

    expect(verdict.kind).toBe("refused");
  });

  it("refuses a video-only file by naming the actual problem", async () => {
    const video = [
      ...el(EBML, el([0x42, 0x82], ascii("webm"))),
      ...[0x18, 0x53, 0x80, 0x67],
      0xff,
      ...el(
        [0x16, 0x54, 0xae, 0x6b],
        el([0xae], [...el([0x83], [0x01]), ...el([0x86], ascii("V_VP8"))]),
      ),
      ...el([0x1f, 0x43, 0xb6, 0x75], [0x11]),
    ];

    const verdict = await inspectRecording(blobOf(video));

    expect(verdict.kind).toBe("refused");

    if (verdict.kind !== "refused") return;

    expect(verdict.message).toContain("no audio track");
  });

  it("lets an unrecognised container through rather than refusing it", async () => {
    // The probe knows six formats and the upload accepts more. Refusing a
    // file that would have transcribed perfectly is worse than a slow
    // failure, so 'I do not know this' is never a refusal.
    const verdict = await inspectRecording(
      new Blob([Uint8Array.from(new Array(4_000).fill(0x33))], { type: "audio/amr" }),
    );

    expect(verdict.kind).toBe("ok");
  });

  it("never scans for a join in a format whose signature it does not trust", async () => {
    // A short or common signature would report joins that are not there,
    // and a false positive here cuts somebody's meeting in half. Only WebM
    // and MP4 are scanned; everything else is passed through whole.
    const wav = [...ascii("RIFF"), 0x24, 0x00, 0x00, 0x00, ...ascii("WAVE"), ...new Array(200).fill(0)];

    const verdict = await inspectRecording(new Blob([Uint8Array.from(wav)], { type: "audio/wav" }));

    expect(verdict.kind).not.toBe("repaired");
  });
});

describe("inspectRecording - a file somebody chose rather than recorded", () => {
  it("skips the whole-file scan when asked to", async () => {
    // A picked file would otherwise mean reading a gigabyte through
    // JavaScript before the upload could begin, to look for a fault that
    // arrives with our own recorder.
    const first = webm(1_000);
    const spliced = blobOf([...first, ...webm(500)]);

    const scanned = await inspectRecording(spliced);
    const headOnly = await inspectRecording(spliced, { scanForSplice: false });

    expect(scanned.kind).toBe("repaired");
    expect(headOnly.kind).toBe("ok");
  });

  it("still refuses what cannot work, without the scan", async () => {
    const verdict = await inspectRecording(new Blob([], { type: "audio/webm" }), {
      scanForSplice: false,
    });

    expect(verdict.kind).toBe("refused");
  });

  it("says what the file IS alongside why it was refused", async () => {
    // "This has no audio track" invites "are you sure?". Naming the
    // container and the video codec answers it.
    const video = [
      ...el(EBML, el([0x42, 0x82], ascii("webm"))),
      ...[0x18, 0x53, 0x80, 0x67],
      0xff,
      ...el(
        [0x16, 0x54, 0xae, 0x6b],
        el([0xae], [...el([0x83], [0x01]), ...el([0x86], ascii("V_VP8"))]),
      ),
      ...el([0x1f, 0x43, 0xb6, 0x75], [0x11]),
    ];

    const verdict = await inspectRecording(blobOf(video), { scanForSplice: false });

    expect(verdict.kind).toBe("refused");

    if (verdict.kind !== "refused") return;

    expect(verdict.message).toContain("WebM");
  });
});
