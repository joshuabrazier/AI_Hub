import { describe, expect, it } from "vitest";

import { mergePhrasesIntoSegments, segmentsToText, type RecognizedPhrase } from "./speech-client";

// -------------------------------------------------------------------
// The Speech service emits one phrase at a time, and this is the only
// part of handling its response that has any logic in it. Everything else
// is a fetch and a field read, which a test could only restate.
//
// Getting this wrong does not fail loudly - it produces a transcript that
// reads slightly wrong, attributes a sentence to the wrong speaker, or
// silently drops a turn. Hence the tests.
// -------------------------------------------------------------------

const phrase = (speaker: number | undefined, offset: number, duration: number, text: string): RecognizedPhrase => ({
  speaker,
  offsetMilliseconds: offset,
  durationMilliseconds: duration,
  nBest: [{ display: text }],
});

describe("mergePhrasesIntoSegments", () => {
  it("joins consecutive phrases from the same speaker into one turn", () => {
    const segments = mergePhrasesIntoSegments([
      phrase(0, 0, 1_000, "Morning everyone."),
      phrase(0, 1_000, 2_000, "Let's start with the numbers."),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe("Morning everyone. Let's start with the numbers.");
  });

  it("extends the merged turn's end time to the last phrase in it", () => {
    const segments = mergePhrasesIntoSegments([
      phrase(0, 500, 1_000, "One."),
      phrase(0, 1_500, 2_500, "Two."),
    ]);

    expect(segments[0].startMs).toBe(500);
    expect(segments[0].endMs).toBe(4_000);
  });

  it("starts a new turn when the speaker changes", () => {
    const segments = mergePhrasesIntoSegments([
      phrase(0, 0, 1_000, "Are we agreed?"),
      phrase(1, 1_000, 1_000, "Agreed."),
      phrase(0, 2_000, 1_000, "Good."),
    ]);

    expect(segments.map((segment) => segment.speaker)).toEqual([0, 1, 0]);
    expect(segments.map((segment) => segment.text)).toEqual(["Are we agreed?", "Agreed.", "Good."]);
  });

  it("treats a missing speaker as one unidentified voice rather than as speaker zero", () => {
    // A recording the service could not diarize comes back with no speaker
    // at all. Reading that as speaker 0 would merge it with a real speaker
    // 0 on any recording where only some phrases were separated.
    const segments = mergePhrasesIntoSegments([
      phrase(undefined, 0, 1_000, "First."),
      phrase(0, 1_000, 1_000, "Second."),
    ]);

    expect(segments).toHaveLength(2);
    expect(segments[0].speaker).toBeNull();
    expect(segments[1].speaker).toBe(0);
  });

  it("drops phrases the recogniser made nothing of, without splitting the turn around them", () => {
    // The empty phrase sits between two from the same speaker. If it were
    // kept as a segment, or ended the current one, the sentence either side
    // of it would be split into two turns.
    const segments = mergePhrasesIntoSegments([
      phrase(0, 0, 1_000, "The figure was"),
      { speaker: 0, offsetMilliseconds: 1_000, durationMilliseconds: 500, nBest: [{ display: "   " }] },
      { speaker: 0, offsetMilliseconds: 1_500, durationMilliseconds: 500 },
      phrase(0, 2_000, 1_000, "forty."),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe("The figure was forty.");
  });

  it("takes the highest-ranked alternative and trims it", () => {
    const segments = mergePhrasesIntoSegments([
      {
        speaker: 0,
        offsetMilliseconds: 0,
        durationMilliseconds: 1_000,
        nBest: [{ display: "  the right one  " }, { display: "the wrong one" }],
      },
    ]);

    expect(segments[0].text).toBe("the right one");
  });

  it("defaults missing timings to zero rather than producing NaN", () => {
    const segments = mergePhrasesIntoSegments([{ speaker: 1, nBest: [{ display: "Hello." }] }]);

    expect(segments[0].startMs).toBe(0);
    expect(segments[0].endMs).toBe(0);
  });

  it("returns nothing for an empty recording", () => {
    expect(mergePhrasesIntoSegments([])).toEqual([]);
  });
});

describe("segmentsToText", () => {
  it("labels each turn with its speaker", () => {
    const text = segmentsToText([
      { speaker: 0, startMs: 0, endMs: 1_000, text: "Are we agreed?" },
      { speaker: 1, startMs: 1_000, endMs: 2_000, text: "Agreed." },
    ]);

    expect(text).toBe("Speaker 0: Are we agreed?\n\nSpeaker 1: Agreed.");
  });

  it("leaves an unidentified voice unlabelled", () => {
    // "Speaker null" would be worse than no label, and this is what a
    // single-microphone recording of a room usually produces.
    const text = segmentsToText([{ speaker: null, startMs: 0, endMs: 1_000, text: "Just the one voice." }]);

    expect(text).toBe("Just the one voice.");
  });
});
