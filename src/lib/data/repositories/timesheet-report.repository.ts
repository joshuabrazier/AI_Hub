import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";

import { NewTimesheetReport, TimesheetReport } from "../kysely-database-types";

// -------------------------------------------------------------------
// Saved timesheet reports.
//
// UNSCOPED READS, like the summary cache and the request log: a report is
// about a period and a team, not about the person who pressed the button, and
// the whole timesheet feature is admin-only. The guard is the ADMIN check in
// the service. That makes this one more table where a caller skipping the
// guard leaks staff performance prose - do not add one.
//
// APPEND AND DELETE, never update. Writing a report again makes another
// report; a record that can be quietly rewritten is not one. The only removals
// are an admin deleting one on purpose and the retention sweep.
// -------------------------------------------------------------------

// How long a saved report is kept. Longer than the summary cache's 30 days,
// because this is an artefact somebody deliberately made rather than a derived
// convenience - but not forever, because it is prose about how named
// individuals are performing. A code constant rather than an env var: the
// window is a policy decision that belongs in review, not in a deploy config.
export const TIMESHEET_REPORT_RETENTION_DAYS = 365;

// One page of the list. Reports are written by hand so this table grows slowly,
// but a list with no bound is a list that eventually times out.
export const TIMESHEET_REPORT_PAGE_SIZE = 50;

export async function addTimesheetReportRepo(
  row: NewTimesheetReport,
  db: DBClient = database,
): Promise<TimesheetReport> {
  try {
    return await db.insertInto("timesheetReport").values(row).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addTimesheetReportRepo", error);
  }
}

export async function getTimesheetReportRepo(
  id: string,
  db: DBClient = database,
): Promise<TimesheetReport | undefined> {
  try {
    return await db.selectFrom("timesheetReport").selectAll().where("id", "=", id).executeTakeFirst();
  } catch (error) {
    throw handleError("getTimesheetReportRepo", error);
  }
}

// -------------------------------------------------------------------
// The list. Deliberately WITHOUT `body` and `facts`: a listing needs titles
// and dates, and selecting every report's full prose to render a list of
// links is how a page that looks cheap turns into megabytes.
// -------------------------------------------------------------------
export type TimesheetReportListRow = Pick<
  TimesheetReport,
  | "id"
  | "title"
  | "granularity"
  | "periodStart"
  | "periodLabel"
  | "category"
  | "project"
  | "person"
  | "createdByName"
  | "createdAt"
>;

export async function listTimesheetReportsRepo(
  limit = TIMESHEET_REPORT_PAGE_SIZE,
  db: DBClient = database,
): Promise<TimesheetReportListRow[]> {
  try {
    return await db
      .selectFrom("timesheetReport")
      .select([
        "id",
        "title",
        "granularity",
        "periodStart",
        "periodLabel",
        "category",
        "project",
        "person",
        "createdByName",
        "createdAt",
      ])
      .orderBy("createdAt", "desc")
      .limit(limit)
      .execute();
  } catch (error) {
    throw handleError("listTimesheetReportsRepo", error);
  }
}

export async function deleteTimesheetReportRepo(id: string, db: DBClient = database): Promise<void> {
  try {
    await db.deleteFrom("timesheetReport").where("id", "=", id).execute();
  } catch (error) {
    throw handleError("deleteTimesheetReportRepo", error);
  }
}

// Drop everything written before `cutoff`, returning the count so the
// retention job can report what it actually removed.
export async function purgeTimesheetReportsRepo(cutoff: Date, db: DBClient = database): Promise<number> {
  try {
    const result = await db
      .deleteFrom("timesheetReport")
      .where("createdAt", "<", cutoff)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  } catch (error) {
    throw handleError("purgeTimesheetReportsRepo", error);
  }
}
