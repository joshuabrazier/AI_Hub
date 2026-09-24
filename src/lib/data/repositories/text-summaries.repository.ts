import "server-only";

import { database, type DBClient } from "@/lib/data/kysely-database-client";
import type {
  NewTextSummary,
  TextSummary,
  UpdateTextSummary,
} from "@/lib/data/kysely-database-types";
import { handleError } from "@/lib/handle-errors";

// -------------------------------------------------------------------
// ===================================================================
// SAVED SUMMARIES
// ===================================================================
//
// EVERY READ IS SCOPED BY userId, in the WHERE clause and not by a check
// afterwards. This table holds whatever somebody pasted in - a contract, a
// client's board paper - so one person reaching another's row is the worst
// thing this feature can do, and the only defence that cannot be forgotten
// is the one the query itself carries.
//
// There is deliberately no "get by id" without an owner, and no listing
// across owners. An admin screen over this table would be a different
// decision from the one that was made, and adding one should mean saying so
// out loud rather than finding a convenient function already here.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// The list omits the two heavy columns.
//
// `sourceText` can be 400,000 characters and `summary` several thousand, so
// selecting them for a list of forty rows is megabytes of content crossing
// the wire to render a set of titles. The `title` and `inputChars` columns
// exist precisely so this query never has to.
// -------------------------------------------------------------------
export type TextSummaryListRow = Omit<TextSummary, "sourceText" | "summary">;

const LIST_COLUMNS = [
  "id",
  "userId",
  "title",
  "style",
  "error",
  "inputChars",
  "createdAt",
  "updatedAt",
  "completedAt",
] as const;

export async function addTextSummaryRepo(
  summary: NewTextSummary,
  db: DBClient = database,
): Promise<TextSummary> {
  try {
    return await db.insertInto("textSummaries").values(summary).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addTextSummaryRepo", error);
  }
}

export async function getTextSummaryForUserRepo(
  summaryId: string,
  userId: string,
  db: DBClient = database,
): Promise<TextSummary | undefined> {
  try {
    return await db
      .selectFrom("textSummaries")
      .selectAll()
      .where("id", "=", summaryId)
      .where("userId", "=", userId)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getTextSummaryForUserRepo", error);
  }
}

export async function getTextSummariesForUserRepo(
  userId: string,
  limit: number,
  db: DBClient = database,
): Promise<TextSummaryListRow[]> {
  try {
    return await db
      .selectFrom("textSummaries")
      .select(LIST_COLUMNS)
      .where("userId", "=", userId)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .execute();
  } catch (error) {
    throw handleError("getTextSummariesForUserRepo", error);
  }
}

export async function updateTextSummaryForUserRepo(
  summaryId: string,
  userId: string,
  patch: UpdateTextSummary,
  db: DBClient = database,
): Promise<TextSummary | undefined> {
  try {
    // Updateable allows id, userId and createdAt. None is ever legitimately
    // patched, and an id in a patch would rewrite the primary key of
    // whichever row the WHERE matched.
    const safePatch: UpdateTextSummary = { ...patch };
    delete safePatch.id;
    delete safePatch.userId;
    delete safePatch.createdAt;

    return await db
      .updateTable("textSummaries")
      // Nothing stamps updated_at in the database, so the repository does.
      .set({ ...safePatch, updatedAt: new Date() })
      .where("id", "=", summaryId)
      .where("userId", "=", userId)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateTextSummaryForUserRepo", error);
  }
}

export async function deleteTextSummaryForUserRepo(
  summaryId: string,
  userId: string,
  db: DBClient = database,
): Promise<void> {
  try {
    await db
      .deleteFrom("textSummaries")
      .where("id", "=", summaryId)
      .where("userId", "=", userId)
      .execute();
  } catch (error) {
    throw handleError("deleteTextSummaryForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// The retention sweep. Deletes across every owner by age, which is the one
// query in this file that is deliberately not scoped to a user - it runs
// from the monthly job, behind a bearer secret, with no session at all.
// -------------------------------------------------------------------
export async function deleteTextSummariesOlderThanRepo(
  cutoff: Date,
  db: DBClient = database,
): Promise<number> {
  try {
    const result = await db.deleteFrom("textSummaries").where("createdAt", "<", cutoff).executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  } catch (error) {
    throw handleError("deleteTextSummariesOlderThanRepo", error);
  }
}
