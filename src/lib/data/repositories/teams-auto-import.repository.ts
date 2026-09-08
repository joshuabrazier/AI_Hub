import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import {
  NewTeamsAutoImport,
  TEAMS_AUTO_IMPORT_STATUSES,
  TeamsAutoImport,
  TeamsAutoImportStatus,
} from "../kysely-database-types";

// -------------------------------------------------------------------
// Standing intents to import a Teams meeting once it has ended.
//
// Every read here is scoped by user_id or is the sweep's own due-work query.
// There is deliberately no "get by id" without an owner: a row names whose
// token an import will run on, so a caller that could fetch somebody else's
// row could cause a transcript to be fetched as them.
// -------------------------------------------------------------------

export async function armTeamsAutoImportRepo(
  row: NewTeamsAutoImport,
  db: DBClient = database,
): Promise<TeamsAutoImport> {
  try {
    // ARMING TWICE IS NORMAL, not an error. Two tabs, a reload, or somebody
    // dismissing the prompt and confirming again on the next poll all land
    // here. The unique constraint turns that into an update, and re-arming a
    // row that had given up puts it back to pending - which is what somebody
    // pressing the button again plainly means.
    return await db
      .insertInto("teamsAutoImport")
      .values(row)
      .onConflict((oc) =>
        oc.columns(["userId", "eventId"]).doUpdateSet({
          subject: row.subject,
          endsAt: row.endsAt,
          status: TEAMS_AUTO_IMPORT_STATUSES.PENDING,
          attempts: 0,
          lastAttemptAt: null,
          error: null,
          updatedAt: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("armTeamsAutoImportRepo", error);
  }
}

// -------------------------------------------------------------------
// What the sweep should look at: still pending, and the meeting is over.
//
// Ordered by ends_at so the longest-waiting meeting is tried first, and
// capped, because one scheduled run must not turn into an unbounded number
// of Graph calls.
// -------------------------------------------------------------------
export async function getDueTeamsAutoImportsRepo(
  endedBefore: Date,
  limit: number,
): Promise<TeamsAutoImport[]> {
  try {
    return await database
      .selectFrom("teamsAutoImport")
      .selectAll()
      .where("status", "=", TEAMS_AUTO_IMPORT_STATUSES.PENDING)
      .where("endsAt", "<=", endedBefore)
      .orderBy("endsAt", "asc")
      .limit(limit)
      .execute();
  } catch (error) {
    throw handleError("getDueTeamsAutoImportsRepo", error);
  }
}

export async function getTeamsAutoImportsForUserRepo(
  userId: string,
  limit: number,
): Promise<TeamsAutoImport[]> {
  try {
    return await database
      .selectFrom("teamsAutoImport")
      .selectAll()
      .where("userId", "=", userId)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .execute();
  } catch (error) {
    throw handleError("getTeamsAutoImportsForUserRepo", error);
  }
}

export async function getTeamsAutoImportForMeetingRepo(
  userId: string,
  eventId: string,
): Promise<TeamsAutoImport | undefined> {
  try {
    return await database
      .selectFrom("teamsAutoImport")
      .selectAll()
      .where("userId", "=", userId)
      .where("eventId", "=", eventId)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getTeamsAutoImportForMeetingRepo", error);
  }
}

// -------------------------------------------------------------------
// Record the outcome of one attempt.
//
// SCOPED BY user_id AS WELL AS id, every time. The sweep already read the row
// and has its owner in hand, so passing it costs nothing and means no update
// here can touch a row belonging to somebody else even if an id were wrong.
// -------------------------------------------------------------------
export async function settleTeamsAutoImportRepo(
  input: {
    id: string;
    userId: string;
    status: TeamsAutoImportStatus;
    transcriptionId?: string | null;
    error?: string | null;
  },
  db: DBClient = database,
): Promise<void> {
  try {
    await db
      .updateTable("teamsAutoImport")
      .set({
        status: input.status,
        transcriptionId: input.transcriptionId ?? null,
        error: input.error ?? null,
        lastAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where("id", "=", input.id)
      .where("userId", "=", input.userId)
      .execute();
  } catch (error) {
    throw handleError("settleTeamsAutoImportRepo", error);
  }
}

// -------------------------------------------------------------------
// An attempt that found nothing yet and will be tried again.
//
// The counter is incremented in SQL rather than read-then-written, so two
// sweeps overlapping cannot both write attempts = n + 1 off the same n and
// lose a try. Overlapping sweeps should not happen, but a lost increment
// would show up as a meeting polled forever, which is exactly what the
// counter exists to prevent.
// -------------------------------------------------------------------
export async function recordTeamsAutoImportAttemptRepo(
  input: { id: string; userId: string; error?: string | null },
  db: DBClient = database,
): Promise<void> {
  try {
    await db
      .updateTable("teamsAutoImport")
      .set((eb) => ({
        attempts: eb("attempts", "+", 1),
        lastAttemptAt: new Date(),
        error: input.error ?? null,
        updatedAt: new Date(),
      }))
      .where("id", "=", input.id)
      .where("userId", "=", input.userId)
      .execute();
  } catch (error) {
    throw handleError("recordTeamsAutoImportAttemptRepo", error);
  }
}

export async function cancelTeamsAutoImportRepo(userId: string, eventId: string): Promise<void> {
  try {
    await database
      .updateTable("teamsAutoImport")
      .set({ status: TEAMS_AUTO_IMPORT_STATUSES.CANCELLED, updatedAt: new Date() })
      .where("userId", "=", userId)
      .where("eventId", "=", eventId)
      .where("status", "=", TEAMS_AUTO_IMPORT_STATUSES.PENDING)
      .execute();
  } catch (error) {
    throw handleError("cancelTeamsAutoImportRepo", error);
  }
}
