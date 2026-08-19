import { runAuditRules } from "./audit-rules";
import {
  BillableSplit,
  BudgetRow,
  DurationTotals,
  Finding,
  PersonDayTotal,
  PersonTotal,
  ProjectTotal,
  SnapshotIssue,
  TimesheetOptions,
  TimesheetReport,
  TimesheetSnapshot,
  WorklogFactRow,
} from "./timesheet.types";

// -------------------------------------------------------------------
// Timesheet aggregation core
//
// A snapshot goes in, a report comes out. No dependencies, no I/O, no clock.
// The same function runs in the sync job, behind the API and in tests, which
// is the only reliable way to stop three code paths from producing three
// different answers to "what do we bill this month".
//
// Everything is summed in whole seconds and converted to hours at the edge.
// -------------------------------------------------------------------

const SECONDS_PER_HOUR = 3600;

const DEFAULT_WORKING_HOURS_PER_DAY = 7.5;
const DEFAULT_MAX_DAILY_HOURS = 12;

const BILLABLE = "Billable";
const NON_BILLABLE = "Non-billable";

// -------------------------------------------------------------------
// Seconds to hours, rounded to 4 decimal places.
//
// Rounding happens ONCE, on the way out of a completed sum. Rounding on the
// way in and then adding is how a total ends up disagreeing with the rows
// above it by a few seconds, which is the kind of discrepancy that costs an
// afternoon to explain and all of a client's confidence.
// -------------------------------------------------------------------
export function hoursFromSeconds(seconds: number): number {
  return Math.round((seconds / SECONDS_PER_HOUR) * 10000) / 10000;
}

// Treat blank and whitespace-only as absent. Jira hands back empty strings for
// fields that were never filled in, and "" must not read as a real value.
function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// -------------------------------------------------------------------
// Resolve each worklog against its issue and that issue's parent.
//
// The billing question is answered here, once: the item's own status if it
// declares one, otherwise the parent's, otherwise unset. Which of the three
// happened is recorded alongside the answer - an inherited status bills the
// same but changes silently when an item is re-parented, and the audit needs
// to be able to say so.
//
// A worklog whose issue is missing from the snapshot is kept, not dropped.
// The time was worked. It is marked as an orphan and blocks the period,
// because silently discarding hours is the one failure nobody would notice.
// -------------------------------------------------------------------
export function buildFacts(snapshot: TimesheetSnapshot): WorklogFactRow[] {
  const issuesByKey = new Map<string, SnapshotIssue>();
  for (const issue of snapshot.issues) {
    issuesByKey.set(issue.issueKey, issue);
  }

  const options = snapshot.options ?? {};
  const { periodStart, periodEnd } = options;

  const facts: WorklogFactRow[] = [];

  for (const worklog of snapshot.worklogs) {
    // Date-string comparison, not Date parsing. 'YYYY-MM-DD' sorts correctly
    // as text and cannot shift a day across a timezone.
    if (periodStart && worklog.workDate < periodStart) continue;
    if (periodEnd && worklog.workDate > periodEnd) continue;

    const issue = issuesByKey.get(worklog.issueKey);
    const parentKey = cleanText(issue?.parentKey);
    const parent = parentKey ? issuesByKey.get(parentKey) : undefined;

    const issueBillable = cleanText(issue?.billable);
    const parentBillable = cleanText(parent?.billable);

    let billable: string | null = null;
    let billableSource: WorklogFactRow["billableSource"] = "unset";

    if (issueBillable) {
      billable = issueBillable;
      billableSource = "issue";
    } else if (parentBillable) {
      billable = parentBillable;
      billableSource = "parent";
    }

    facts.push({
      worklogId: worklog.worklogId,
      issueKey: worklog.issueKey,
      issueSummary: cleanText(issue?.summary),
      parentKey,
      parentSummary: cleanText(parent?.summary),
      projectKey: cleanText(issue?.projectKey),
      // Category is a property of the work, so an item that does not set one
      // takes its parent's rather than reporting nothing.
      category: cleanText(issue?.category) ?? cleanText(parent?.category),
      personId: worklog.personId,
      personName: cleanText(worklog.personName),
      workDate: worklog.workDate,
      startSecond: typeof worklog.startSecond === "number" ? worklog.startSecond : null,
      timeSpentSeconds: worklog.timeSpentSeconds,
      billable,
      billableSource,
      hasNarrative: cleanText(worklog.narrative) !== null,
      isOrphan: issue === undefined,
    });
  }

  // Deterministic order: date, then person, then worklog id. Postgres makes no
  // promise about row order without an ORDER BY, and a report whose rows move
  // between runs is one nobody trusts to compare.
  return facts.sort((left, right) => {
    if (left.workDate !== right.workDate) return left.workDate < right.workDate ? -1 : 1;
    if (left.personId !== right.personId) return left.personId < right.personId ? -1 : 1;
    return left.worklogId.localeCompare(right.worklogId);
  });
}

// -------------------------------------------------------------------
// Billable / non-billable / unset, in seconds.
//
// Unset is its own bucket and stays that way. Folded into non-billable it
// would write hours off without anyone deciding to; folded into billable it
// would invoice for time nobody confirmed was chargeable.
// -------------------------------------------------------------------
export function summariseSplit(facts: WorklogFactRow[]): BillableSplit {
  let billableSeconds = 0;
  let nonBillableSeconds = 0;
  let unsetSeconds = 0;

  for (const fact of facts) {
    if (fact.billable === BILLABLE) billableSeconds += fact.timeSpentSeconds;
    else if (fact.billable === NON_BILLABLE) nonBillableSeconds += fact.timeSpentSeconds;
    else unsetSeconds += fact.timeSpentSeconds;
  }

  const total = billableSeconds + nonBillableSeconds + unsetSeconds;

  return {
    billableSeconds,
    nonBillableSeconds,
    unsetSeconds,
    billableHours: hoursFromSeconds(billableSeconds),
    nonBillableHours: hoursFromSeconds(nonBillableSeconds),
    unsetHours: hoursFromSeconds(unsetSeconds),
    // Null, not 0, when nothing was logged. "No time" is not "no billable
    // time", and a 0% chart on an empty week reads as a problem that is not
    // there.
    billableRatio: total > 0 ? Math.round((billableSeconds / total) * 10000) / 10000 : null,
  };
}

function sumSeconds(facts: WorklogFactRow[]): number {
  return facts.reduce((total, fact) => total + fact.timeSpentSeconds, 0);
}

function toDurationTotals(seconds: number): DurationTotals {
  return { seconds, hours: hoursFromSeconds(seconds) };
}

// Group by a derived key, preserving insertion order of first appearance.
function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

// -------------------------------------------------------------------
// Hours per person. Grouped on personId, never on the display name - two
// people can share a name, and one person can change theirs.
// -------------------------------------------------------------------
export function rollUpByPerson(facts: WorklogFactRow[]): PersonTotal[] {
  const groups = groupBy(facts, (fact) => fact.personId);

  const totals = [...groups.entries()].map(([personId, personFacts]) => {
    const distinctDays = new Set(personFacts.map((fact) => fact.workDate));
    return {
      personId,
      // The most recent name seen wins, since facts are date-ordered. A
      // renamed person shows under their current name without their earlier
      // entries detaching.
      personName: personFacts.reduce<string | null>((name, fact) => fact.personName ?? name, null),
      ...toDurationTotals(sumSeconds(personFacts)),
      worklogCount: personFacts.length,
      split: summariseSplit(personFacts),
      daysWorked: distinctDays.size,
    };
  });

  return totals.sort((left, right) => right.seconds - left.seconds || left.personId.localeCompare(right.personId));
}

// -------------------------------------------------------------------
// Person by day, with utilisation against a full working day.
//
// Only days with an entry appear. An absent day is not a zero: it may be
// leave, a weekend or a public holiday, and inventing rows for them would put
// a 0% utilisation bar under everyone's name every Sunday.
// -------------------------------------------------------------------
export function rollUpByPersonDay(facts: WorklogFactRow[], workingHoursPerDay: number): PersonDayTotal[] {
  const groups = groupBy(facts, (fact) => `${fact.personId} ${fact.workDate}`);

  const totals = [...groups.values()].map((dayFacts) => {
    const seconds = sumSeconds(dayFacts);
    const first = dayFacts[0];
    return {
      personId: first.personId,
      personName: dayFacts.reduce<string | null>((name, fact) => fact.personName ?? name, null),
      workDate: first.workDate,
      ...toDurationTotals(seconds),
      worklogCount: dayFacts.length,
      split: summariseSplit(dayFacts),
      utilisation:
        workingHoursPerDay > 0
          ? Math.round((seconds / SECONDS_PER_HOUR / workingHoursPerDay) * 10000) / 10000
          : null,
    };
  });

  return totals.sort(
    (left, right) =>
      (left.workDate < right.workDate ? -1 : left.workDate > right.workDate ? 1 : 0) ||
      left.personId.localeCompare(right.personId),
  );
}

// -------------------------------------------------------------------
// Hours to project, rolled up to the Project item above the deliverable -
// that being the level an invoice is written at. Work with no parent groups
// under a null key rather than being dropped.
// -------------------------------------------------------------------
export function rollUpByProject(facts: WorklogFactRow[]): ProjectTotal[] {
  const groups = groupBy(facts, (fact) => fact.parentKey ?? " none");

  const totals = [...groups.values()].map((projectFacts) => {
    const first = projectFacts[0];
    return {
      parentKey: first.parentKey,
      parentSummary: projectFacts.reduce<string | null>((summary, fact) => fact.parentSummary ?? summary, null),
      projectKey: first.projectKey,
      category: projectFacts.reduce<string | null>((category, fact) => fact.category ?? category, null),
      ...toDurationTotals(sumSeconds(projectFacts)),
      worklogCount: projectFacts.length,
      split: summariseSplit(projectFacts),
    };
  });

  return totals.sort(
    (left, right) => right.seconds - left.seconds || (left.parentKey ?? "").localeCompare(right.parentKey ?? ""),
  );
}

// -------------------------------------------------------------------
// Baseline vs current vs actual, per Project item.
//
// Baseline and current are Jira's estimates; actual is summed from the facts
// and never stored anywhere.
//
// A Project item with a budget and no time logged still gets a row. That is
// the case worth seeing - a large budget with nothing under it is either work
// that has not started or work being recorded somewhere else entirely, and a
// report that only lists items with hours would show neither.
// -------------------------------------------------------------------
export function rollUpBudget(facts: WorklogFactRow[], issues: SnapshotIssue[]): BudgetRow[] {
  const issuesByKey = new Map(issues.map((issue) => [issue.issueKey, issue]));

  const actualByParent = new Map<string, number>();
  const factsByParent = new Map<string, WorklogFactRow[]>();

  for (const fact of facts) {
    if (!fact.parentKey) continue;
    actualByParent.set(fact.parentKey, (actualByParent.get(fact.parentKey) ?? 0) + fact.timeSpentSeconds);
    const existing = factsByParent.get(fact.parentKey);
    if (existing) existing.push(fact);
    else factsByParent.set(fact.parentKey, [fact]);
  }

  // Every issue that is a parent of something, plus every issue carrying an
  // estimate. The second half is what surfaces a budgeted item with no
  // deliverables under it.
  const parentKeys = new Set<string>(actualByParent.keys());
  for (const issue of issues) {
    const parentKey = cleanText(issue.parentKey);
    if (parentKey) parentKeys.add(parentKey);
    if (issue.baselineEstimateSeconds != null || issue.currentEstimateSeconds != null) {
      parentKeys.add(issue.issueKey);
    }
  }

  // An issue that only ever appears as a parent, and is not in the snapshot
  // itself, has no estimate to report and no summary; it is still listed so
  // its actuals are visible.
  const rows = [...parentKeys].map((parentKey) => {
    const issue = issuesByKey.get(parentKey);
    const baselineSeconds = issue?.baselineEstimateSeconds ?? null;
    const currentSeconds = issue?.currentEstimateSeconds ?? null;
    const actualSeconds = actualByParent.get(parentKey) ?? 0;
    const parentFacts = factsByParent.get(parentKey) ?? [];

    const varianceSeconds = currentSeconds !== null ? actualSeconds - currentSeconds : null;

    return {
      parentKey,
      parentSummary: cleanText(issue?.summary),
      projectKey: cleanText(issue?.projectKey),
      // A job with no time booked still has a category, because the category
      // belongs to the Jira project rather than to any worklog.
      category: cleanText(issue?.category),
      billable: cleanText(issue?.billable),
      split: summariseSplit(parentFacts),
      worklogCount: parentFacts.length,
      baselineSeconds,
      currentSeconds,
      actualSeconds,
      baselineHours: baselineSeconds !== null ? hoursFromSeconds(baselineSeconds) : null,
      currentHours: currentSeconds !== null ? hoursFromSeconds(currentSeconds) : null,
      actualHours: hoursFromSeconds(actualSeconds),
      varianceSeconds,
      varianceHours: varianceSeconds !== null ? hoursFromSeconds(varianceSeconds) : null,
      consumedRatio:
        currentSeconds !== null && currentSeconds > 0
          ? Math.round((actualSeconds / currentSeconds) * 10000) / 10000
          : null,
    };
  });

  return rows.sort((left, right) => right.actualSeconds - left.actualSeconds || left.parentKey.localeCompare(right.parentKey));
}

// -------------------------------------------------------------------
// Findings first by severity, then by date, then by code, so the panel opens
// on whatever is stopping the invoice.
// -------------------------------------------------------------------
function sortFindings(findings: Finding[]): Finding[] {
  const severityRank = (finding: Finding) => (finding.severity === "blocking" ? 0 : 1);

  return [...findings].sort((left, right) => {
    const bySeverity = severityRank(left) - severityRank(right);
    if (bySeverity !== 0) return bySeverity;
    const leftDate = left.workDate ?? "";
    const rightDate = right.workDate ?? "";
    if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;
    return left.code.localeCompare(right.code);
  });
}

// -------------------------------------------------------------------
// The whole report, from one snapshot, in one pass.
//
// `isBillable` is false whenever anything blocking is present. It is a hard
// state on the dashboard rather than a note at the bottom: a period with an
// overlap or an unattributable entry does not get invoiced until it is fixed
// in Jira and re-synced.
// -------------------------------------------------------------------
export function buildReport(snapshot: TimesheetSnapshot): TimesheetReport {
  const options: TimesheetOptions = snapshot.options ?? {};
  const workingHoursPerDay = options.workingHoursPerDay ?? DEFAULT_WORKING_HOURS_PER_DAY;
  const maxDailyHours = options.maxDailyHours ?? DEFAULT_MAX_DAILY_HOURS;

  const facts = buildFacts(snapshot);
  const byPersonDay = rollUpByPersonDay(facts, workingHoursPerDay);
  const budget = rollUpBudget(facts, snapshot.issues);

  const findings = sortFindings(runAuditRules(facts, byPersonDay, budget, snapshot.today, { maxDailyHours }));

  const blockingCount = findings.filter((finding) => finding.severity === "blocking").length;

  return {
    facts,
    totals: { ...toDurationTotals(sumSeconds(facts)), worklogCount: facts.length },
    split: summariseSplit(facts),
    byPerson: rollUpByPerson(facts),
    byPersonDay,
    byProject: rollUpByProject(facts),
    budget,
    findings,
    isBillable: blockingCount === 0,
    blockingCount,
    warningCount: findings.length - blockingCount,
  };
}
