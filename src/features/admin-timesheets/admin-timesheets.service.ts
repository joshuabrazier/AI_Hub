import "server-only";

import { endOfMonth, format, parseISO, subMonths } from "date-fns";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import {
  countWorklogFactsRepo,
  getJiraIssuesRepo,
  getJiraProjectsRepo,
  getSyncWatermarkRepo,
  getWorklogFactsInRangeRepo,
} from "@/lib/data/repositories/timesheet.repository";
import { envServer } from "@/lib/env-server";
import { handleError } from "@/lib/handle-errors";
import { buildReport } from "@/lib/timesheet/aggregate";
import { addDays, buildDailySeries, mondayOf } from "@/lib/timesheet/daily-series";
import { JIRA_WORKLOG_SYNC_JOB } from "@/features/timesheet-sync/timesheet-sync.service";
import { SnapshotIssue, SnapshotWorklog, TimesheetSnapshot } from "@/lib/timesheet/timesheet.types";
import { todayInAppZone } from "@/lib/timezone";

import {
  ALL_CATEGORIES,
  AdminTimesheetsDTO,
  CategoryOptionDTO,
  MonthOptionDTO,
  PersonOptionDTO,
  ProjectOptionDTO,
  TimesheetPeriodDTO,
} from "./admin-timesheets.types";

// How far back the month picker offers. Twelve is a financial year plus a
// month of overlap, which covers every period anyone asks to re-check.
const MONTHS_OFFERED = 12;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// -------------------------------------------------------------------
// A 'YYYY-MM' to its inclusive bounds.
//
// The bounds are strings because work_date is a DATE and comes back as a
// string; the round trip through parseISO here is calendar arithmetic only,
// and hands back 'YYYY-MM-DD' so no date column ever becomes a Date the app
// then compares.
// -------------------------------------------------------------------
function toPeriod(month: string): TimesheetPeriodDTO {
  const from = `${month}-01`;
  const firstDay = parseISO(from);

  return {
    month,
    label: format(firstDay, "MMMM yyyy"),
    from,
    to: format(endOfMonth(firstDay), "yyyy-MM-dd"),
  };
}

// -------------------------------------------------------------------
// The months the picker offers, most recent first, ending with the current
// one in the app's zone rather than the server's.
// -------------------------------------------------------------------
function monthOptions(currentMonth: string): MonthOptionDTO[] {
  const anchor = parseISO(`${currentMonth}-01`);

  return Array.from({ length: MONTHS_OFFERED }, (unused, index) => {
    const date = subMonths(anchor, index);
    return { value: format(date, "yyyy-MM"), label: format(date, "MMMM yyyy") };
  });
}

// -------------------------------------------------------------------
// Read-model rows to the engine's snapshot shape.
//
// A straight rename, deliberately: no defaulting, no coercion, no filling in
// of blanks. Anything missing has to reach the engine as missing so the audit
// can report it, rather than being quietly patched here where nobody would
// ever see it happen.
// -------------------------------------------------------------------
function toSnapshotWorklogs(rows: Awaited<ReturnType<typeof getWorklogFactsInRangeRepo>>): SnapshotWorklog[] {
  return rows.map((row) => ({
    worklogId: row.worklogId,
    issueKey: row.issueKey,
    personId: row.personId,
    personName: row.personName,
    workDate: row.workDate,
    startSecond: row.startSecond,
    timeSpentSeconds: row.timeSpentSeconds,
    narrative: row.narrative,
  }));
}

function toSnapshotIssues(rows: Awaited<ReturnType<typeof getJiraIssuesRepo>>): SnapshotIssue[] {
  return rows.map((row) => ({
    issueKey: row.issueKey,
    parentKey: row.parentKey,
    projectKey: row.projectKey,
    issueType: row.issueType,
    summary: row.summary,
    category: row.category,
    billable: row.billable,
    baselineEstimateSeconds: row.baselineEstimateSeconds,
    currentEstimateSeconds: row.currentEstimateSeconds,
  }));
}

// What the URL asked for. Every field is untrusted and validated below.
export interface TimesheetRequest {
  month?: string;
  category?: string;
  project?: string;
  person?: string;
  // Monday of the week the chart shows, 'YYYY-MM-DD'.
  week?: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type FactRows = Awaited<ReturnType<typeof getWorklogFactsInRangeRepo>>;

const SECONDS_TO_HOURS = 3600;

function toHours(seconds: number): number {
  return Math.round((seconds / SECONDS_TO_HOURS) * 10000) / 10000;
}

// "10-16 Aug 2026", or "31 Aug-6 Sep 2026" when the week straddles two months.
function toWeekLabel(start: string, end: string): string {
  const from = parseISO(start);
  const to = parseISO(end);

  return format(from, "yyyy-MM") === format(to, "yyyy-MM")
    ? `${format(from, "d")}-${format(to, "d MMM yyyy")}`
    : `${format(from, "d MMM")}-${format(to, "d MMM yyyy")}`;
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

function toCategoryOptions(rows: FactRows, projects: Awaited<ReturnType<typeof getJiraProjectsRepo>>): CategoryOptionDTO[] {
  const totals = new Map<string, { seconds: number; count: number }>();

  // Seed from the PROJECT list, not from the logged time. A category that
  // exists in Jira with nothing booked against it has to show as zero, because
  // "Internal exists and has no hours" and "there is no such thing as
  // Internal" are completely different facts - and the first one means time is
  // being recorded somewhere other than Jira, which is exactly what somebody
  // needs to notice.
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
type IssueRows = Awaited<ReturnType<typeof getJiraIssuesRepo>>;

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

function toProjectOptions(rows: FactRows, issues: IssueRows): ProjectOptionDTO[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!row.parentKey) continue;
    totals.set(row.parentKey, (totals.get(row.parentKey) ?? 0) + row.timeSpentSeconds);
  }

  const options: ProjectOptionDTO[] = [
    { value: ALL_CATEGORIES, label: "All jobs", summary: null, category: null, hours: 0 },
  ];

  // Seeded from the jobs themselves, not from the logged time, so a job with
  // nothing booked to it is still selectable. That is the whole point of a job
  // list: you have to be able to look at the job that has not started.
  const jobs = selectJobIssues(issues).map((issue) => ({
    value: issue.issueKey,
    label: issue.issueKey,
    summary: issue.summary,
    category: issue.category,
    hours: toHours(totals.get(issue.issueKey) ?? 0),
  }));

  // Busiest first, then alphabetical, so the empty jobs gather at the bottom
  // in a stable order rather than shuffling between renders.
  jobs.sort((left, right) => right.hours - left.hours || left.value.localeCompare(right.value));

  return [...options, ...jobs];
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
export async function getAdminTimesheetsService(request: TimesheetRequest = {}): Promise<AdminTimesheetsDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    // Today in the app zone, never from the server clock.
    const todayIso = todayInAppZone();
    const currentMonth = todayIso.slice(0, 7);

    const month = request.month && MONTH_PATTERN.test(request.month) ? request.month : currentMonth;
    const period = toPeriod(month);

    const [factRows, issueRows, projectRows, watermark, totalWorklogs] = await Promise.all([
      getWorklogFactsInRangeRepo(period.from, period.to),
      getJiraIssuesRepo(),
      getJiraProjectsRepo(),
      getSyncWatermarkRepo(JIRA_WORKLOG_SYNC_JOB),
      countWorklogFactsRepo(),
    ]);

    // The option lists are built from the WHOLE period and the whole book of
    // work, before any filter is applied. Deriving them from the filtered rows
    // would make the selector erase its own options: pick External once and
    // Internal disappears, with no way back.
    const categoryOptions = toCategoryOptions(factRows, projectRows);
    const projectOptions = toProjectOptions(factRows, issueRows);
    const personOptions = toPersonOptions(factRows);

    // A filter value that is not in this period's options falls back to "all"
    // rather than yielding an empty report. A stale link to last month's
    // project should show the period, not an unexplained blank page.
    const category = categoryOptions.some((option) => option.value === request.category)
      ? (request.category as string)
      : ALL_CATEGORIES;
    const project = projectOptions.some((option) => option.value === request.project)
      ? (request.project as string)
      : ALL_CATEGORIES;
    const person = personOptions.some((option) => option.value === request.person)
      ? (request.person as string)
      : ALL_CATEGORIES;

    const filteredRows = factRows.filter(
      (row) =>
        (category === ALL_CATEGORIES || row.category === category) &&
        (project === ALL_CATEGORIES || row.parentKey === project) &&
        (person === ALL_CATEGORIES || row.personId === person),
    );

    // The issues are filtered to match, so the JOB LIST narrows with the rest
    // of the screen. Leaving them unfiltered would show every job in the
    // business under a heading that says "External", which is worse than
    // showing none.
    const filteredIssues = issueRows.filter((issue) => {
      if (category !== ALL_CATEGORIES && issue.category !== category) return false;
      if (project !== ALL_CATEGORIES && issue.issueKey !== project && issue.parentKey !== project) return false;
      return true;
    });

    // Filtering happens on the fact rows, BEFORE the engine runs, so every
    // roll-up, the billable split and the audit all describe the same
    // selection. Filtering a finished report would leave totals that no longer
    // matched the rows under them.
    const snapshot: TimesheetSnapshot = {
      worklogs: toSnapshotWorklogs(filteredRows),
      issues: toSnapshotIssues(filteredIssues),
      today: todayIso,
      options: { workingHoursPerDay: envServer.WORKING_DAY_HOURS, periodStart: period.from, periodEnd: period.to },
    };

    const periodSeconds = factRows.reduce((total, row) => total + row.timeSpentSeconds, 0);

    const report = buildReport(snapshot);

    // ---------------------------------------------------------------
    // The week the chart shows.
    //
    // Defaults to the week of the most recent entry in the period rather than
    // to today's week. Opening on an empty current week, when the last work
    // logged was a fortnight ago, makes the chart look broken - and the first
    // thing anyone wants to see is the last week that had anything in it.
    // ---------------------------------------------------------------
    const latestFactDate = factRows.length > 0 ? factRows[factRows.length - 1].workDate : null;
    const weekAnchor =
      (request.week && DATE_PATTERN.test(request.week) ? request.week : null) ??
      latestFactDate ??
      (todayIso >= period.from && todayIso <= period.to ? todayIso : period.to);

    const weekStart = mondayOf(weekAnchor);
    const weekEnd = addDays(weekStart, 6);
    const nextStart = addDays(weekStart, 7);

    const week = {
      start: weekStart,
      end: weekEnd,
      label: toWeekLabel(weekStart, weekEnd),
      previousStart: addDays(weekStart, -7),
      nextStart,
      // Only offer the next week once it has actually begun.
      hasNext: nextStart <= todayIso,
    };

    // A week can straddle a month boundary, so its facts are fetched for the
    // week's own range rather than sliced out of the period's. The same filters
    // are applied, so the chart always describes the same selection as the
    // tables.
    const weekFactRows = (await getWorklogFactsInRangeRepo(weekStart, weekEnd)).filter(
      (row) =>
        (category === ALL_CATEGORIES || row.category === category) &&
        (project === ALL_CATEGORIES || row.parentKey === project) &&
        (person === ALL_CATEGORIES || row.personId === person),
    );

    const weekDayTotals = buildReport({
      worklogs: toSnapshotWorklogs(weekFactRows),
      issues: toSnapshotIssues(filteredIssues),
      today: todayIso,
      options: { workingHoursPerDay: envServer.WORKING_DAY_HOURS, periodStart: weekStart, periodEnd: weekEnd },
    }).byPersonDay;

    return {
      period,
      filters: { month, category, project, person },
      monthOptions: monthOptions(currentMonth),
      categoryOptions,
      projectOptions,
      personOptions,
      report,
      week,
      // Built from the report's own day totals, so the chart is another view of
      // the same numbers rather than a second calculation of them.
      //
      // Note it reads UNFILTERED-BY-PERIOD day totals: the chosen week can
      // straddle a month boundary, and a chart that silently dropped the days
      // outside the selected month would show a short week with no explanation.
      weekSeries: buildDailySeries(weekDayTotals, {
        from: week.start,
        to: week.end,
        capacityHours: envServer.WORKING_DAY_HOURS,
        includeNonWorkingDays: true,
      }),
      periodTotalHours: Math.round((periodSeconds / 3600) * 10000) / 10000,
      syncStatus: {
        configured: Boolean(envServer.JIRA_BASE_URL && envServer.JIRA_EMAIL && envServer.JIRA_API_TOKEN),
        lastSuccessAt: watermark?.lastSuccessAt ?? null,
        lastRunAt: watermark?.lastRunAt ?? null,
        lastError: watermark?.lastError ?? null,
        lastUpdatedCount: watermark?.lastUpdatedCount ?? 0,
        totalWorklogs,
      },
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
    const scope = [filters.category, filters.project, filters.person]
      .filter((part) => part !== ALL_CATEGORIES)
      // An accountId contains a colon, which is not valid in a filename.
      .map((part) => part.replace(/[^A-Za-z0-9-]+/g, ""))
      .join("-");

    return {
      filename: `timesheet-${period.month}${scope ? `-${scope}` : ""}.csv`,
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
