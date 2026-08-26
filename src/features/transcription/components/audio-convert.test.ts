import { describe, expect, it } from "vitest";

import { encodeWav, needsConversion, replaceExtension } from "./audio-convert";

// -------------------------------------------------------------------
// The WAV header is the part worth testing.
//
// Everything else in this module needs a real browser decoder, but the
// header is pure - and a field a byte out or written big-endian produces a
// file that plays locally and is refused by Azure with exactly the error
// this whole module exists to fix. A silent regression here would look
// identical to the bug it replaced.
// -------------------------------------------------------------------
describe("encodeWav", () => {
  const ascii = (view: DataView, offset: number, length: number) =>
    Array.from({ length }, (_, index) => String.fromCharCode(view.getUint8(offset + index))).join("");

  it("writes a RIFF/WAVE header the service will recognise", () => {
    const wav = encodeWav(new Float32Array(8), 16_000);
    const view = new DataView(wav);

    expect(ascii(view, 0, 4)).toBe("RIFF");
    expect(ascii(view, 8, 4)).toBe("WAVE");
    expect(ascii(view, 12, 4)).toBe("fmt ");
    expect(ascii(view, 36, 4)).toBe("data");
  });

  it("declares 16-bit mono PCM at the rate it was given", () => {
    const wav = encodeWav(new Float32Array(4), 16_000);
    const view = new DataView(wav);

    // Little-endian throughout - the `true` argument. WAV is a
    // little-endian format and a big-endian header is unreadable.
    expect(view.getUint32(16, true)).toBe(16); // fmt chunk length
    expect(view.getUint16(20, true)).toBe(1); // 1 = uncompressed PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
  });

  it("gets the two length fields right, which is what truncates a file", () => {
    const samples = new Float32Array(100);
    const wav = encodeWav(samples, 16_000);
    const view = new DataView(wav);

    const dataBytes = samples.length * 2;

    // Total length counts everything after the first 8 bytes.
    expect(view.getUint32(4, true)).toBe(36 + dataBytes);
    expect(view.getUint32(40, true)).toBe(dataBytes);
    expect(wav.byteLength).toBe(44 + dataBytes);
  });

  it("derives byte rate and block align from the format", () => {
    const view = new DataView(encodeWav(new Float32Array(2), 16_000));

    expect(view.getUint32(28, true)).toBe(16_000 * 2); // 1 channel x 2 bytes
    expect(view.getUint16(32, true)).toBe(2);
  });

  it("clips rather than wrapping, so a loud passage stays loud", () => {
    // Decoded audio can sit slightly outside -1..1. Letting it overflow
    // turns the loudest moment of a meeting into white noise, which is
    // worse than clipping it.
    const view = new DataView(encodeWav(new Float32Array([2, -2]), 16_000));

    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });

  it("round-trips a midpoint sample close enough to be inaudible", () => {
    const view = new DataView(encodeWav(new Float32Array([0.5]), 16_000));

    expect(view.getInt16(44, true)).toBeCloseTo(0.5 * 0x7fff, -1);
  });
});

describe("needsConversion", () => {
  it("is true for the MP4 family, which Azure refuses to decode", () => {
    for (const fileName of ["memo.m4a", "call.MP4", "screen.mov", "clip.m4v", "old.3gp"]) {
      expect(needsConversion(fileName), fileName).toBe(true);
    }
  });

  it("leaves the documented formats alone", () => {
    // Converting a file the service already reads costs quality and time
    // and buys nothing.
    for (const fileName of ["a.wav", "a.mp3", "a.flac", "a.ogg", "a.opus", "a.webm", "a.aac", "a.amr"]) {
      expect(needsConversion(fileName), fileName).toBe(false);
    }
  });
});

describe("replaceExtension", () => {
  it("swaps the extension so the server stores the right media type", () => {
    // Load-bearing: the server derives the stored type from the NAME. A
    // converted WAV still called .m4a would be stored as audio/mp4 and
    // handed to Azure as the very thing it just refused.
    expect(replaceExtension("Board meeting.m4a", ".wav")).toBe("Board meeting.wav");
  });

  it("keeps dots that are part of the name", () => {
    expect(replaceExtension("2026.03.01 standup.m4a", ".wav")).toBe("2026.03.01 standup.wav");
  });

  it("appends when there is no extension at all", () => {
    expect(replaceExtension("recording", ".wav")).toBe("recording.wav");
  });
});
