import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";

import { ManualWorklog, NewManualWorklog } from "../kysely-database-types";

// -------------------------------------------------------------------
// Manually entered time.
//
// THE ONLY NON-REBUILDABLE TIMESHEET TABLE. Everything else here is derived
// from Jira and can be dropped and re-synced; these rows are the only copy of
// what they hold. So there is no bulk delete in this file and never should be.
//
// SCOPED READS, unlike the rest of the timesheet repositories. A person may
// read and write their OWN entries from the portal, so `personId` is a real
// security predicate here rather than a filter - which is why the two
// person-scoped functions take it as their first argument and the service
// resolves it from the session, never from a form field.
// -------------------------------------------------------------------

export async function listManualWorklogsForPersonRepo(
  personId: string,
  from: string,
  to: string,
  db: DBClient = database,
): Promise<ManualWorklog[]> {
  try {
    return await db
      .selectFrom("manualWorklog")
      .selectAll()
      .where("personId", "=", personId)
      // Dates are 'YYYY-MM-DD' strings, so a lexicographic between is both
      // correct and index-friendly. Never parsed into a Date to compare.
      .where("workDate", ">=", from)
      .where("workDate", "<=", to)
      .orderBy("workDate")
      .orderBy("issueKey")
      .execute();
  } catch (error) {
    throw handleError("listManualWorklogsForPersonRepo", error);
  }
}

// Everybody's manual time in a period, for merging into the read model. Unscoped,
// so its callers must be admin-guarded.
export async function listManualWorklogsInRangeRepo(
  from: string,
  to: string,
  db: DBClient = database,
): Promise<ManualWorklog[]> {
  try {
    return await db
      .selectFrom("manualWorklog")
      .selectAll()
      .where("workDate", ">=", from)
      .where("workDate", "<=", to)
      .execute();
  } catch (error) {
    throw handleError("listManualWorklogsInRangeRepo", error);
  }
}

export async function addManualWorklogRepo(
  row: NewManualWorklog,
  db: DBClient = database,
): Promise<ManualWorklog> {
  try {
    return await db.insertInto("manualWorklog").values(row).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addManualWorklogRepo", error);
  }
}

// -------------------------------------------------------------------
// Update one row, SCOPED TO ITS OWNER.
//
// The personId predicate is the authorisation, not a convenience: without it an
// id from a form would be enough to edit somebody else's time. `id` alone is
// never sufficient here.
//
// `updated_at` is set explicitly - this schema has no trigger for it, and a
// patch that spreads without setting it leaves the column lying.
// -------------------------------------------------------------------
export async function updateManualWorklogForPersonRepo(
  id: string,
  personId: string,
  patch: { timeSpentSeconds?: number; notes?: string | null },
  db: DBClient = database,
): Promise<ManualWorklog | undefined> {
  try {
    return await db
      .updateTable("manualWorklog")
      .set({ ...patch, updatedAt: new Date() })
      .where("id", "=", id)
      .where("personId", "=", personId)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateManualWorklogForPersonRepo", error);
  }
}

export async function deleteManualWorklogForPersonRepo(
  id: string,
  personId: string,
  db: DBClient = database,
): Promise<void> {
  try {
    await db.deleteFrom("manualWorklog").where("id", "=", id).where("personId", "=", personId).execute();
  } catch (error) {
    throw handleError("deleteManualWorklogForPersonRepo", error);
  }
}
