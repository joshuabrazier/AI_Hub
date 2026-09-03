import { describe, expect, it } from "vitest";

import {
  isInCallActivity,
  JOIN_EARLY_MS,
  OVERRUN_MS,
  resolveMeetingNow,
  type ScheduledMeeting,
} from "./meeting-now";

const NOW = new Date("2026-09-03T10:30:00.000Z");
const MINUTE = 60 * 1000;

function meeting(partial: Partial<ScheduledMeeting> & { eventId: string }): ScheduledMeeting {
  return {
    subject: partial.eventId,
    joinUrl: "https://teams.microsoft.com/l/meetup-join/x",
    startsAt: new Date(NOW.getTime() - 10 * MINUTE),
    endsAt: new Date(NOW.getTime() + 20 * MINUTE),
    isOnlineMeeting: true,
    ...partial,
  };
}

const inACall = { availability: "Busy", activity: "InACall" };

// -------------------------------------------------------------------
// Presence is the gate.
//
// Without it the prompt fires on every diary entry, including the ones
// nobody turned up to - and this prompt asks somebody to start a recording
// in front of other people, so a false positive is not a harmless one.
// -------------------------------------------------------------------
describe("resolveMeetingNow - presence gates everything", () => {
  it("says nothing when presence shows no call, however full the diary", () => {
    const result = resolveMeetingNow({
      presence: { availability: "Available", activity: "Available" },
      meetings: [meeting({ eventId: "A" })],
      now: NOW,
    });

    expect(result.kind).toBe("not-in-meeting");
  });

  it("does not treat Busy on its own as being in a call", () => {
    // Busy is also a focus block and an ordinary appointment. Prompting to
    // record during somebody's heads-down hour is how a feature gets turned
    // off for good.
    const result = resolveMeetingNow({
      presence: { availability: "Busy", activity: "Busy" },
      meetings: [meeting({ eventId: "A" })],
      now: NOW,
    });

    expect(result.kind).toBe("not-in-meeting");
  });

  it("says nothing when presence is missing entirely", () => {
    expect(resolveMeetingNow({ presence: null, meetings: [meeting({ eventId: "A" })], now: NOW }).kind).toBe(
      "not-in-meeting",
    );
  });
});

describe("resolveMeetingNow - naming the meeting", () => {
  it("names the one live meeting when a call is up", () => {
    const result = resolveMeetingNow({ presence: inACall, meetings: [meeting({ eventId: "A" })], now: NOW });

    expect(result).toMatchObject({ kind: "in-meeting", certainty: "confirmed" });
    expect(result.kind === "in-meeting" && result.meeting.eventId).toBe("A");
  });

  it("hedges when Teams only said InAMeeting", () => {
    // Teams derives InAMeeting from calendar state as well as from a real
    // join, so treating it as proof would let the calendar vouch for itself.
    // The meeting is still named; the wording on screen has to be softer.
    const result = resolveMeetingNow({
      presence: { availability: "Busy", activity: "InAMeeting" },
      meetings: [meeting({ eventId: "A" })],
      now: NOW,
    });

    expect(result).toMatchObject({ kind: "in-meeting", certainty: "scheduled-only" });
  });

  it("reports a call with nothing scheduled behind it", () => {
    // An ad hoc call, or somebody else's meeting joined by link. Worth
    // prompting about even though there is nothing to name.
    const result = resolveMeetingNow({ presence: inACall, meetings: [], now: NOW });

    expect(result.kind).toBe("in-unknown-call");
  });

  it("does NOT report an unknown call off InAMeeting alone", () => {
    // InAMeeting with an empty diary is Teams echoing a calendar with
    // nothing in it. That is a contradiction, not a call.
    const result = resolveMeetingNow({
      presence: { availability: "Busy", activity: "InAMeeting" },
      meetings: [],
      now: NOW,
    });

    expect(result.kind).toBe("not-in-meeting");
  });

  it("ignores diary entries that are not online meetings", () => {
    const result = resolveMeetingNow({
      presence: inACall,
      meetings: [meeting({ eventId: "A", isOnlineMeeting: false })],
      now: NOW,
    });

    expect(result.kind).toBe("in-unknown-call");
  });
});

// -------------------------------------------------------------------
// The window. People join early and meetings run over, and a prompt that
// vanishes at the scheduled end of a meeting still in progress is useless.
// -------------------------------------------------------------------
describe("resolveMeetingNow - the live window", () => {
  it("counts a meeting somebody joined early", () => {
    const soon = meeting({
      eventId: "A",
      startsAt: new Date(NOW.getTime() + JOIN_EARLY_MS - MINUTE),
      endsAt: new Date(NOW.getTime() + 60 * MINUTE),
    });

    expect(resolveMeetingNow({ presence: inACall, meetings: [soon], now: NOW }).kind).toBe("in-meeting");
  });

  it("counts a meeting that has run over", () => {
    const overrunning = meeting({
      eventId: "A",
      startsAt: new Date(NOW.getTime() - 90 * MINUTE),
      endsAt: new Date(NOW.getTime() - OVERRUN_MS + MINUTE),
    });

    expect(resolveMeetingNow({ presence: inACall, meetings: [overrunning], now: NOW }).kind).toBe("in-meeting");
  });

  it("drops one that has not started yet, or finished long ago", () => {
    const later = meeting({
      eventId: "A",
      startsAt: new Date(NOW.getTime() + JOIN_EARLY_MS + MINUTE),
      endsAt: new Date(NOW.getTime() + 90 * MINUTE),
    });
    const done = meeting({
      eventId: "B",
      startsAt: new Date(NOW.getTime() - 180 * MINUTE),
      endsAt: new Date(NOW.getTime() - OVERRUN_MS - MINUTE),
    });

    expect(resolveMeetingNow({ presence: inACall, meetings: [later, done], now: NOW }).kind).toBe(
      "in-unknown-call",
    );
  });
});

// -------------------------------------------------------------------
// Overlaps. The same rule the timesheet ask box follows: name the ambiguity
// rather than pick. Announcing a recording of the wrong meeting to a room of
// people is worse than admitting we cannot tell which one this is.
// -------------------------------------------------------------------
describe("resolveMeetingNow - overlapping meetings", () => {
  it("refuses to choose between two that have both started", () => {
    const result = resolveMeetingNow({
      presence: inACall,
      meetings: [meeting({ eventId: "A" }), meeting({ eventId: "B" })],
      now: NOW,
    });

    expect(result.kind).toBe("ambiguous");
    expect(result.kind === "ambiguous" && result.meetings.map((entry) => entry.eventId).sort()).toEqual(["A", "B"]);
  });

  it("prefers the one that has actually started over one only joining early", () => {
    // A cheap disambiguation that costs nothing and is right far more often
    // than not: the meeting in progress beats the one about to begin.
    const started = meeting({ eventId: "A" });
    const upcoming = meeting({
      eventId: "B",
      startsAt: new Date(NOW.getTime() + 5 * MINUTE),
      endsAt: new Date(NOW.getTime() + 60 * MINUTE),
    });

    const result = resolveMeetingNow({ presence: inACall, meetings: [started, upcoming], now: NOW });

    expect(result).toMatchObject({ kind: "in-meeting" });
    expect(result.kind === "in-meeting" && result.meeting.eventId).toBe("A");
  });
});

describe("isInCallActivity", () => {
  it("recognises the documented in-call activities", () => {
    for (const activity of ["InACall", "InAConferenceCall", "InAMeeting", "Presenting"]) {
      expect(isInCallActivity(activity)).toBe(true);
    }
  });

  it("rejects everything else, including an unknown one", () => {
    // An activity Microsoft adds later must not start firing this prompt on
    // its own. Silence is the safe direction here.
    for (const activity of ["Available", "Busy", "DoNotDisturb", "Offline", "SomethingNew", "", null, undefined]) {
      expect(isInCallActivity(activity)).toBe(false);
    }
  });
});
