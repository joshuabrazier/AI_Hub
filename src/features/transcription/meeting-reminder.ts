import { isEmailDomainAllowed } from "@/lib/auth/account-creation-policy";
import type { TeamsMeetingSummary } from "@/lib/graph/teams-meetings";

// -------------------------------------------------------------------
// ===================================================================
// WHICH MEETINGS ARE WORTH A "TURN THE RECORDING ON" PUSH
// ===================================================================
//
// Pure, and separated from the sweep for the usual reason in this module:
// it is the part that can be tested without a tenant, a meeting and a live
// token, and it is where every decision worth arguing about lives.
//
// THE SWEEP LOOKS BACKWARDS, and that is the shape to understand first. It
// runs on a timer, so it cannot fire AT a start time - it fires shortly
// after one. So it asks "which meetings started in the last few minutes"
// rather than "which meeting starts now", and the window has to be wider
// than the timer interval or a meeting that starts between two runs is
// missed entirely.
//
// A WIDE WINDOW IS SAFE ONLY BECAUSE THE SEND IS CLAIMED. The same meeting
// is in range on several consecutive runs; the unique constraint on
// (user_id, event_id) is what turns that into one notification. Widen the
// window freely; never remove the claim.
// -------------------------------------------------------------------

/**
 * How far back a sweep looks for a meeting that has just begun.
 *
 * TEN MINUTES, against a timer meant to run every minute or two. The margin
 * is deliberate and is not about precision: it is what makes a missed run,
 * a slow run, or a deploy in the middle of the hour cost nothing. A meeting
 * that started eight minutes ago is still worth a nudge, because the
 * recording captures from the moment it starts and eight minutes of a
 * half-hour meeting is better than none.
 */
export const REMINDER_LOOKBACK_MINUTES = 10;

/**
 * And how far FORWARD, which is zero on purpose.
 *
 * Nudging before the start was considered and rejected: you cannot press
 * record in a meeting nobody has joined, so an early notification is one
 * somebody has to remember to act on later, which is the thing the
 * notification exists to replace.
 */
export const REMINDER_LOOKAHEAD_MINUTES = 0;

/**
 * How long a reminder row is kept before the sweep drops it.
 *
 * Only long enough that the window can never reach back past it. A day is
 * far more than the ten minutes above needs, and keeping a record of
 * somebody's meetings for longer would make this a log of who was in what,
 * which is not what it is for.
 */
export const REMINDER_RETENTION_DAYS = 1;

const MINUTE = 60 * 1000;

/** The window a sweep at `now` considers. Exported so the tests can state it. */
export function reminderWindow(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - REMINDER_LOOKBACK_MINUTES * MINUTE),
    to: new Date(now.getTime() + REMINDER_LOOKAHEAD_MINUTES * MINUTE),
  };
}

// -------------------------------------------------------------------
// WHY A MEETING IS SKIPPED, as a value rather than a boolean.
//
// A sweep that quietly sends nothing is indistinguishable from one that is
// broken, and this is a feature nobody notices working. The reason travels
// so the job can log a count per reason - "47 skipped: not ours" is a
// working sweep, and "47 skipped: no push subscription" is a deployment
// where nobody ever granted permission.
// -------------------------------------------------------------------
export type ReminderSkip =
  | "not-started"
  | "too-old"
  | "already-over"
  | "not-our-meeting";

export type ReminderDecision = { send: true } | { send: false; because: ReminderSkip };

/**
 * Should this person be nudged about this meeting?
 *
 * `organiser` is checked against the account-creation allowlist, which is
 * the app's one definition of "somebody here". That is not tidiness: the
 * Teams import only works for meetings THIS TENANT hosted and transcribed,
 * so a nudge to record a client-hosted call asks for something that cannot
 * be delivered - the transcript would belong to their tenant and we could
 * never fetch it.
 *
 * WITH NO ALLOWLIST CONFIGURED, isEmailDomainAllowed answers true for
 * everything, so every meeting is treated as ours. That matches how the rest
 * of the app reads an unset allowlist - no restriction - and it fails
 * towards a notification too many rather than a silence nobody can explain.
 */
export function shouldRemind(meeting: TeamsMeetingSummary, now: Date): ReminderDecision {
  const { from, to } = reminderWindow(now);
  const startedAt = meeting.startsAt.getTime();

  if (startedAt > to.getTime()) return { send: false, because: "not-started" };
  if (startedAt < from.getTime()) return { send: false, because: "too-old" };

  // A meeting whose end time has passed cannot be recorded, whatever the
  // window says. This catches the short meeting that began and finished
  // between two sweeps, and the one somebody shortened after it started.
  if (meeting.endsAt.getTime() <= now.getTime()) {
    return { send: false, because: "already-over" };
  }

  // No organiser at all is treated as not ours. Graph populates it for every
  // real event, so an absent one is an event shape we do not understand, and
  // guessing in favour of sending would nudge people about calls they cannot
  // record.
  if (!meeting.organiser || !isEmailDomainAllowed(meeting.organiser)) {
    return { send: false, because: "not-our-meeting" };
  }

  return { send: true };
}

// -------------------------------------------------------------------
// What the notification says.
//
// IT NAMES THE MEETING, because a phone showing "Start the recording" with
// no subject is a notification somebody has to open the app to understand -
// and by the time they have, the thing it was asking for is late.
//
// IT SAYS WHERE TO PRESS IT. The app cannot start a recording: Teams is what
// announces one to the room, and a recording that started without the room
// being told is not a thing this app will ever do. So the words ask for an
// action in Teams rather than offering a button here.
// -------------------------------------------------------------------
export function reminderMessage(subject: string): { title: string; body: string } {
  const named = subject.trim().length > 0 ? subject.trim() : "Your meeting";

  return {
    title: "Start the recording",
    body: `${named} has started. Turn on recording and transcription in Teams, or there will be no transcript to import.`,
  };
}
