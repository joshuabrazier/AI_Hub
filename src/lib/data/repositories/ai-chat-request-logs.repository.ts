import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { AiChatRequestLog, NewAiChatRequestLog } from "../kysely-database-types";

// -------------------------------------------------------------------
// The record of what was actually sent to the model.
//
// Unlike the rest of the chat repositories, the reads here are NOT scoped to
// a session user - this table exists so an admin can review everybody's
// calls, and the guard is the admin role check in its service. That makes
// this the one chat table where a missing guard leaks other people's
// conversations, so do not add a caller that skips it.
//
// The writes are append-only. Nothing updates or edits a log row: a record of
// what was sent is worth having only if it cannot be quietly rewritten
// afterwards.
// -------------------------------------------------------------------

// How much of one payload is stored. Generous - a normal thread is far under
// it, and compaction keeps it that way - but bounded, because every send logs
// the whole conversation and an unbounded row could otherwise reach the size
// of the conversation itself. A row that hits this is marked `truncated` so it
// is never mistaken for the complete request.
const MAX_LOGGED_PAYLOAD_CHARS = 1_000_000;

export type AiChatRequestLogFilter = {
  // Absent means every user - the default view.
  userId?: string;
  limit: number;
  offset: number;
};

// A log row joined with who made it, so the list does not need a second pass
// to name people. `userName` is the account's name at READ time, not a
// snapshot: the audit log is the append-only trail, this is an operational
// view, and showing the current name is what makes the filter make sense.
export type AiChatRequestLogWithUser = AiChatRequestLog & {
  userName: string;
  userEmail: string;
};

// -------------------------------------------------------------------
// Append one record. Called after every model request, successful or not.
//
// Takes the payload already serialised so the caller decides what "the
// request" was; this only bounds and stores it.
// -------------------------------------------------------------------
export async function addAiChatRequestLogRepo(
  newLog: NewAiChatRequestLog,
  db: DBClient = database,
): Promise<void> {
  try {
    await db.insertInto("aiChatRequestLogs").values(newLog).execute();
  } catch (error) {
    throw handleError("addAiChatRequestLogRepo", error);
  }
}

// -------------------------------------------------------------------
// Bound a serialised payload, reporting whether anything was dropped.
//
// Exported so the caller can set `truncated` from the same decision that
// shortened the text - two places deciding separately is how a truncated row
// ends up flagged as complete.
// -------------------------------------------------------------------
export function boundPayload(serialised: string): { value: string; truncated: boolean } {
  if (serialised.length <= MAX_LOGGED_PAYLOAD_CHARS) {
    return { value: serialised, truncated: false };
  }

  return { value: serialised.slice(0, MAX_LOGGED_PAYLOAD_CHARS), truncated: true };
}

// -------------------------------------------------------------------
// The log, newest first, optionally for one person.
//
// Paged: this table grows with the square of thread length (every send logs
// the whole conversation), so an unbounded read would eventually be the
// largest query in the app.
// -------------------------------------------------------------------
export async function getAiChatRequestLogsRepo(
  filter: AiChatRequestLogFilter,
  db: DBClient = database,
): Promise<AiChatRequestLogWithUser[]> {
  try {
    let query = db
      .selectFrom("aiChatRequestLogs as l")
      .innerJoin("users as u", "u.id", "l.userId")
      .selectAll("l")
      .select(["u.name as userName", "u.email as userEmail"]);

    if (filter.userId) {
      query = query.where("l.userId", "=", filter.userId);
    }

    return await query
      .orderBy("l.createdAt", "desc")
      // Stable paging: several calls can land in the same microsecond, and
      // without the tiebreaker a row can repeat or vanish between pages.
      .orderBy("l.id", "desc")
      .limit(filter.limit)
      .offset(filter.offset)
      .execute();
  } catch (error) {
    throw handleError("getAiChatRequestLogsRepo", error);
  }
}

// -------------------------------------------------------------------
// How many rows match, so the viewer can page honestly rather than guessing
// from whether the last page was full.
// -------------------------------------------------------------------
export async function countAiChatRequestLogsRepo(
  userId: string | undefined,
  db: DBClient = database,
): Promise<number> {
  try {
    let query = db.selectFrom("aiChatRequestLogs").select((eb) => eb.fn.countAll<string>().as("count"));

    if (userId) {
      query = query.where("userId", "=", userId);
    }

    const row = await query.executeTakeFirstOrThrow();

    return Number(row.count);
  } catch (error) {
    throw handleError("countAiChatRequestLogsRepo", error);
  }
}

// -------------------------------------------------------------------
// One log row with its full payload, for the detail view.
//
// Unscoped by design - see the note at the top of this file. Its only caller
// checks for the admin role first, and records the read in the audit log.
// -------------------------------------------------------------------
export async function getAiChatRequestLogByIdRepo(
  id: string,
  db: DBClient = database,
): Promise<AiChatRequestLogWithUser | undefined> {
  try {
    return await db
      .selectFrom("aiChatRequestLogs as l")
      .innerJoin("users as u", "u.id", "l.userId")
      .selectAll("l")
      .select(["u.name as userName", "u.email as userEmail"])
      .where("l.id", "=", id)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getAiChatRequestLogByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// Everyone who has ever made a call, for the filter dropdown.
//
// Distinct over the log rather than over users, so the list is only people
// who actually have something to look at.
// -------------------------------------------------------------------
export async function getAiChatRequestLogUsersRepo(
  db: DBClient = database,
): Promise<{ id: string; name: string; email: string; requestCount: number }[]> {
  try {
    const rows = await db
      .selectFrom("aiChatRequestLogs as l")
      .innerJoin("users as u", "u.id", "l.userId")
      .select((eb) => [
        "u.id as id",
        "u.name as name",
        "u.email as email",
        eb.fn.countAll<string>().as("requestCount"),
      ])
      .groupBy(["u.id", "u.name", "u.email"])
      .orderBy("u.name")
      .execute();

    return rows.map((row) => ({ ...row, requestCount: Number(row.requestCount) }));
  } catch (error) {
    throw handleError("getAiChatRequestLogUsersRepo", error);
  }
}

// -------------------------------------------------------------------
// Retention: drop log rows older than the cutoff, returning how many went.
//
// Unscoped by user on purpose - the monthly job has no session. This is the
// main control on the table's size, because it grows quadratically with
// thread length.
// -------------------------------------------------------------------
export async function deleteAiChatRequestLogsOlderThanRepo(
  cutoff: Date,
  db: DBClient = database,
): Promise<number> {
  try {
    const result = await db
      .deleteFrom("aiChatRequestLogs")
      .where("createdAt", "<", cutoff)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  } catch (error) {
    throw handleError("deleteAiChatRequestLogsOlderThanRepo", error);
  }
}
