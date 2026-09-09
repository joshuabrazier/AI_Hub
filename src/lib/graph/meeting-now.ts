// -------------------------------------------------------------------
// Which meeting are you in right now?
//
// Two signals, neither sufficient alone, and the whole module exists because
// combining them is a judgement rather than an intersection.
//
//   PRESENCE says you are in a call. It does not say WHICH call, and it
//   cannot tell a Teams meeting from a one-to-one call, a phone call routed
//   through Teams, or somebody screen-sharing at you.
//
//   THE CALENDAR says a meeting is scheduled now. It does not say you turned
//   up. Half the diary is meetings people decline by not going.
//
// So: presence decides WHETHER to prompt, the calendar decides WHAT to name.
// Neither is trusted on its own, and where they disagree the prompt says
// less rather than guessing.
//
// WHY THIS MATTERS MORE THAN IT LOOKS. The prompt this feeds asks somebody to
// start transcription in a live meeting with other people in it. Firing it
// during a client call that was not on the calendar, and naming it after
// whatever else was scheduled at the time, would have somebody announce a
// recording of the wrong meeting to a room of people. Getting it silent is a
// nuisance; getting it confidently wrong is embarrassing in front of a client.
//
// Pure, so all of that is testable without a tenant.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Graph presence activities that mean "in something with other people".
//
// From the documented set on /me/presence. Deliberately NOT a catch-all on
// availability being Busy: Busy is also what a focus block or an ordinary
// appointment sets, and prompting to record during somebody's heads-down
// hour is exactly the noise that gets a feature switched off.
//
// InAMeeting is included and is the loosest of these - Teams sets it from
// calendar state as well as from an actual join - which is why it never
// prompts on its own; the calendar still has to agree. Presenting is
// included because screen-sharing is the middle of a meeting by definition.
// -------------------------------------------------------------------
const IN_CALL_ACTIVITIES = new Set(["InACall", "InAConferenceCall", "InAMeeting", "Presenting"]);

export function isInCallActivity(activity: string | null | undefined): boolean {
  return activity != null && IN_CALL_ACTIVITIES.has(activity.trim());
}

// An activity that means we are certain a call is up, rather than inferring
// it from the diary. InAMeeting is excluded here for the reason above: Teams
// sets it from the calendar, so treating it as proof would make the calendar
// vouch for itself.
const CERTAIN_IN_CALL = new Set(["InACall", "InAConferenceCall", "Presenting"]);

export interface PresenceSnapshot {
  availability: string | null;
  activity: string | null;
}

export interface ScheduledMeeting {
  eventId: string;
  subject: string;
  joinUrl: string | null;
  startsAt: Date;
  endsAt: Date;
  isOnlineMeeting: boolean;
}

// -------------------------------------------------------------------
// How far either side of the scheduled time a meeting still counts as "on".
//
// People join early and meetings run over, and the prompt is useless if it
// disappears at the scheduled end of a meeting that is still going. Narrower
// than the transcript-matching window in teams-occurrence.ts on purpose:
// that one is deciding which of several past occurrences a transcript
// belongs to, this one is deciding whether to interrupt somebody now.
// -------------------------------------------------------------------
export const JOIN_EARLY_MS = 10 * 60 * 1000;
export const OVERRUN_MS = 30 * 60 * 1000;

export type MeetingNow =
  // In a call, and one scheduled meeting matches it. The only case that
  // names a meeting.
  | { kind: "in-meeting"; meeting: ScheduledMeeting; certainty: "confirmed" | "scheduled-only" }
  // In a call that matches nothing in the diary - an ad hoc call, or someone
  // else's meeting joined by link. Worth prompting about; there is nothing
  // to name and nothing of ours to import afterwards.
  | { kind: "in-unknown-call" }
  // Presence says a call is up and SEVERAL meetings overlap. Named as
  // ambiguous rather than picked: the same rule the timesheet ask box
  // follows, because presenting one of two possible meetings as the answer
  // is worse than saying which two.
  | { kind: "ambiguous"; meetings: ScheduledMeeting[] }
  | { kind: "not-in-meeting" };

export function resolveMeetingNow(input: {
  presence: PresenceSnapshot | null;
  meetings: readonly ScheduledMeeting[];
  now: Date;
}): MeetingNow {
  const { presence, meetings, now } = input;

  // Presence is the gate. Without it we would prompt on every diary entry,
  // including the ones nobody went to.
  if (!isInCallActivity(presence?.activity)) return { kind: "not-in-meeting" };

  const certain = presence?.activity != null && CERTAIN_IN_CALL.has(presence.activity.trim());

  const at = now.getTime();

  const live = meetings.filter((meeting) => {
    if (!meeting.isOnlineMeeting) return false;

    return at >= meeting.startsAt.getTime() - JOIN_EARLY_MS && at <= meeting.endsAt.getTime() + OVERRUN_MS;
  });

  if (live.length === 0) {
    // A call with nothing scheduled behind it. Only reported when presence
    // is CERTAIN: InAMeeting with an empty diary is Teams echoing a calendar
    // that has nothing in it, which is a contradiction rather than a call.
    return certain ? { kind: "in-unknown-call" } : { kind: "not-in-meeting" };
  }

  if (live.length === 1) {
    return {
      kind: "in-meeting",
      meeting: live[0],
      // Says how much the prompt may claim. "confirmed" means presence saw a
      // real call; "scheduled-only" means Teams reported InAMeeting, which
      // it derives from the diary - so the wording has to hedge.
      certainty: certain ? "confirmed" : "scheduled-only",
    };
  }

  // Overlapping meetings. Prefer one that has actually started over one that
  // is only within its join-early grace, since that is the likelier answer
  // and costs nothing to check.
  const started = live.filter((meeting) => at >= meeting.startsAt.getTime());

  if (started.length === 1) {
    return { kind: "in-meeting", meeting: started[0], certainty: certain ? "confirmed" : "scheduled-only" };
  }

  return { kind: "ambiguous", meetings: [...(started.length > 0 ? started : live)] };
}
