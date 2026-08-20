import "server-only";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import {
  countWorklogFactsRepo,
  getJiraIssuesRepo,
  getJiraProjectsRepo,
  getStaffTargetsRepo,
  getSyncWatermarkRepo,
  getWorklogFactsInRangeRepo,
} from "@/lib/data/repositories/timesheet.repository";
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
  capacityHoursForPeriod,
  countWeekdays,
  measureAgainstTarget,
  toStaffCapacity,
} from "@/lib/timesheet/staff-capacity";
import { JIRA_WORKLOG_SYNC_JOB } from "@/features/timesheet-sync/timesheet-sync.service";
import { SnapshotIssue, SnapshotWorklog, TimesheetSnapshot } from "@/lib/timesheet/timesheet.types";
import { todayInAppZone } from "@/lib/timezone";

import {
  ALL_CATEGORIES,
  BILLABLE_FILTERS,
  type BillableFilter,
  AdminTimesheetsDTO,
  CategoryOptionDTO,
  PersonOptionDTO,
  ProjectOptionDTO,
  OverviewDTO,
  StaffDashboardDTO,
  StaffSummaryDTO,
  TimesheetPeriodDTO,
} from "./admin-timesheets.types";


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
  // "week" | "fortnight" | "month" | "year". Anything else falls back to the
  // default rather than erroring, so a stale link still opens.
  granularity?: string;
  // Any date inside the wanted period, 'YYYY-MM-DD'. It is snapped to the
  // start of its period, so the 15th and the 20th open the same month.
  start?: string;
  category?: string;
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


type FactRows = Awaited<ReturnType<typeof getWorklogFactsInRangeRepo>>;

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
export async function getAdminTimesheetsService(
  request: TimesheetRequest = {},
  // When the screen is scoped to one person, their contracted week replaces
  // the company-wide assumption. Without it the cards and the chart on the
  // same screen report different utilisation for the same person, which is
  // worse than either being wrong on its own.
  capacityOverride?: { hoursPerDay: number; periodHours: number },
): Promise<AdminTimesheetsDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    // Today in the app zone, never from the server clock.
    const todayIso = todayInAppZone();

    const granularity: Granularity = isGranularity(request.granularity) ? request.granularity : DEFAULT_GRANULARITY;
    const resolved = resolvePeriod(granularity, request.start ?? todayIso, todayIso);

    const period: TimesheetPeriodDTO = {
      granularity,
      start: resolved.start,
      label: resolved.label,
      from: resolved.start,
      to: resolved.end,
      previousStart: resolved.previousStart,
      nextStart: resolved.nextStart,
      hasNext: resolved.hasNext,
      isCurrent: resolved.isCurrent,
    };

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
    // Several people, comma separated. Each id is checked against this
    // period's options for the same reason the others are: an id that is not
    // here should narrow nothing rather than empty the screen.
    const offeredPeople = new Set(personOptions.map((option) => option.value));

    const people = (request.person ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value !== ALL_CATEGORIES && offeredPeople.has(value));

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
        (project === ALL_CATEGORIES || row.parentKey === project) &&
        (people.length === 0 || peopleSet.has(row.personId)) &&
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

    const periodDayTotals = report.byPersonDay;

    return {
      period,
      todayIso,
      filters: { granularity, start: period.start, category, project, people, person, billable },
      categoryOptions,
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
        // A week shows all seven days because the shape of the week is the
        // point; longer periods drop empty weekends so the chart is not a
        // third blank.
        includeNonWorkingDays: granularity === "week",
        bucket: bucketFor(granularity),
        availableHoursOverride: capacityOverride?.periodHours,
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
    const targets = await getStaffTargetsRepo();
    const targetByPerson = new Map(targets.map((row) => [row.personId, row]));

    const scopedCapacity =
      request.person && request.person !== ALL_CATEGORIES
        ? toStaffCapacity(targetByPerson.get(request.person) ?? null, request.person)
        : null;

    // The scoped person's capacity has to be prorated to whatever period is
    // being shown, not just a week - a year view against a weekly figure would
    // report everyone at several thousand per cent.
    const probe = await getAdminTimesheetsService(request);
    const weekdays = countWeekdays(probe.period.from, probe.period.to);

    const data = scopedCapacity
      ? await getAdminTimesheetsService(request, {
          hoursPerDay: scopedCapacity.hoursPerDay,
          periodHours: capacityHoursForPeriod(scopedCapacity, weekdays),
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

      const performance = measureAgainstTarget(
        capacity,
        weekdaysInPeriod,
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

    const scaledData: AdminTimesheetsDTO =
      dailyCapacityHours > 0
        ? {
            ...data,
            periodSeries: buildDailySeries(data.report.byPersonDay, {
              from: data.period.from,
              to: data.period.to,
              capacityHours: dailyCapacityHours,
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

    const issues = await getJiraIssuesRepo();
    const summaryByKey = new Map(issues.map((issue) => [issue.issueKey, issue.summary]));

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
