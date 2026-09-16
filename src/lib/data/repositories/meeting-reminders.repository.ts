import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { NewMeetingRecordingReminder } from "../kysely-database-types";

// -------------------------------------------------------------------
// ===================================================================
// WHO HAS ALREADY BEEN TOLD TO PRESS RECORD
// ===================================================================
//
// One row per person per meeting. The whole table exists to make a send
// happen once - see migration 031 for why that is harder than it sounds.
//
// NO READ SCOPED BY USER, and that is not an omission. Nothing displays
// these rows: they are a claim the sweep makes against itself, and the only
// questions asked of them are "may I send this" and "which are old enough to
// drop". A read returning somebody's meetings by id would be a list of who
// was in what, which is not what this is for and not something any screen
// needs.
// -------------------------------------------------------------------

/**
 * Claim the right to nudge this person about this meeting.
 *
 * Returns true when the caller may send, false when somebody else already
 * has. INSERT ... ON CONFLICT DO NOTHING rather than a check and then a
 * write, because the two sweeps that matter are the overlapping ones: a slow
 * run and the next one on the timer, or two instances after a scale out. A
 * check-then-send races there and sends twice; an insert cannot.
 *
 * WHOEVER INSERTS THE ROW OWNS THE SEND, which is the same shape
 * claimTranscriptionFilingRepo and the transition claim use, for the same
 * reason.
 *
 * The claim is made BEFORE the push, deliberately. A push that fails after
 * the row is written means one missed notification; a row written after a
 * successful push means a crash in between sends it again on the next sweep,
 * and an unwanted duplicate is worse than a miss here - the miss is
 * recoverable by the person simply pressing record, which is what they were
 * going to do anyway.
 */
export async function claimMeetingReminderRepo(
  reminder: NewMeetingRecordingReminder,
  db: DBClient = database,
): Promise<boolean> {
  try {
    const inserted = await db
      .insertInto("meetingRecordingReminders")
      .values(reminder)
      .onConflict((conflict) => conflict.columns(["userId", "eventId"]).doNothing())
      .returning("id")
      .executeTakeFirst();

    return inserted !== undefined;
  } catch (error) {
    throw handleError("claimMeetingReminderRepo", error);
  }
}

/**
 * Drop rows for meetings that started before `cutoff`.
 *
 * Retention rather than tidiness. The window the sweep looks back over is
 * minutes wide, so a row older than a day can never be consulted again - and
 * keeping it would leave this table a record of who was in which meeting,
 * accumulating for ever, for no reader.
 *
 * Keyed on `starts_at` rather than `sent_at` because the question is "could
 * this still be in a window", and the window is about the meeting.
 */
export async function deleteMeetingRemindersBeforeRepo(
  cutoff: Date,
  db: DBClient = database,
): Promise<number> {
  try {
    const result = await db
      .deleteFrom("meetingRecordingReminders")
      .where("startsAt", "<", cutoff)
      .executeTakeFirst();

    return Number(result?.numDeletedRows ?? 0);
  } catch (error) {
    throw handleError("deleteMeetingRemindersBeforeRepo", error);
  }
}
