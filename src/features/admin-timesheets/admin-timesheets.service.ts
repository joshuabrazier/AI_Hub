import "server-only";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { PROJECT_CATEGORY_LABELS, USER_ROLES } from "@/lib/data/kysely-database-types";
import {
  countReportingTimeEntriesRepo,
  getReportingClientsRepo,
  getReportingProjectsRepo,
  getReportingTasksRepo,
  getReportingTimeEntriesInRangeRepo,
  latestReportingWorkDateRepo,
} from "@/lib/data/repositories/delivery-reporting.repository";
import { envServer } from "@/lib/env-server";
import { handleError } from "@/lib/handle-errors";
import { buildReport } from "@/lib/timesheet/aggregate";
import { buildDailySeries } from "@/lib/timesheet/daily-series";
import { bucketFor, Granularity, isGranularity, resolvePeriod } from "@/lib/timesheet/period";
import {
  buildCategorySplit,
  buildInvoiceReadiness,
  buildTopJobs,
} from "@/lib/timesheet/overview-series";
import {
  capacityHoursForRange,
  countWeekdays,
  measureAgainstCapacity,
  toStaffCapacity,
} from "@/lib/timesheet/staff-capacity";
import { SnapshotIssue, SnapshotWorklog, TimesheetSnapshot } from "@/lib/timesheet/timesheet.types";

import {
  toReportingFactRows,
  toReportingIssueRows,
  type ReportingFactRow,
} from "@/lib/timesheet/app-snapshot";
import { todayInAppZone } from "@/lib/timezone";

import { loadReportingTasks, loadStaffTargets } from "./admin-timesheets-loaders";

import {
  ALL_CATEGORIES,
  BILLABLE_FILTERS,
  type BillableFilter,
  AdminTimesheetsDTO,
  CategoryOptionDTO,
  ClientOptionDTO,
  PersonOptionDTO,
  ProjectOptionDTO,
  OverviewDTO,
  StaffDashboardDTO,
  StaffSummaryDTO,
  TimesheetPeriodDTO,
} from "./admin-timesheets.types";


// -------------------------------------------------------------------
// Fact rows to the engine's snapshot shape.
//
// A straight rename, deliberately: no defaulting, no coercion, no filling in
// of blanks. Anything missing has to reach the engine as missing so the audit
// can report it, rather than being quietly patched here where nobody would
// ever see it happen.
//
// The rows themselves are built by `toReportingFactRows` in app-snapshot.ts,
// which is where minutes become seconds and a task's project and client are
// resolved. This is only the last hop.
// -------------------------------------------------------------------
function toSnapshotWorklogs(rows: readonly ReportingFactRow[]): SnapshotWorklog[] {
  return rows.map((row) => ({
    worklogId: row.worklogId,
    issueKey: row.issueKey,
    personId: row.personId,
    personName: row.personName,
    workDate: row.workDate,
    startSecond: row.startSecond,
    timeSpentSeconds: row.timeSpentSeconds,
    narrative: row.narrative,
    rndClass: row.rndClass,
  }));
}

// What the URL asked for. Every field is untrusted and validated below.
//
// Route pages take their searchParams as Promise<TimesheetSearchParams> so a
// new filter is declared in ONE place. Six inline copies is how "billable"
// came to be read by the service and declared by none of the routes: the
// spread meant it still worked, so the types were quietly wrong rather than
// noisily wrong, which is the worse of the two.
export type TimesheetSearchParams = TimesheetRequest;

export interface TimesheetRequest {
  // "week" | "fortnight" | "month" | "year". Anything else falls back to the
  // default rather than erroring, so a stale link still opens.
  granularity?: string;
  // Any date inside the wanted period, 'YYYY-MM-DD'. It is snapped to the
  // start of its period, so the 15th and the 20th open the same month.
  start?: string;
  category?: string;
  // The Jira project key of the client. Validated against this period's own
  // client list, so an invented one narrows nothing.
  client?: string;
  project?: string;
  // A single id, or several comma-separated - "louis,josh" is a normal ask.
  // Parsed and validated against this period's own options, so a stale or
  // invented id falls back to everyone rather than emptying the screen.
  person?: string;
  // One of BILLABLE_FILTERS. Anything else falls back to 'all'.
  billable?: string;
}

// One period drives the whole screen. Before this the month drove the tables
// and the week drove the chart, so the two halves of a page could describe
// different spans of time with nothing saying so.
const DEFAULT_GRANULARITY: Granularity = "month";


type FactRows = ReportingFactRow[];

const SECONDS_TO_HOURS = 3600;

function toHours(seconds: number): number {
  return Math.round((seconds / SECONDS_TO_HOURS) * 10000) / 10000;
}

// -------------------------------------------------------------------
// The Internal / External selector's options, discovered from the data.
//
// The names are whatever the Jira admin called the project categories, so
// nothing is hardcoded. Rows with no category are collected under their own
// option instead of being hidden - unattributed time is exactly what somebody
// needs to find.
// -------------------------------------------------------------------
const UNCATEGORISED = "uncategorised";

function toCategoryOptions(rows: FactRows, projects: ProjectRows): CategoryOptionDTO[] {
  const totals = new Map<string, { seconds: number; count: number }>();

  // Seed from the CLIENT list, not from the logged time. A category that
  // exists with nothing booked against it has to show as zero, because
  // "Internal exists and has no hours" and "there is no such thing as
  // Internal" are completely different facts - and the first one means time
  // is being recorded somewhere other than here, which is exactly what
  // somebody needs to notice.
  for (const project of projects) {
    const key = project.category ?? UNCATEGORISED;
    if (!totals.has(key)) totals.set(key, { seconds: 0, count: 0 });
  }

  for (const row of rows) {
    const key = row.category ?? UNCATEGORISED;
    const existing = totals.get(key);
    if (existing) {
      existing.seconds += row.timeSpentSeconds;
      existing.count += 1;
    } else {
      totals.set(key, { seconds: row.timeSpentSeconds, count: 1 });
    }
  }

  const allSeconds = rows.reduce((total, row) => total + row.timeSpentSeconds, 0);

  const options: CategoryOptionDTO[] = [
    { value: ALL_CATEGORIES, label: "All work", hours: toHours(allSeconds), worklogCount: rows.length },
  ];

  // Alphabetical, so the order does not shuffle as hours move between them.
  for (const [key, total] of [...totals.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    options.push({
      value: key,
      label: key === UNCATEGORISED ? "No category" : key,
      hours: toHours(total.seconds),
      worklogCount: total.count,
    });
  }

  return options;
}

// -------------------------------------------------------------------
// The project selector's options: the Project items with time against them in
// this period, busiest first, because that is the order somebody looks for
// them in.
// -------------------------------------------------------------------
type IssueRows = SnapshotIssue[];
// The CLIENT list. Jira called a client a "project", the engine calls it the
// client, and these option builders were written against the Jira name - so
// the shape keeps `projectKey` and the service maps clients into it.
type ProjectRows = readonly { projectKey: string; name: string; category: string }[];

// The Jira issue type that sits at job level, above deliverables. Read from
// the issue rather than guessed: this instance calls level 1 "Project".
const JOB_ISSUE_TYPE = "Project";

// Every job in the book of work, whether or not anything is booked to it.
export function selectJobIssues(issues: IssueRows): IssueRows {
  const parentKeys = new Set(issues.map((issue) => issue.parentKey).filter((key): key is string => Boolean(key)));

  // Anything Jira types as a job, plus anything that is a parent of something
  // else. The second half is the safety net for an instance whose hierarchy is
  // named differently.
  return issues.filter((issue) => issue.issueType === JOB_ISSUE_TYPE || parentKeys.has(issue.issueKey));
}

// -------------------------------------------------------------------
// The staff selector's options. Grouped on accountId, because a display name
// is a label: two people can share one, and one person can change theirs.
// -------------------------------------------------------------------
function toPersonOptions(rows: FactRows): PersonOptionDTO[] {
  const totals = new Map<string, { seconds: number; name: string | null; days: Set<string> }>();

  for (const row of rows) {
    const existing = totals.get(row.personId);
    if (existing) {
      existing.seconds += row.timeSpentSeconds;
      existing.days.add(row.workDate);
      // Rows arrive date-ordered, so the most recent name seen wins and a
      // renamed person shows under their current name.
      if (row.personName) existing.name = row.personName;
    } else {
      totals.set(row.personId, {
        seconds: row.timeSpentSeconds,
        name: row.personName,
        days: new Set([row.workDate]),
      });
    }
  }

  const people = [...totals.entries()]
    .map(([personId, total]) => ({
      value: personId,
      label: total.name ?? personId,
      hours: toHours(total.seconds),
      daysWorked: total.days.size,
    }))
    .sort((left, right) => right.hours - left.hours || left.label.localeCompare(right.label));

  return [{ value: ALL_CATEGORIES, label: "Everyone", hours: 0, daysWorked: 0 }, ...people];
}

function toProjectOptions(rows: FactRows, issues: IssueRows, projects: ProjectRows): ProjectOptionDTO[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!row.parentKey) continue;
    totals.set(row.parentKey, (totals.get(row.parentKey) ?? 0) + row.timeSpentSeconds);
  }

  // Jira's project key to the name somebody actually recognises. Never
  // hardcoded: an installation renames a client and this follows.
  const clientNames = new Map(projects.map((project) => [project.projectKey, project.name]));

  const options: ProjectOptionDTO[] = [
    {
      value: ALL_CATEGORIES,
      label: "All projects",
      summary: null,
      category: null,
      hours: 0,
      clientKey: null,
      clientName: null,
    },
  ];

  // Seeded from the projects themselves, not from the logged time, so a
  // project with nothing booked to it is still selectable. That is the whole
  // point of the list: you have to be able to look at the one nobody started.
  const projectRows = selectJobIssues(issues).map((issue) => ({
    value: issue.issueKey,
    // -----------------------------------------------------------------
    // THE TITLE, NOT THE KEY. This was `issue.issueKey`, which in Jira was a
    // readable "TSSS-59" that people said out loud. The app's key is a
    // generated id, so the selector would have listed a column of UUIDs -
    // technically correct and completely unusable.
    //
    // The key stays as `value`, because that is what the URL carries and
    // what every filter is validated against. Only the label changed.
    // -----------------------------------------------------------------
    label: issue.summary || issue.issueKey,
    summary: issue.summary,
    // SnapshotIssue types this optional, and ProjectOptionDTO does not.
    // Absent and null mean the same thing here and only one of them can be
    // rendered, so they are collapsed once, here.
    category: issue.category ?? null,
    hours: toHours(totals.get(issue.issueKey) ?? 0),
    clientKey: issue.projectKey ?? null,
    clientName: issue.projectKey ? (clientNames.get(issue.projectKey) ?? issue.projectKey) : null,
  }));

  // Busiest first, then alphabetical, so the empty ones gather at the bottom
  // in a stable order rather than shuffling between renders.
  projectRows.sort((left, right) => right.hours - left.hours || left.value.localeCompare(right.value));

  return [...options, ...projectRows];
}

// -------------------------------------------------------------------
// The clients: who the work is for.
//
// Built from the JIRA PROJECT list rather than from the logged time, for the
// same reason the project list is: a client with nothing booked this period is
// still a client, and a selector that hides them cannot be used to ask "why is
// there nothing against them".
// -------------------------------------------------------------------
function toClientOptions(rows: FactRows, issues: IssueRows, projects: ProjectRows): ClientOptionDTO[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!row.projectKey) continue;
    totals.set(row.projectKey, (totals.get(row.projectKey) ?? 0) + row.timeSpentSeconds);
  }

  const projectCounts = new Map<string, number>();
  for (const issue of selectJobIssues(issues)) {
    if (!issue.projectKey) continue;
    projectCounts.set(issue.projectKey, (projectCounts.get(issue.projectKey) ?? 0) + 1);
  }

  const clients = projects.map((project) => ({
    value: project.projectKey,
    label: project.name || project.projectKey,
    category: project.category,
    hours: toHours(totals.get(project.projectKey) ?? 0),
    projectCount: projectCounts.get(project.projectKey) ?? 0,
  }));

  clients.sort((left, right) => right.hours - left.hours || left.label.localeCompare(right.label));

  return [
    { value: ALL_CATEGORIES, label: "All clients", category: null, hours: 0, projectCount: 0 },
    ...clients,
  ];
}

// -------------------------------------------------------------------
// Admin timesheets service
//
// The guard lives HERE, not only in the page or the area layout. A service
// that trusts its caller is only as safe as the least careful caller it ever
// acquires, and this one returns every person's hours and every client's
// billing position.
//
// The month arrives from the URL and is validated against a pattern before it
// is used. It is not an identifier and grants no access - the role check above
// already decided that - but an unvalidated string would still reach date
// parsing, and a period of "Invalid Date" renders as an empty report that
// looks exactly like a quiet month.
// -------------------------------------------------------------------
export async function getAdminTimesheetsService(
  request: TimesheetRequest = {},
  // When the screen is scoped to one person, their contracted week replaces
  // the company-wide assumption. Without it the cards and the chart on the
  // same screen report different utilisation for the same person, which is
  // worse than either being wrong on its own.
  capacityOverride?: { hoursPerDay: number; periodHours: number; workingWeekdays?: number[] | null },
): Promise<AdminTimesheetsDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    // Today in the app zone, never from the server clock.
    const todayIso = todayInAppZone();

    const granularity: Granularity = isGranularity(request.granularity) ? request.granularity : DEFAULT_GRANULARITY;
    // The floor the whole feature measures against. Falls back to the sync
    // start date so one setting can drive both; undefined means no floor.
    const resolved = resolvePeriod(
      granularity,
      request.start ?? todayIso,
      todayIso,
      envServer.TIMESHEET_HISTORY_START ?? envServer.JIRA_SYNC_START_DATE,
    );

    const period: TimesheetPeriodDTO = {
      granularity,
      start: resolved.start,
      label: resolved.label,
      // resolved.from, NOT resolved.start: this is the clamped range, and it
      // is what makes capacity stop counting days that predate the records.
      from: resolved.from,
      to: resolved.end,
      previousStart: resolved.previousStart,
      nextStart: resolved.nextStart,
      hasNext: resolved.hasNext,
      hasPrevious: resolved.hasPrevious,
      clipped: resolved.clipped,
      isCurrent: resolved.isCurrent,
    };

    // -----------------------------------------------------------------
    // FIVE READS OF THE APP'S OWN DATA, in parallel, fixed in number.
    //
    // This used to read a Jira-synced model - worklog facts, cached issues,
    // the space list and the sync watermark. It reads clients, projects,
    // tasks and time entries now. The engine underneath is untouched: the
    // switch is a mapping, which is the only honest way to move a report
    // about money without changing what it says.
    //
    // ENTRIES ARE SCOPED TO THE PERIOD; tasks and projects are not. The
    // period bounds the HOURS, but the option lists and the budget table
    // both have to show work with nothing booked to it - a project with a
    // quote and no time against it is the row somebody most needs to see.
    // -----------------------------------------------------------------
    const [entryRows, taskRows, projectDefinitions, clientRows, totalEntries, latestWorkDate] =
      await Promise.all([
        getReportingTimeEntriesInRangeRepo(period.from, period.to),
        getReportingTasksRepo(),
        getReportingProjectsRepo(),
        getReportingClientsRepo(),
        countReportingTimeEntriesRepo(),
        latestReportingWorkDateRepo(),
      ]);

    // Resolved into the shapes the filtering and the option builders below
    // already work on. See app-snapshot.ts for what each field becomes and
    // for the four mappings that compile fine and produce wrong numbers.
    const factRows = toReportingFactRows(entryRows, taskRows);
    const issueRows = toReportingIssueRows(taskRows, projectDefinitions);

    // Clients, in the shape these option builders were written against. Jira
    // called a client a "project" and the name survives in `projectKey`; the
    // category is the display label because the split below uses it as both
    // the key and the text on screen.
    const projectRows: ProjectRows = clientRows.map((client) => ({
      projectKey: client.clientId,
      name: client.name,
      category: PROJECT_CATEGORY_LABELS[client.category],
    }));

    // The option lists are built from the WHOLE period and the whole book of
    // work, before any filter is applied. Deriving them from the filtered rows
    // would make the selector erase its own options: pick External once and
    // Internal disappears, with no way back.
    const categoryOptions = toCategoryOptions(factRows, projectRows);
    const clientOptions = toClientOptions(factRows, issueRows, projectRows);
    const allProjectOptions = toProjectOptions(factRows, issueRows, projectRows);
    const personOptions = toPersonOptions(factRows);

    // A filter value that is not in this period's options falls back to "all"
    // rather than yielding an empty report. A stale link to last month's
    // project should show the period, not an unexplained blank page.
    const category = categoryOptions.some((option) => option.value === request.category)
      ? (request.category as string)
      : ALL_CATEGORIES;
    const client = clientOptions.some((option) => option.value === request.client)
      ? (request.client as string)
      : ALL_CATEGORIES;

    // The project list NARROWS to the chosen client, so the dropdown offers
    // that client's work rather than everybody's. Built after the client is
    // known, and it is the list the project value is validated against - which
    // is what makes a project belonging to another client fall back to "all"
    // instead of silently showing nothing.
    const projectOptions =
      client === ALL_CATEGORIES
        ? allProjectOptions
        : allProjectOptions.filter((option) => option.value === ALL_CATEGORIES || option.clientKey === client);

    const project = projectOptions.some((option) => option.value === request.project)
      ? (request.project as string)
      : ALL_CATEGORIES;
    // Several people, comma separated. Each id is checked against this
    // period's options for the same reason the others are: an id that is not
    // here should narrow nothing rather than empty the screen.
    const offeredPeople = new Set(personOptions.map((option) => option.value));

    // WHAT WAS ASKED FOR, kept separately from what survived validation. The
    // difference between the two is the whole point - see the filter below.
    const requestedPeople = (request.person ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value !== ALL_CATEGORIES);

    const people = requestedPeople.filter((value) => offeredPeople.has(value));

    // The single-person view, for the screens that are about one person by
    // definition. Exactly one selected gives that id; none or several give
    // 'all', because "one person" is not a meaningful answer for two.
    const person = people.length === 1 ? people[0] : ALL_CATEGORIES;

    const billable = (BILLABLE_FILTERS as readonly string[]).includes(request.billable ?? "")
      ? (request.billable as BillableFilter)
      : ALL_CATEGORIES;

    const peopleSet = new Set(people);

    const filteredRows = factRows.filter(
      (row) =>
        (category === ALL_CATEGORIES || row.category === category) &&
        // The fact still speaks Jira here: its projectKey is the client.
        (client === ALL_CATEGORIES || row.projectKey === client) &&
        (project === ALL_CATEGORIES || row.parentKey === project) &&
        // -------------------------------------------------------------
        // A PERSON WAS ASKED FOR, SO ONLY THAT PERSON'S ROWS PASS - even
        // when the answer is none of them.
        //
        // This read `people.length === 0`, and `people` is what SURVIVED
        // validation against this period's own option list. That list comes
        // from the period's worklogs, so somebody with a staff target who
        // logged nothing this month is not in it: their id was dropped,
        // `people` went empty, and an empty `people` meant NO NARROWING AT
        // ALL. /admin/timesheets/staff/[personId] forces person=<id>, so
        // that page showed the whole company's time under one person's name,
        // with the tiles and the chart to match.
        //
        // Asking against `requestedPeople` keeps the narrowing whenever
        // anybody was named. An id that is not in the period now yields an
        // empty report, which is the truthful answer to "what did this
        // person log" - and a far better one than everybody's hours wearing
        // their name.
        // -------------------------------------------------------------
        (requestedPeople.length === 0 || peopleSet.has(row.personId)) &&
        // 'unset' means the row's billable flag is null - its own state, never
        // folded in with non-billable.
        (billable === ALL_CATEGORIES ||
          (billable === "unset" ? row.billable === null : row.billable === billable)),
    );

    // The issues are filtered to match, so the JOB LIST narrows with the rest
    // of the screen. Leaving them unfiltered would show every job in the
    // business under a heading that says "External", which is worse than
    // showing none.
    const filteredIssues = issueRows.filter((issue) => {
      if (category !== ALL_CATEGORIES && issue.category !== category) return false;
      if (client !== ALL_CATEGORIES && issue.projectKey !== client) return false;
      if (project !== ALL_CATEGORIES && issue.issueKey !== project && issue.parentKey !== project) return false;
      return true;
    });

    // Filtering happens on the fact rows, BEFORE the engine runs, so every
    // roll-up, the billable split and the audit all describe the same
    // selection. Filtering a finished report would leave totals that no longer
    // matched the rows under them.
    const snapshot: TimesheetSnapshot = {
      worklogs: toSnapshotWorklogs(filteredRows),
      // Already SnapshotIssue rows - toReportingIssueRows produced them. There
      // is no second mapping here because there is nothing left to map.
      issues: filteredIssues,
      today: todayIso,
      options: { workingHoursPerDay: envServer.WORKING_DAY_HOURS, periodStart: period.from, periodEnd: period.to },
    };

    const periodSeconds = factRows.reduce((total, row) => total + row.timeSpentSeconds, 0);

    const report = buildReport(snapshot);

    const periodDayTotals = report.byPersonDay;

    return {
      period,
      todayIso,
      filters: { granularity, start: period.start, category, client, project, people, person, billable },
      categoryOptions,
      clientOptions,
      projectOptions,
      personOptions,
      report,
      // Built from the report's own day totals, so the chart is another view of
      // the same numbers rather than a second calculation of them.
      //
      // Note it reads UNFILTERED-BY-PERIOD day totals: the chosen week can
      // straddle a month boundary, and a chart that silently dropped the days
      // outside the selected month would show a short week with no explanation.
      periodSeries: buildDailySeries(periodDayTotals, {
        from: period.from,
        to: period.to,
        capacityHours: capacityOverride?.hoursPerDay ?? envServer.WORKING_DAY_HOURS,
        // WHICH days, when the view is scoped to one person who has them set.
        // buildDailySeries counts in getUTCDay terms (0 = Sunday) while
        // staff_target stores ISO (7 = Sunday), so 7 maps back to 0. Without
        // that conversion a Sunday worker would silently get no target at all.
        workingWeekdays: capacityOverride?.workingWeekdays?.map((iso) => (iso === 7 ? 0 : iso)),
        // A week shows all seven days because the shape of the week is the
        // point; longer periods drop empty weekends so the chart is not a
        // third blank.
        includeNonWorkingDays: granularity === "week",
        bucket: bucketFor(granularity),
        availableHoursOverride: capacityOverride?.periodHours,
      }),
      periodTotalHours: Math.round((periodSeconds / 3600) * 10000) / 10000,
      // What there is to report on at all - see DataStatusDTO. It answers the
      // one question an empty screen cannot: quiet period, or nobody has ever
      // logged an hour here.
      dataStatus: { totalEntries, latestWorkDate },
      workingHoursPerDay: envServer.WORKING_DAY_HOURS,
    };
  } catch (error) {
    throw handleError("getAdminTimesheetsService", error);
  }
}

// -------------------------------------------------------------------
// The same period's facts as CSV.
//
// Re-runs the whole service rather than taking a report from a caller, so the
// export carries its own guard and its own numbers. An export that trusted a
// caller-supplied report would be a way to read another period's hours.
//
// One row per worklog: the export exists so somebody can check the dashboard's
// arithmetic in Excel, which means it has to be the grain the totals were
// summed from, not a copy of the summary.
// -------------------------------------------------------------------
export async function getAdminTimesheetsCsvService(
  request: TimesheetRequest = {},
): Promise<{ filename: string; csv: string }> {
  try {
    const { period, filters, report } = await getAdminTimesheetsService(request);

    const header = [
      "worklog_id",
      "work_date",
      "person",
      "person_id",
      "issue_key",
      "issue_summary",
      "parent_key",
      "parent_summary",
      "project_key",
      "category",
      "hours",
      "seconds",
      "billable",
      "billable_source",
      "has_narrative",
    ];

    const rows = report.facts.map((fact) => [
      fact.worklogId,
      fact.workDate,
      fact.personName ?? "",
      fact.personId,
      fact.issueKey,
      fact.issueSummary ?? "",
      fact.parentKey ?? "",
      fact.parentSummary ?? "",
      fact.projectKey ?? "",
      fact.category ?? "",
      // Hours to four places, from the same conversion the dashboard uses.
      String(Math.round((fact.timeSpentSeconds / 3600) * 10000) / 10000),
      String(fact.timeSpentSeconds),
      fact.billable ?? "",
      fact.billableSource,
      fact.hasNarrative ? "yes" : "no",
    ]);

    // The filename records the filter, so two exports from the same month do
    // not overwrite each other in the downloads folder and nobody invoices
    // from the wrong one.
    const scope = [filters.category, filters.client, filters.project, filters.person]
      .filter((part) => part !== ALL_CATEGORIES)
      // An accountId contains a colon, which is not valid in a filename.
      .map((part) => part.replace(/[^A-Za-z0-9-]+/g, ""))
      .join("-");

    return {
      filename: `timesheet-${period.start}${scope ? `-${scope}` : ""}.csv`,
      csv: [header, ...rows].map((row) => row.map(toCsvCell).join(",")).join("\r\n"),
    };
  } catch (error) {
    throw handleError("getAdminTimesheetsCsvService", error);
  }
}

// -------------------------------------------------------------------
// Quote a CSV cell.
//
// Always quoted, never conditionally. A summary containing a comma is normal,
// and the leading apostrophe on a value starting with = + - or @ stops Excel
// treating a work description as a formula - which is both a corrupted export
// and, with a crafted issue summary, a way to run something on the machine of
// whoever opens it.
// -------------------------------------------------------------------
function toCsvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

// -------------------------------------------------------------------
// The team dashboard.
//
// Everyone who logged time in the period, each measured against THEIR
// contracted arrangement rather than one company-wide assumption. Somebody on
// three days a week who worked three full days is at 100%, and this is the
// function that makes that true.
//
// People with a target but no time in the period are included too: "contracted
// to four days and logged nothing" is the most important row on the page, and
// building the list from the facts alone would hide it.
// -------------------------------------------------------------------
export async function getStaffDashboardService(request: TimesheetRequest = {}): Promise<{
  data: AdminTimesheetsDTO;
  dashboard: StaffDashboardDTO;
}> {
  try {
    // Targets are loaded before the report so a person-scoped view can build
    // its chart against the right capacity in one pass.
    const targets = await loadStaffTargets();
    const targetByPerson = new Map(targets.map((row) => [row.personId, row]));

    const scopedCapacity =
      request.person && request.person !== ALL_CATEGORIES
        ? toStaffCapacity(targetByPerson.get(request.person) ?? null, request.person)
        : null;

    // The scoped person's capacity has to be prorated to whatever period is
    // being shown, not just a week - a year view against a weekly figure would
    // report everyone at several thousand per cent.
    const probe = await getAdminTimesheetsService(request);

    const data = scopedCapacity
      ? await getAdminTimesheetsService(request, {
          hoursPerDay: scopedCapacity.hoursPerDay,
          periodHours: capacityHoursForRange(scopedCapacity, probe.period.from, probe.period.to),
          // So the chart's per-day target is zero on days this person does not
          // work, rather than drawing a full day across the whole week.
          workingWeekdays: scopedCapacity.workingWeekdays,
        })
      : probe;
    const weekdaysInPeriod = countWeekdays(data.period.from, data.period.to);

    // Everyone with time, plus everyone with a target, so a contracted person
    // who logged nothing still appears.
    const personIds = new Set<string>([
      ...data.report.byPerson.map((person) => person.personId),
      ...targets.map((row) => row.personId),
    ]);

    const people: StaffSummaryDTO[] = [...personIds].map((personId) => {
      const totals = data.report.byPerson.find((person) => person.personId === personId);
      const targetRow = targetByPerson.get(personId) ?? null;
      const capacity = toStaffCapacity(targetRow, personId);

      // Day-aware: somebody contracted to Monday, Tuesday and Wednesday is
      // measured against those days in this period, not against three fifths
      // of every weekday. Falls back to prorating when their days are unset.
      const performance = measureAgainstCapacity(
        capacity,
        capacityHoursForRange(capacity, data.period.from, data.period.to),
        totals?.hours ?? 0,
        totals?.split.billableHours ?? 0,
      );

      return {
        personId,
        // The name from the facts is the most recent Jira knows; the target's
        // snapshot covers somebody with no time this period.
        personName: totals?.personName ?? targetRow?.personName ?? personId,
        loggedHours: performance.loggedHours,
        capacityHours: performance.capacityHours,
        utilisation: performance.utilisation,
        billableHours: performance.billableHours,
        nonBillableHours: totals?.split.nonBillableHours ?? 0,
        billableShare: performance.billableShare,
        billableTargetPercent: performance.billableTargetPercent,
        billableVariance: performance.billableVariance,
        meetsBillableTarget: performance.meetsBillableTarget,
        daysWorked: totals?.daysWorked ?? 0,
        worklogCount: totals?.worklogCount ?? 0,
        target: {
          personId,
          personName: targetRow?.personName ?? totals?.personName ?? null,
          workingWeekdays: capacity.workingWeekdays,
          workingDaysPerWeek: capacity.workingDaysPerWeek,
          hoursPerDay: capacity.hoursPerDay,
          weeklyHours: capacity.weeklyHours,
          billableTargetPercent: capacity.billableTargetPercent,
          isDefault: capacity.isDefault,
        },
      };
    });

    // Busiest first. A stable secondary sort on name keeps the order steady
    // between renders when two people have logged the same amount.
    people.sort((left, right) => right.loggedHours - left.loggedHours || left.personName.localeCompare(right.personName));

    const capacityHours = people.reduce((total, person) => total + person.capacityHours, 0);
    const loggedHours = data.report.totals.hours;

    // ---------------------------------------------------------------
    // The chart's capacity has to match WHO is on screen.
    //
    // A daily track fixed at one person's 7.5h compares a whole team's hours
    // against a single person's day, which is what it was doing: three people
    // each contracted to 7.5h have a 22.5h day between them, and their bars
    // were being measured against 7.5.
    //
    // So the per-day track is the sum of every scoped person's full day. Note
    // this is deliberately NOT prorated by contracted days: it marks "a full
    // day for everyone in view", which is the ceiling a bar is read against.
    // The utilisation percentage below still divides by properly prorated
    // contracted capacity, so somebody on three days is not judged against
    // five - the two answer different questions and the subtitle says so.
    //
    // buildDailySeries is pure, so this rebuilds the series without another
    // trip to the database.
    // ---------------------------------------------------------------
    const inScope = scopedCapacity ? people.filter((person) => person.personId === request.person) : people;

    const dailyCapacityHours = inScope.reduce((total, person) => total + person.target.hoursPerDay, 0);
    const periodCapacityHours = inScope.reduce((total, person) => total + person.capacityHours, 0);

    // WHICH days the scoped person works, carried into the rebuild.
    //
    // This rebuild is why the per-day target looked unchanged at first: the
    // build inside getAdminTimesheetsService had the days and got it right,
    // and then this one replaced the series without them, putting a full-day
    // target back on every weekday.
    //
    // Only for a SINGLE person in scope. Two people with different days off
    // have no shared "day off", and blanking a day one of them works would
    // understate the pair - so a multi-person view keeps every weekday.
    const scopedWeekdays =
      inScope.length === 1 && inScope[0].target.workingWeekdays?.length
        ? inScope[0].target.workingWeekdays.map((iso) => (iso === 7 ? 0 : iso))
        : undefined;

    const scaledData: AdminTimesheetsDTO =
      dailyCapacityHours > 0
        ? {
            ...data,
            periodSeries: buildDailySeries(data.report.byPersonDay, {
              from: data.period.from,
              to: data.period.to,
              capacityHours: dailyCapacityHours,
              workingWeekdays: scopedWeekdays,
              includeNonWorkingDays: data.period.granularity === "week",
              bucket: bucketFor(data.period.granularity),
              availableHoursOverride: periodCapacityHours,
            }),
          }
        : data;

    return {
      data: scaledData,
      dashboard: {
        people,
        weekdaysInPeriod,
        totals: {
          loggedHours,
          capacityHours: Math.round(capacityHours * 10000) / 10000,
          billableHours: data.report.split.billableHours,
          nonBillableHours: data.report.split.nonBillableHours,
          unsetHours: data.report.split.unsetHours,
          utilisation: capacityHours > 0 ? Math.round((loggedHours / capacityHours) * 10000) / 10000 : null,
          billableShare: data.report.split.billableRatio,
          peopleCount: people.length,
          meetingTarget: people.filter((person) => person.meetsBillableTarget === true).length,
          withTarget: people.filter((person) => person.billableTargetPercent !== null).length,
        },
      },
    };
  } catch (error) {
    throw handleError("getStaffDashboardService", error);
  }
}

// -------------------------------------------------------------------
// The company overview.
//
// The questions a director actually asks, which the entry list cannot answer:
// where is the time going, which jobs are eating it, and how much of it could
// actually be invoiced today. The day-by-day shape of the week comes from the
// same weekly series every other screen uses, so the bars on the overview and
// the bars on a person can never disagree.
// -------------------------------------------------------------------
export async function getOverviewService(request: TimesheetRequest = {}): Promise<{
  data: AdminTimesheetsDTO;
  overview: OverviewDTO;
}> {
  try {
    const { data, dashboard } = await getStaffDashboardService(request);

    // What each job is called, for the "where is the time going" list. Keyed
    // by task id, which is what a fact's issueKey is now - the Jira issue key
    // it replaced was readable and this one is not, so the title is no longer
    // a nicety here, it is the only thing that makes the list mean anything.
    const tasks = await loadReportingTasks();
    const summaryByKey = new Map(tasks.map((task) => [task.taskId, task.title]));

    // The period's own facts, already narrowed to the current selection by the
    // report that produced them.
    const periodFacts = data.report.facts;

    return {
      data,
      overview: {
        categories: buildCategorySplit(periodFacts),
        topJobs: buildTopJobs(periodFacts, summaryByKey),
        readiness: buildInvoiceReadiness(periodFacts),
        capacityHours: dashboard.totals.capacityHours,
        utilisation: dashboard.totals.utilisation,
        peopleCount: dashboard.totals.peopleCount,
        weekdaysInPeriod: dashboard.weekdaysInPeriod,
      },
    };
  } catch (error) {
    throw handleError("getOverviewService", error);
  }
}
