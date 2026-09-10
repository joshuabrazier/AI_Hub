import "server-only";

import { database } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { type ProjectCategory, type RndClassValue } from "../kysely-database-types";

// -------------------------------------------------------------------
// ===================================================================
// THE APP'S OWN DELIVERY DATA, IN THE SHAPE THE TIMESHEET ENGINE WANTS
// ===================================================================
//
// The reports under /admin/timesheets were built on a Jira-synced read model
// - `jira_project`, `jira_issue`, `worklog_fact` - and this is what replaces
// it. Everything here reads clients, projects, phases, tasks, time entries
// and users, which the app now owns end to end.
//
// THE ENGINE IS NOT BEING REWRITTEN, AND THAT IS THE WHOLE POINT. It is pure:
// a `TimesheetSnapshot` goes in and a `TimesheetReport` comes out, with no
// imports from the app and no I/O. So the switch is a MAPPING problem, not a
// reporting problem, and the hierarchies line up almost exactly:
//
//   Jira space        ->  client        (the engine calls this the client)
//   parent issue      ->  project       (Jira called it the "Project item")
//   issue             ->  task
//   worklog           ->  time entry
//
// Every figure on every one of those screens keeps being computed by the code
// that already computes it, which is the only way to move a report about money
// without changing what it says.
//
// -------------------------------------------------------------------
// WHY THESE READS ARE HERE AND NOT IN THE EXISTING REPOSITORIES.
//
// They cross four tables to answer one question, and the question belongs to
// reporting rather than to any of them: `tasks.repository` should not know
// what a snapshot is, and `time-entries.repository` deliberately withholds
// rates from its reads because its callers are project members. These reads
// are admin-only by the time they are reached and they need the money.
//
// The layering rule still holds: this file is the only place the DB is
// touched for these, it imports nothing from a feature, and the service above
// it does the mapping and owns the guard.
//
// -------------------------------------------------------------------
// WHAT IS DELIBERATELY NOT SELECTED, so the next person does not go looking:
//
//   startSecond   The app records a DAY and a duration, never a clock time.
//                 The engine's overlap rule already skips a worklog with a
//                 null start, which is honest: two entries on one day cannot
//                 be proved to overlap when neither says when it began. That
//                 finding simply stops firing rather than firing wrongly.
//
//   issueType     Jira's issue type had no consumer beyond display.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// One logged hour, with the person's name and the money captured on it.
//
// THE RATES COME OFF THE ENTRY, NOT A RATE CARD, and this is where the app's
// data is genuinely better than the Jira model it replaces. `logTimeService`
// snapshots the charge and cost rate onto the row at the moment the hour is
// logged, so revenue is a fact about what was agreed then - not a
// reconstruction from today's rates, which is what the Jira path had to do
// and which silently restates history every time a rate changes.
//
// NULL rates are kept as NULL. An hour logged before anybody set a rate is
// an hour with no money attached, and the reports say so; defaulting it to
// nought here would write it off in silence.
// -------------------------------------------------------------------
export interface ReportingTimeEntryRow {
  entryId: string;
  taskId: string;
  projectId: string;
  personId: string;
  personName: string | null;
  workDate: string;
  minutes: number;
  notes: string | null;
  rndClass: RndClassValue | null;
  chargeRateCents: number | null;
  costRateCents: number | null;
}

export async function getReportingTimeEntriesInRangeRepo(
  startDate: string,
  endDate: string,
): Promise<ReportingTimeEntryRow[]> {
  try {
    // LEFT JOIN on users, not inner. De-identifying somebody leaves their
    // user row behind with a tombstoned name for exactly this reason, but an
    // inner join would still drop an entry if a row ever went missing - and
    // an hour that vanishes from a report is worse than one with no name on
    // it. `personName` is a label; `personId` is the identity.
    return await database
      .selectFrom("timeEntries as te")
      .leftJoin("users as u", "u.id", "te.userId")
      .select([
        "te.id as entryId",
        "te.taskId as taskId",
        "te.projectId as projectId",
        "te.userId as personId",
        "u.name as personName",
        "te.workDate as workDate",
        "te.minutes as minutes",
        "te.notes as notes",
        "te.rndClass as rndClass",
        "te.chargeRateCents as chargeRateCents",
        "te.costRateCents as costRateCents",
      ])
      // 'YYYY-MM-DD' compares exactly as a string - see the pg type parser
      // in kysely-database-client.ts, which maps DATE to a string on purpose.
      // A `new Date(startDate)` here would move somebody's Monday.
      .where("te.workDate", ">=", startDate)
      .where("te.workDate", "<=", endDate)
      .orderBy("te.workDate")
      .orderBy("te.userId")
      .orderBy("te.id")
      .execute();
  } catch (error) {
    throw handleError("getReportingTimeEntriesInRangeRepo", error);
  }
}

// -------------------------------------------------------------------
// Every task, with the project and client above it.
//
// ALL OF THEM, not just the ones with hours. The engine's budget roll-up
// documents this: "EVERY project appears, including the ones with no hours
// against them. A project with nothing booked is not an empty row to hide;
// it is one nobody has started, or one whose time is being recorded
// somewhere else entirely." The outstanding-effort view is built on exactly
// those rows.
//
// `category` comes off the CLIENT, which is where it lives - see migration
// 029. Every task under a client inherits it, the same way the Jira sync
// copied a space's category down onto every issue.
// -------------------------------------------------------------------
export interface ReportingTaskRow {
  taskId: string;
  projectId: string;
  clientId: string;
  title: string;
  estimateMinutes: number;
  category: ProjectCategory;
  isBillable: boolean;
  projectStatus: string;
}

export async function getReportingTasksRepo(): Promise<ReportingTaskRow[]> {
  try {
    return await database
      .selectFrom("tasks as t")
      .innerJoin("projects as p", "p.id", "t.projectId")
      .innerJoin("clients as c", "c.id", "p.clientId")
      .select([
        "t.id as taskId",
        "t.projectId as projectId",
        "p.clientId as clientId",
        "t.title as title",
        "t.estimateMinutes as estimateMinutes",
        "c.category as category",
        "p.isBillable as isBillable",
        "p.status as projectStatus",
      ])
      // INNER on both, unlike the entries read above, and for a reason rather
      // than by inconsistency: `tasks.project_id` and `projects.client_id`
      // are NOT NULL foreign keys, so a task with no project or a project
      // with no client cannot exist. A left join here would be dead branches
      // and a nullable type for every consumer to handle.
      .orderBy("t.id")
      .execute();
  } catch (error) {
    throw handleError("getReportingTasksRepo", error);
  }
}

// -------------------------------------------------------------------
// Every project, with what it was sold for and what it is now forecast at.
//
// TWO ESTIMATES, AND THEY ARE DIFFERENT QUESTIONS. The engine's BudgetRow
// carries a baseline and a current, and migration 023 wrote down the same
// distinction for this app:
//
//   CHARGED    what the client agreed to pay for. Set once and does not move
//              because work took longer - that is the nature of a quote.
//              -> the engine's baseline.
//   ESTIMATED  the sum of the task estimates, which CLIMBS as people revise
//              them. On a project going badly this moves first, long before
//              the logged hours catch up.
//              -> the engine's current.
//
// A bar drawn against charged alone says "66% spent" on a project already
// forecast to overrun, right up until it does. A bar against the estimates
// alone moves the goalposts on every re-estimate. The report needs both, and
// this is where they come from.
//
// CHARGED MINUTES RESPECT `budget_scope`. A project sold phase by phase
// records nothing on the project row and its charged total is the sum of its
// phases; one sold whole records it on the project. Deciding that here rather
// than in the service means one answer rather than one per caller, and
// COALESCE is deliberately not used to turn a missing quote into nought -
// NULL means "not filled in yet", which the report shows as no percentage
// rather than as a full bar.
// -------------------------------------------------------------------
export interface ReportingProjectRow {
  projectId: string;
  clientId: string;
  clientName: string;
  title: string;
  category: ProjectCategory;
  isBillable: boolean;
  rndClass: RndClassValue | null;
  status: string;
  chargedMinutes: number | null;
  estimateMinutes: number;
}

export async function getReportingProjectsRepo(): Promise<ReportingProjectRow[]> {
  try {
    const rows = await database
      .selectFrom("projects as p")
      .innerJoin("clients as c", "c.id", "p.clientId")
      .select((eb) => [
        "p.id as projectId",
        "p.clientId as clientId",
        "c.name as clientName",
        "p.title as title",
        "c.category as category",
        "p.isBillable as isBillable",
        "p.rndClass as rndClass",
        "p.status as status",
        // Sold whole, or phase by phase. A correlated subquery per project
        // rather than a join, because joining phases and tasks in one
        // statement fans the rows out and both sums come back multiplied -
        // the classic double-count, and one that looks plausible.
        eb
          .case()
          .when("p.budgetScope", "=", "phase")
          .then(
            eb
              .selectFrom("phases as ph")
              .select((inner) => inner.fn.sum<string | null>("ph.chargedMinutes").as("total"))
              .whereRef("ph.projectId", "=", "p.id")
              .as("phaseCharged"),
          )
          .else(eb.ref("p.chargedMinutes"))
          .end()
          .as("chargedMinutes"),
        eb
          .selectFrom("tasks as t")
          .select((inner) => inner.fn.sum<string | null>("t.estimateMinutes").as("total"))
          .whereRef("t.projectId", "=", "p.id")
          .as("estimateMinutes"),
      ])
      .orderBy("p.id")
      .execute();

    // Postgres hands a SUM back as a numeric, which node-postgres gives us as
    // a string, and as NULL for a project with no phases or no tasks. Both
    // are resolved exactly once, here, so nothing downstream ever sees a
    // string where it expects minutes.
    //
    // The two nulls mean different things and are treated differently.
    // A missing ESTIMATE total is nought - a project with no tasks genuinely
    // has no estimated work. A missing CHARGED figure stays NULL, because
    // "nobody has recorded what this was sold for" is not "it was sold for
    // nothing", and the report draws those two very differently.
    return rows.map((row) => ({
      ...row,
      chargedMinutes: row.chargedMinutes === null ? null : Number(row.chargedMinutes),
      estimateMinutes: Number(row.estimateMinutes ?? 0),
    }));
  } catch (error) {
    throw handleError("getReportingProjectsRepo", error);
  }
}

// -------------------------------------------------------------------
// Every client, for the Internal/External selector.
//
// INCLUDING THE ONES WITH NO TIME AGAINST THEM, which is the same rule the
// Jira version followed: "the category is what Internal vs External is read
// from, and it is needed even for projects with no time logged - a category
// that exists and has nothing against it is still an option somebody should
// be able to pick and see an empty result for." A filter whose options are
// derived only from rows that exist cannot express "show me the internal
// work" on a month where there was none.
// -------------------------------------------------------------------
export interface ReportingClientRow {
  clientId: string;
  name: string;
  category: ProjectCategory;
  isActive: boolean;
}

export async function getReportingClientsRepo(): Promise<ReportingClientRow[]> {
  try {
    return await database
      .selectFrom("clients")
      .select(["id as clientId", "name", "category", "isActive"])
      .orderBy("name")
      .execute();
  } catch (error) {
    throw handleError("getReportingClientsRepo", error);
  }
}

// -------------------------------------------------------------------
// How many entries exist at all, across every period.
//
// Used to tell "this month was quiet" apart from "nobody has ever logged an
// hour in this app". Those look identical on an empty dashboard and mean
// completely different things - the first needs no action, the second means
// the feature is not being used and the reports are describing nothing.
// -------------------------------------------------------------------
export async function countReportingTimeEntriesRepo(): Promise<number> {
  try {
    const row = await database
      .selectFrom("timeEntries")
      .select((eb) => eb.fn.countAll<string>().as("total"))
      .executeTakeFirst();

    // count() comes back as a bigint, which node-postgres hands over as a
    // string. Number() it exactly once, here.
    return Number(row?.total ?? 0);
  } catch (error) {
    throw handleError("countReportingTimeEntriesRepo", error);
  }
}
