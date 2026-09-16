import "server-only";

import { randomUUID } from "node:crypto";

import { listTeamsMeetingsStartingBetween } from "@/lib/graph/teams-meetings";
import {
  claimMeetingReminderRepo,
  deleteMeetingRemindersBeforeRepo,
} from "@/lib/data/repositories/meeting-reminders.repository";
import { getUserIdsWithPushSubscriptionsRepo } from "@/lib/data/repositories/push-subscriptions.repository";
import { isPushConfigured, sendPushToUser } from "@/lib/push/push-notifications";
import { ROUTES } from "@/lib/routes";

import {
  REMINDER_RETENTION_DAYS,
  reminderMessage,
  reminderWindow,
  shouldRemind,
  type ReminderSkip,
} from "./meeting-reminder";

// -------------------------------------------------------------------
// ===================================================================
// "TURN THE RECORDING ON"
// ===================================================================
//
// Runs on the same timer as the transcription sweep. For everybody with a
// device registered, it reads the meetings that have just started and pushes
// a nudge to press record in Teams.
//
// WHY IT CAN RUN AT ALL WITH NOBODY SIGNED IN. getDelegatedGraphToken mints
// a token for an absent user from Better Auth's stored refresh token - see
// the long note in graph-token.ts. That file also states the rule this
// service has to obey: the headerless form is a privileged path and must
// never be reachable from a request carrying a user id. Every id here comes
// from the push_subscriptions table, and nothing about this entry point
// takes an argument.
//
// THE SUBSCRIPTION LIST IS THE OPT-IN. A push subscription only exists
// because somebody granted notification permission on a device, so the
// sweep's population is exactly the people who asked to be notified. There
// is no separate preference to forget to check, and turning notifications
// off at the browser turns this off with them.
//
// ONE PERSON'S FAILURE IS NOT EVERYBODY'S. A revoked refresh token, a
// Conditional Access policy, a Graph outage on one mailbox: each is caught
// per user so the loop carries on. The alternative is one person with an
// expired consent silently stopping the notification for the whole company,
// which is the kind of fault nobody finds for a month.
//
// IT REPORTS COUNTS AND THEY ARE THE POINT. This is a feature nobody notices
// working, so a sweep that sends nothing must be distinguishable from a
// sweep that is broken. "48 considered, 0 sent, 48 not-our-meeting" is
// healthy; "0 considered" is a deployment where nobody ever granted
// permission; "12 failed" is a consent problem worth chasing.
// -------------------------------------------------------------------

export type MeetingReminderSweepResult = {
  /** People with at least one registered device. */
  subscribers: number;
  /** Meetings inspected across all of them. */
  considered: number;
  /** Notifications actually handed to a push service. */
  sent: number;
  /** Already claimed by an earlier run, so not sent again. */
  alreadySent: number;
  /** Why the rest were passed over. */
  skipped: Record<ReminderSkip, number>;
  /** People whose calendar could not be read at all. */
  failed: number;
  /** Old claim rows removed. */
  expired: number;
};

const emptySkips = (): Record<ReminderSkip, number> => ({
  "not-started": 0,
  "too-old": 0,
  "already-over": 0,
  "not-our-meeting": 0,
});

export async function sweepMeetingRecordingRemindersService(
  options: { now?: Date } = {},
): Promise<MeetingReminderSweepResult> {
  const now = options.now ?? new Date();

  const result: MeetingReminderSweepResult = {
    subscribers: 0,
    considered: 0,
    sent: 0,
    alreadySent: 0,
    skipped: emptySkips(),
    failed: 0,
    expired: 0,
  };

  // Inert rather than broken without VAPID keys, matching how the rest of
  // the push feature behaves. Reading calendars to send nothing would be a
  // Graph call per person per minute for no result.
  if (!isPushConfigured()) return result;

  const userIds = await getUserIdsWithPushSubscriptionsRepo();

  result.subscribers = userIds.length;

  const { from, to } = reminderWindow(now);

  for (const userId of userIds) {
    try {
      const meetings = await listTeamsMeetingsStartingBetween(userId, from, to);

      for (const meeting of meetings) {
        result.considered += 1;

        const decision = shouldRemind(meeting, now);

        if (!decision.send) {
          result.skipped[decision.because] += 1;
          continue;
        }

        // CLAIMED BEFORE THE SEND. A push that fails after the row is
        // written costs one missed nudge; a row written after a successful
        // push means a crash in between sends it again next sweep. The
        // duplicate is the worse of the two - the miss is recoverable by
        // somebody simply pressing record, which is what they were about to
        // do anyway.
        const mine = await claimMeetingReminderRepo({
          id: randomUUID(),
          userId,
          eventId: meeting.eventId,
          subject: meeting.subject,
          startsAt: meeting.startsAt,
        });

        if (!mine) {
          result.alreadySent += 1;
          continue;
        }

        const message = reminderMessage(meeting.subject);

        await sendPushToUser(userId, {
          ...message,
          // The transcription screen, because the next thing this person
          // does after pressing record in Teams is import it from there.
          // A fixed path is safe: the proxy sends a role to its own area,
          // and every page does its own session check.
          url: ROUTES.PORTAL_TRANSCRIPTION,
          // Replaces rather than stacks, so a second device or a re-send
          // cannot leave two of these on one screen.
          tag: `meeting-recording-${meeting.eventId}`,
          // THE ONE CASE requireInteraction IS FOR, and its own comment on
          // PushMessage says so: the moment cannot be recovered. A nudge
          // that auto-dismisses while somebody is joining a call is a nudge
          // that did not happen.
          requireInteraction: true,
        });

        result.sent += 1;
      }
    } catch (error) {
      // Per person, so one expired consent cannot stop everybody else's.
      result.failed += 1;

      console.warn(
        `sweepMeetingRecordingRemindersService: could not read meetings for ${userId}`,
        error,
      );
    }
  }

  // Claim rows outlive their usefulness the moment they fall out of the
  // window, and this table is otherwise a growing record of who was in what.
  try {
    const cutoff = new Date(now.getTime() - REMINDER_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    result.expired = await deleteMeetingRemindersBeforeRepo(cutoff);
  } catch (error) {
    // Retention failing must not fail the sweep: the notifications went out,
    // which is the part somebody is waiting on.
    console.warn("sweepMeetingRecordingRemindersService: could not expire old reminders", error);
  }

  return result;
}
