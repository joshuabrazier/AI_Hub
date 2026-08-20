import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";

import { NewTimesheetAiSummary, TimesheetAiSummary } from "../kysely-database-types";

// -------------------------------------------------------------------
// The cache of model-written period summaries.
//
// UNSCOPED READS, like the request log and unlike everything user-owned. A
// summary describes a period, not a person, and the whole timesheet feature
// is admin-only - so the guard is the ADMIN check in the service, not a
// predicate here. That makes this another table where a caller skipping the
// guard leaks staff performance data; do not add one.
//
// Writes are upserts keyed on cacheKey, so regenerating a view replaces its
// row instead of accumulating one per press.
// -------------------------------------------------------------------

// How long a cached summary is kept before the monthly retention sweep
// removes it. Short, and deliberately not configurable: every row is derived
// and regenerates in seconds, and what it holds is prose about how
// individuals are performing. There is no argument for keeping that for a
// year on the off chance somebody reloads a page from last March.
export const TIMESHEET_AI_SUMMARY_RETENTION_DAYS = 30;

export async function getTimesheetAiSummaryRepo(
  cacheKey: string,
  db: DBClient = database,
): Promise<TimesheetAiSummary | undefined> {
  try {
    return await db
      .selectFrom("timesheetAiSummary")
      .selectAll()
      .where("cacheKey", "=", cacheKey)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getTimesheetAiSummaryRepo", error);
  }
}

export async function upsertTimesheetAiSummaryRepo(
  row: NewTimesheetAiSummary,
  db: DBClient = database,
): Promise<TimesheetAiSummary> {
  try {
    return await db
      .insertInto("timesheetAiSummary")
      .values(row)
      .onConflict((oc) =>
        oc.column("cacheKey").doUpdateSet((eb) => ({
          scope: eb.ref("excluded.scope"),
          granularity: eb.ref("excluded.granularity"),
          periodStart: eb.ref("excluded.periodStart"),
          category: eb.ref("excluded.category"),
          project: eb.ref("excluded.project"),
          person: eb.ref("excluded.person"),
          dataFingerprint: eb.ref("excluded.dataFingerprint"),
          summary: eb.ref("excluded.summary"),
          modelId: eb.ref("excluded.modelId"),
          region: eb.ref("excluded.region"),
          inputTokens: eb.ref("excluded.inputTokens"),
          outputTokens: eb.ref("excluded.outputTokens"),
          cacheReadTokens: eb.ref("excluded.cacheReadTokens"),
          cacheWriteTokens: eb.ref("excluded.cacheWriteTokens"),
          generatedBy: eb.ref("excluded.generatedBy"),
          // Refreshed so the retention window runs from when the prose was
          // last written, not from when this cache key was first used.
          createdAt: new Date(),
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("upsertTimesheetAiSummaryRepo", error);
  }
}

// -------------------------------------------------------------------
// Drop everything written before `cutoff`. Returns how many went, so the
// retention job can report it rather than claiming a number it did not count.
// -------------------------------------------------------------------
export async function purgeTimesheetAiSummariesRepo(
  cutoff: Date,
  db: DBClient = database,
): Promise<number> {
  try {
    const result = await db
      .deleteFrom("timesheetAiSummary")
      .where("createdAt", "<", cutoff)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  } catch (error) {
    throw handleError("purgeTimesheetAiSummariesRepo", error);
  }
}
