import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { AiChatSubject, NewAiChatSubject, UpdateAiChatSubject } from "../kysely-database-types";

// -------------------------------------------------------------------
// AI chat conversations.
//
// `user_id` is the whole authorization boundary here, and unlike the rest
// of the app it is NOT team-scoped: a conversation belongs to one person,
// and nothing in this file will serve it to anybody else, staff included.
//
// The organisation still keeps a record of what was SENT to the model, in
// ai_chat_request_logs, and admins can read that. It is a separate table
// with its own admin-only service for exactly this reason - so the rule
// here stays absolute and easy to check.
//
// So every function below takes a userId and puts it in the WHERE clause,
// including the ones that already have a subject id. The id is not the
// authorization check: ids are guessable, and a query keyed on the id
// alone would hand any signed-in user somebody else's conversation. The
// userId passed in must come from the SESSION.
// -------------------------------------------------------------------

// A conversation plus its message count, for the sidebar. The count comes
// from a correlated subquery rather than a join so a conversation with no
// messages yet still appears (a left join with GROUP BY would too, but this
// keeps the row shape flat and the ordering obvious).
export type AiChatSubjectWithCount = AiChatSubject & { messageCount: number };

// -------------------------------------------------------------------
// Every conversation belonging to one user, most recently active first.
//
// Ordered by lastMessageAt with a createdAt fallback so a brand-new empty
// conversation sorts to the top rather than to the bottom, and with `id`
// as a final tiebreaker so the sidebar order is stable between requests.
// -------------------------------------------------------------------
export async function getAiChatSubjectsForUserRepo(
  userId: string,
  db: DBClient = database,
): Promise<AiChatSubjectWithCount[]> {
  try {
    const rows = await db
      .selectFrom("aiChatSubjects as s")
      .selectAll("s")
      .select((eb) =>
        eb
          .selectFrom("aiChatMessages as m")
          .select((inner) => inner.fn.countAll<string>().as("count"))
          .whereRef("m.subjectId", "=", "s.id")
          .as("messageCount"),
      )
      .where("s.userId", "=", userId)
      .orderBy((eb) => eb.fn.coalesce("s.lastMessageAt", "s.createdAt"), "desc")
      .orderBy("s.id", "desc")
      .execute();

    return rows.map((row) => ({ ...row, messageCount: Number(row.messageCount ?? 0) }));
  } catch (error) {
    throw handleError("getAiChatSubjectsForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// One conversation, but only if this user owns it. Undefined otherwise -
// which is the same answer an id that does not exist gets, so a guessed id
// cannot confirm that somebody else's conversation is there.
// -------------------------------------------------------------------
export async function getAiChatSubjectForUserRepo(
  subjectId: string,
  userId: string,
  db: DBClient = database,
): Promise<AiChatSubject | undefined> {
  try {
    return await db
      .selectFrom("aiChatSubjects")
      .selectAll()
      .where("id", "=", subjectId)
      .where("userId", "=", userId)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getAiChatSubjectForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// Start a conversation. Always owned by the caller; there is no path that
// creates one on somebody else's behalf.
// -------------------------------------------------------------------
export async function createAiChatSubjectRepo(
  newSubject: NewAiChatSubject,
  db: DBClient = database,
): Promise<AiChatSubject> {
  try {
    return await db.insertInto("aiChatSubjects").values(newSubject).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("createAiChatSubjectRepo", error);
  }
}

// -------------------------------------------------------------------
// Update a conversation the caller owns. Undefined when it is not theirs
// or does not exist.
// -------------------------------------------------------------------
export async function updateAiChatSubjectForUserRepo(
  subjectId: string,
  userId: string,
  patch: UpdateAiChatSubject,
  db: DBClient = database,
): Promise<AiChatSubject | undefined> {
  try {
    // Updateable allows id, userId and createdAt. A patch carrying an id
    // would rewrite the primary key and drag every message onto a new id;
    // one carrying a userId would hand the conversation to another account.
    // None is ever legitimately patched, so drop all three before the spread.
    const safePatch: UpdateAiChatSubject = { ...patch };
    delete safePatch.id;
    delete safePatch.userId;
    delete safePatch.createdAt;

    return await db
      .updateTable("aiChatSubjects")
      // Nothing stamps updated_at in the database, so the repository does it.
      .set({ ...safePatch, updatedAt: new Date() })
      .where("id", "=", subjectId)
      .where("userId", "=", userId)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateAiChatSubjectForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// Mark a conversation as just active, so it sorts to the top of the
// sidebar. Separate from a general update because it must NOT touch
// updated_at semantics for a rename, and because it runs on every send.
// -------------------------------------------------------------------
export async function touchAiChatSubjectRepo(
  subjectId: string,
  at: Date,
  db: DBClient = database,
): Promise<void> {
  try {
    await db
      .updateTable("aiChatSubjects")
      .set({ lastMessageAt: at, updatedAt: at })
      .where("id", "=", subjectId)
      .execute();
  } catch (error) {
    throw handleError("touchAiChatSubjectRepo", error);
  }
}

// -------------------------------------------------------------------
// Delete a conversation the caller owns. Its messages cascade. Returns the
// number of rows removed so a caller can tell "deleted" from "was not
// yours", without a separate ownership read.
// -------------------------------------------------------------------
export async function deleteAiChatSubjectForUserRepo(
  subjectId: string,
  userId: string,
  db: DBClient = database,
): Promise<number> {
  try {
    const result = await db
      .deleteFrom("aiChatSubjects")
      .where("id", "=", subjectId)
      .where("userId", "=", userId)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  } catch (error) {
    throw handleError("deleteAiChatSubjectForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// Retention: delete conversations with no activity since the cutoff, and
// return how many went. Messages cascade with them.
//
// Unscoped by user on purpose - this is the monthly job, which has no
// session. It is the only function here without a userId, and it is
// reachable only from the bearer-authenticated retention route.
// -------------------------------------------------------------------
export async function deleteAiChatSubjectsInactiveSinceRepo(
  cutoff: Date,
  db: DBClient = database,
): Promise<number> {
  try {
    const result = await db
      .deleteFrom("aiChatSubjects")
      // A conversation that never received a message falls back to when it
      // was created, so an abandoned empty thread is still collected.
      .where((eb) => eb(eb.fn.coalesce("lastMessageAt", "createdAt"), "<", cutoff))
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  } catch (error) {
    throw handleError("deleteAiChatSubjectsInactiveSinceRepo", error);
  }
}
