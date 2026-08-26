import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import {
  JiraIssue,
  JiraProject,
  NewJiraIssue,
  NewJiraProject,
  NewStaffTarget,
  NewWorklogFact,
  StaffTarget,
  SyncWatermark,
  WorklogFact,
} from "../kysely-database-types";

// -------------------------------------------------------------------
// Timesheet read-model repository
//
// The only place the read model is written. Every write is an upsert keyed on
// Jira's own id, which is what makes re-running a sync safe: the second run
// overwrites the first rather than adding to it. Nothing here appends.
// -------------------------------------------------------------------

// Postgres caps a statement at 65535 bind parameters. Worklog rows carry
// around fifteen columns each, so chunking well below the cap keeps a large
// backfill from failing on statement size alone.
const INSERT_CHUNK_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

// -------------------------------------------------------------------
// Upsert worklog facts, keyed on Jira's worklog id.
//
// ON CONFLICT DO UPDATE, never DO NOTHING: an edited worklog must overwrite
// what is stored, and DO NOTHING would leave the read model showing the
// duration the entry had before someone corrected it.
//
// hasNarrative is omitted on purpose - Postgres generates it from narrative.
// -------------------------------------------------------------------
export async function upsertWorklogFactsRepo(rows: NewWorklogFact[], db: DBClient = database): Promise<number> {
  try {
    if (rows.length === 0) return 0;

    let written = 0;

    for (const batch of chunk(rows, INSERT_CHUNK_SIZE)) {
      await db
        .insertInto("worklogFact")
        .values(batch)
        .onConflict((oc) =>
          oc.column("worklogId").doUpdateSet((eb) => ({
            issueKey: eb.ref("excluded.issueKey"),
            parentKey: eb.ref("excluded.parentKey"),
            projectKey: eb.ref("excluded.projectKey"),
            category: eb.ref("excluded.category"),
            personId: eb.ref("excluded.personId"),
            personName: eb.ref("excluded.personName"),
            workDate: eb.ref("excluded.workDate"),
            startSecond: eb.ref("excluded.startSecond"),
            timeSpentSeconds: eb.ref("excluded.timeSpentSeconds"),
            billable: eb.ref("excluded.billable"),
            billableSource: eb.ref("excluded.billableSource"),
            narrative: eb.ref("excluded.narrative"),
            jiraUpdatedAt: eb.ref("excluded.jiraUpdatedAt"),
            syncedAt: new Date(),
          })),
        )
        .execute();

      written += batch.length;
    }

    return written;
  } catch (error) {
    throw handleError("upsertWorklogFactsRepo", error);
  }
}

// -------------------------------------------------------------------
// Remove worklogs deleted in Jira.
//
// A hard delete, deliberately. The read model mirrors Jira, and a worklog
// that no longer exists there must not keep contributing hours to an invoice
// here. Jira keeps its own history; this table is derived and rebuildable.
// -------------------------------------------------------------------
export async function deleteWorklogFactsRepo(worklogIds: string[], db: DBClient = database): Promise<number> {
  try {
    if (worklogIds.length === 0) return 0;

    let removed = 0;

    for (const batch of chunk(worklogIds, INSERT_CHUNK_SIZE)) {
      const result = await db.deleteFrom("worklogFact").where("worklogId", "in", batch).executeTakeFirst();
      removed += Number(result?.numDeletedRows ?? 0);
    }

    return removed;
  } catch (error) {
    throw handleError("deleteWorklogFactsRepo", error);
  }
}

// -------------------------------------------------------------------
// Upsert the issue cache, keyed on issue key.
// -------------------------------------------------------------------
export async function upsertJiraIssuesRepo(rows: NewJiraIssue[], db: DBClient = database): Promise<number> {
  try {
    if (rows.length === 0) return 0;

    let written = 0;

    for (const batch of chunk(rows, INSERT_CHUNK_SIZE)) {
      await db
        .insertInto("jiraIssue")
        .values(batch)
        .onConflict((oc) =>
          oc.column("issueKey").doUpdateSet((eb) => ({
            parentKey: eb.ref("excluded.parentKey"),
            projectKey: eb.ref("excluded.projectKey"),
            issueType: eb.ref("excluded.issueType"),
            summary: eb.ref("excluded.summary"),
            description: eb.ref("excluded.description"),
            category: eb.ref("excluded.category"),
            billable: eb.ref("excluded.billable"),
            baselineEstimateSeconds: eb.ref("excluded.baselineEstimateSeconds"),
            currentEstimateSeconds: eb.ref("excluded.currentEstimateSeconds"),
            status: eb.ref("excluded.status"),
            jiraUpdatedAt: eb.ref("excluded.jiraUpdatedAt"),
            syncedAt: new Date(),
          })),
        )
        .execute();

      written += batch.length;
    }

    return written;
  } catch (error) {
    throw handleError("upsertJiraIssuesRepo", error);
  }
}

// -------------------------------------------------------------------
// Upsert the project list, keyed on project key.
// -------------------------------------------------------------------
export async function upsertJiraProjectsRepo(rows: NewJiraProject[], db: DBClient = database): Promise<number> {
  try {
    if (rows.length === 0) return 0;

    await db
      .insertInto("jiraProject")
      .values(rows)
      .onConflict((oc) =>
        oc.column("projectKey").doUpdateSet((eb) => ({
          name: eb.ref("excluded.name"),
          category: eb.ref("excluded.category"),
          projectType: eb.ref("excluded.projectType"),
          syncedAt: new Date(),
        })),
      )
      .execute();

    return rows.length;
  } catch (error) {
    throw handleError("upsertJiraProjectsRepo", error);
  }
}

// -------------------------------------------------------------------
// Every known project. Drives the Internal/External selector, including the
// categories with no time logged against them.
// -------------------------------------------------------------------
export async function getJiraProjectsRepo(): Promise<JiraProject[]> {
  try {
    return await database.selectFrom("jiraProject").selectAll().orderBy("projectKey").execute();
  } catch (error) {
    throw handleError("getJiraProjectsRepo", error);
  }
}

// -------------------------------------------------------------------
// Facts within an inclusive date range ('YYYY-MM-DD'), for the aggregation.
// Dates compare as strings; see kysely-database-client.ts.
// -------------------------------------------------------------------
export async function getWorklogFactsInRangeRepo(startDate: string, endDate: string): Promise<WorklogFact[]> {
  try {
    return await database
      .selectFrom("worklogFact")
      .selectAll()
      .where("workDate", ">=", startDate)
      .where("workDate", "<=", endDate)
      .orderBy("workDate")
      .orderBy("personId")
      .orderBy("worklogId")
      .execute();
  } catch (error) {
    throw handleError("getWorklogFactsInRangeRepo", error);
  }
}

// -------------------------------------------------------------------
// Every cached issue. The snapshot needs parents as well as the issues that
// were booked to, and at this volume - a few thousand issues - loading the
// lot is simpler and faster than two round trips to resolve the parents.
// -------------------------------------------------------------------
export async function getJiraIssuesRepo(): Promise<JiraIssue[]> {
  try {
    return await database.selectFrom("jiraIssue").selectAll().orderBy("issueKey").execute();
  } catch (error) {
    throw handleError("getJiraIssuesRepo", error);
  }
}

// -------------------------------------------------------------------
// How many facts exist in total, across every period.
//
// Used to tell "this month was quiet" apart from "nothing has ever synced".
// Those look identical on an empty dashboard and mean completely different
// things.
// -------------------------------------------------------------------
export async function countWorklogFactsRepo(): Promise<number> {
  try {
    const row = await database
      .selectFrom("worklogFact")
      .select((eb) => eb.fn.countAll<string>().as("total"))
      .executeTakeFirst();

    // count() comes back from Postgres as a bigint, which node-postgres hands
    // over as a string. Number() it exactly once, here.
    return Number(row?.total ?? 0);
  } catch (error) {
    throw handleError("countWorklogFactsRepo", error);
  }
}

// -------------------------------------------------------------------
// Watermark read.
// -------------------------------------------------------------------
export async function getSyncWatermarkRepo(jobName: string): Promise<SyncWatermark | undefined> {
  try {
    return await database.selectFrom("syncWatermark").selectAll().where("jobName", "=", jobName).executeTakeFirst();
  } catch (error) {
    throw handleError("getSyncWatermarkRepo", error);
  }
}

// -------------------------------------------------------------------
// Advance the watermark.
//
// Called LAST, inside the same transaction as the writes it describes. If the
// job dies before this runs, the transaction rolls back and the next run
// repeats the window - which is free, because every write above is an upsert
// keyed on Jira's id. The opposite ordering would skip a window and lose
// billable time with nothing to show it had happened.
//
// updated_at is set explicitly: this schema has no trigger for it.
// -------------------------------------------------------------------
export async function advanceSyncWatermarkRepo(
  jobName: string,
  lastSyncedAt: Date,
  counts: { updated: number; deleted: number },
  db: DBClient = database,
): Promise<void> {
  try {
    const now = new Date();

    await db
      .insertInto("syncWatermark")
      .values({
        jobName,
        lastSyncedAt,
        lastRunAt: now,
        lastSuccessAt: now,
        lastError: null,
        lastUpdatedCount: counts.updated,
        lastDeletedCount: counts.deleted,
      })
      .onConflict((oc) =>
        oc.column("jobName").doUpdateSet({
          lastSyncedAt,
          lastRunAt: now,
          lastSuccessAt: now,
          lastError: null,
          lastUpdatedCount: counts.updated,
          lastDeletedCount: counts.deleted,
          updatedAt: now,
        }),
      )
      .execute();
  } catch (error) {
    throw handleError("advanceSyncWatermarkRepo", error);
  }
}

// -------------------------------------------------------------------
// Record a failure WITHOUT moving the watermark.
//
// Separate from the advance above so there is no path where an error handler
// writes a timestamp. The point of the watermark is that it only ever moves
// behind work that actually landed.
// -------------------------------------------------------------------
export async function recordSyncFailureRepo(jobName: string, message: string): Promise<void> {
  try {
    const now = new Date();
    const existing = await getSyncWatermarkRepo(jobName);

    // Nothing to attach a failure to yet, and inventing a watermark row here
    // would seed a starting point that no successful run chose.
    if (!existing) {
      console.error(`[timesheet-sync] failed before any watermark existed: ${message}`);
      return;
    }

    await database
      .updateTable("syncWatermark")
      .set({ lastRunAt: now, lastError: message.slice(0, 1000), updatedAt: now })
      .where("jobName", "=", jobName)
      .execute();
  } catch (error) {
    throw handleError("recordSyncFailureRepo", error);
  }
}

// -------------------------------------------------------------------
// Staff targets
//
// The only rows in this model that are not derived from Jira, so unlike
// everything else here they cannot be recovered by re-syncing. Handled with
// correspondingly more care: an upsert never blanks a column the caller did
// not supply.
// -------------------------------------------------------------------
export async function getStaffTargetsRepo(): Promise<StaffTarget[]> {
  try {
    return await database.selectFrom("staffTarget").selectAll().orderBy("personId").execute();
  } catch (error) {
    throw handleError("getStaffTargetsRepo", error);
  }
}

export async function upsertStaffTargetRepo(row: NewStaffTarget, db: DBClient = database): Promise<StaffTarget> {
  try {
    const now = new Date();

    return await db
      .insertInto("staffTarget")
      .values(row)
      .onConflict((oc) =>
        oc.column("personId").doUpdateSet((eb) => ({
          personName: eb.ref("excluded.personName"),
          workingDaysTenths: eb.ref("excluded.workingDaysTenths"),
          // EVERY column the caller can set has to be listed here. A column
          // left out is not left alone in a useful way - the INSERT half sets
          // it and the UPDATE half silently keeps the old value, so a new
          // person gets what was chosen and an existing one gets whatever they
          // had before. working_weekdays was missed when migration 009 added
          // it, which meant changing somebody from Mon-Wed to Tue-Thu appeared
          // to save and then came back Mon-Wed.
          //
          // Worse than a no-op, because working_days_tenths above DID update:
          // picking four days stored a count of four against three stored
          // days, and the two then disagreed about the same person.
          workingWeekdays: eb.ref("excluded.workingWeekdays"),
          minutesPerDay: eb.ref("excluded.minutesPerDay"),
          billableTargetPercent: eb.ref("excluded.billableTargetPercent"),
          // updated_at has no trigger in this schema, so it is set here.
          updatedAt: now,
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("upsertStaffTargetRepo", error);
  }
}
