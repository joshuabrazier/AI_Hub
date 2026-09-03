import { describe, expect, it } from "vitest";

import { selectTranscriptForOccurrence, type TranscriptCandidate } from "./teams-occurrence";

// -------------------------------------------------------------------
// The first test here is the bug as it was reported, written as a test.
// Everything else guards the ways an obvious fix for it goes wrong.
// -------------------------------------------------------------------

const at = (iso: string) => new Date(iso);

// A weekly meeting. Today's occurrence is the one on screen.
const TODAY = { startsAt: at("2026-09-01T09:00:00Z"), endsAt: at("2026-09-01T10:00:00Z") };

// The only occurrence anybody ever transcribed, months ago.
const FIRST_IN_SERIES: TranscriptCandidate = { id: "t-first", createdAt: at("2026-06-02T09:03:00Z") };

const TODAYS: TranscriptCandidate = { id: "t-today", createdAt: at("2026-09-01T09:02:00Z") };

describe("selectTranscriptForOccurrence", () => {
  it("refuses a transcript from a different occurrence of the same series", () => {
    // THE REPORTED BUG. Every occurrence of a recurring meeting shares one
    // join URL, so the series' only transcript - from the first meeting,
    // months earlier - was handed over as though it were today's, stored
    // under today's date and title. Nothing errored.
    const selection = selectTranscriptForOccurrence([FIRST_IN_SERIES], TODAY);

    expect(selection.kind).toBe("no-transcript-for-occurrence");
  });

  it("picks today's transcript when the series holds several", () => {
    const selection = selectTranscriptForOccurrence([FIRST_IN_SERIES, TODAYS], TODAY);

    expect(selection).toEqual({ kind: "matched", transcript: TODAYS });
  });

  it("picks the older one when the older one is the occurrence asked for", () => {
    // Taking the newest looks like a fix and is not: it moves the error onto
    // anybody importing an earlier occurrence, who would be handed the most
    // recent meeting instead. Ordering cannot answer this question.
    const june = { startsAt: at("2026-06-02T09:00:00Z"), endsAt: at("2026-06-02T10:00:00Z") };

    const selection = selectTranscriptForOccurrence([FIRST_IN_SERIES, TODAYS], june);

    expect(selection).toEqual({ kind: "matched", transcript: FIRST_IN_SERIES });
  });

  it("accepts a transcript started shortly before the scheduled time", () => {
    // People join early and start transcribing before the hour.
    const early: TranscriptCandidate = { id: "t", createdAt: at("2026-09-01T08:45:00Z") };

    expect(selectTranscriptForOccurrence([early], TODAY).kind).toBe("matched");
  });

  it("accepts a transcript finalised after the meeting overran", () => {
    const late: TranscriptCandidate = { id: "t", createdAt: at("2026-09-01T13:30:00Z") };

    expect(selectTranscriptForOccurrence([late], TODAY).kind).toBe("matched");
  });

  it("keeps a daily series unambiguous", () => {
    // The window is seven hours wide in total, so consecutive days cannot
    // both match. If it ever widened past twenty-four hours, a daily
    // stand-up would start importing the wrong day again.
    const yesterday: TranscriptCandidate = { id: "t", createdAt: at("2026-08-31T09:02:00Z") };
    const tomorrow: TranscriptCandidate = { id: "t2", createdAt: at("2026-09-02T09:02:00Z") };

    expect(selectTranscriptForOccurrence([yesterday, tomorrow], TODAY).kind).toBe(
      "no-transcript-for-occurrence",
    );
  });

  it("takes the later one when a meeting was stopped and restarted", () => {
    // Both belong to this occurrence, so newest is right here - and only
    // here, because every candidate has already been proved to be the same
    // meeting.
    const firstHalf: TranscriptCandidate = { id: "a", createdAt: at("2026-09-01T09:02:00Z") };
    const restarted: TranscriptCandidate = { id: "b", createdAt: at("2026-09-01T09:31:00Z") };

    const selection = selectTranscriptForOccurrence([firstHalf, restarted], TODAY);

    expect(selection).toEqual({ kind: "matched", transcript: restarted });
  });

  it("reports an undateable transcript rather than guessing", () => {
    // Graph documents createdDateTime, so this should not arise. If it does,
    // a transcript that cannot be placed must not be placed anyway - that is
    // the reported bug with extra steps.
    const selection = selectTranscriptForOccurrence([{ id: "t", createdAt: null }], TODAY);

    expect(selection.kind).toBe("undateable");
  });

  it("ignores an undateable transcript when a dateable one matches", () => {
    const selection = selectTranscriptForOccurrence([{ id: "x", createdAt: null }, TODAYS], TODAY);

    expect(selection).toEqual({ kind: "matched", transcript: TODAYS });
  });

  it("reports nothing to import for a meeting with no transcripts at all", () => {
    expect(selectTranscriptForOccurrence([], TODAY).kind).toBe("no-transcript-for-occurrence");
  });
});
