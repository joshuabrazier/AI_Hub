// -------------------------------------------------------------------
// Timesheet aggregation - types
//
// The engine is pure: a snapshot object goes in, a report comes out. It has no
// dependencies, no imports from the app, and no I/O, which is what lets the
// same code run in the sync job, behind the API, and in tests without any of
// them disagreeing about a number.
//
// Two consequences worth stating, because both are easy to undo by accident:
//
//   - Durations are whole SECONDS everywhere inside the engine. Hours are
//     derived at the edge for display. Summing integers is exact; summing
//     floats is not, and "the dashboard says 18.75 but the export says
//     18.749999" is a bug you only ever find in front of a client.
//
//   - The engine never calls `new Date()`. Today's date is injected as
//     `today`, resolved by the caller with todayInAppZone(). A pure function
//     that reads the clock is neither pure nor testable, and a server running
//     in UTC would decide "today" wrongly for a third of every Adelaide day.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Input: one Jira worklog, already normalised to the read model's shape.
// -------------------------------------------------------------------
export interface SnapshotWorklog {
  worklogId: string;
  issueKey: string;
  // Atlassian accountId. The identity. Never a display name.
  personId: string;
  // Label only, for output. Never grouped on.
  personName?: string | null;
  // Adelaide-local calendar date, 'YYYY-MM-DD'.
  workDate: string;
  // Seconds past Adelaide-local midnight, or null when Jira recorded no start
  // time. Null means the overlap rule skips this worklog rather than treating
  // it as starting at midnight.
  startSecond?: number | null;
  timeSpentSeconds: number;
  // The work description as it stands in Jira. Absent or blank is the finding
  // that job 7.1 exists to fix.
  narrative?: string | null;
  // 'core' | 'supporting' | null, frozen onto the worklog at sync time.
  rndClass?: string | null;
}

// -------------------------------------------------------------------
// Input: the issue a worklog was booked to, or the Project item above it.
// -------------------------------------------------------------------
export interface SnapshotIssue {
  issueKey: string;
  parentKey?: string | null;
  projectKey: string;
  issueType?: string | null;
  summary: string;
  category?: string | null;
  // What this issue declares. Usually null on the deliverable, set on the
  // parent - which is exactly why billableSource is tracked downstream.
  billable?: string | null;
  baselineEstimateSeconds?: number | null;
  currentEstimateSeconds?: number | null;
}

// -------------------------------------------------------------------
// Input: everything the engine needs, and nothing it could fetch itself.
// -------------------------------------------------------------------
export interface TimesheetSnapshot {
  worklogs: SnapshotWorklog[];
  issues: SnapshotIssue[];
  // 'YYYY-MM-DD' in the app zone, from todayInAppZone(). Used to decide what
  // counts as a future-dated entry.
  today: string;
  options?: TimesheetOptions;
}

export interface TimesheetOptions {
  // A full working day, for utilisation. 7.5h by default.
  workingHoursPerDay?: number;
  // Above this in one day, a person has almost certainly mis-entered
  // something. A warning, never a blocker - long days happen.
  maxDailyHours?: number;
  // Optional inclusive reporting window, 'YYYY-MM-DD'. Worklogs outside it are
  // dropped before anything is counted.
  periodStart?: string;
  periodEnd?: string;
}

// -------------------------------------------------------------------
// A resolved worklog: the input joined to its issue and its parent, with the
// billing question already answered and its provenance recorded.
// -------------------------------------------------------------------
// The two R&D Tax Incentive categories. `null` is work that carried neither
// label at the moment it was synced, which is a decision, not a gap.
export type RndClass = "core" | "supporting";

export interface WorklogFactRow {
  worklogId: string;
  issueKey: string;
  issueSummary: string | null;
  parentKey: string | null;
  parentSummary: string | null;
  projectKey: string | null;
  category: string | null;
  personId: string;
  personName: string | null;
  workDate: string;
  startSecond: number | null;
  timeSpentSeconds: number;
  billable: string | null;
  billableSource: FactBillableSource;
  hasNarrative: boolean;
  // As FROZEN at sync time, carried on the worklog. Never derived here from
  // the issue's current labels: those are mutable, and deriving would let a
  // label edit reclassify history. It is also the grain rule - joining an
  // issue-level value in would count an issue's hours once per worklog.
  rndClass: RndClass | null;
  // True when the worklog names an issue that is not in the snapshot. Such a
  // row is still counted - the time was worked - but it cannot be attributed,
  // and it raises a finding.
  isOrphan: boolean;
}

export type FactBillableSource = "issue" | "parent" | "unset";

// -------------------------------------------------------------------
// Findings
//
// Severity decides money. A `blocking` finding means the period cannot be
// invoiced as it stands; a `warning` means someone should look, but the
// numbers are still usable. Nothing here ever silently corrects data - the
// engine reports, a human fixes it in Jira, and the next sync clears it.
// -------------------------------------------------------------------
export const FINDING_CODES = {
  WORKLOG_OVERLAP: "WORKLOG_OVERLAP",
  BILLABLE_UNSET: "BILLABLE_UNSET",
  BILLABLE_INHERITED: "BILLABLE_INHERITED",
  MISSING_NARRATIVE: "MISSING_NARRATIVE",
  ORPHAN_WORKLOG: "ORPHAN_WORKLOG",
  NO_PARENT_ITEM: "NO_PARENT_ITEM",
  NON_POSITIVE_DURATION: "NON_POSITIVE_DURATION",
  FUTURE_DATED: "FUTURE_DATED",
  EXCESSIVE_DAY: "EXCESSIVE_DAY",
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
} as const;

export type FindingCode = (typeof FINDING_CODES)[keyof typeof FINDING_CODES];

export type FindingSeverity = "blocking" | "warning";

// -------------------------------------------------------------------
// A finding always carries its code and its structured subject, not just a
// sentence. Claude job 7.3 turns these into readable explanations, and the
// codes must survive that: the explanation is a convenience, the finding is
// the record.
// -------------------------------------------------------------------
export interface Finding {
  code: FindingCode;
  severity: FindingSeverity;
  // A plain-language statement of the fact, with no advice in it.
  message: string;
  personId?: string;
  personName?: string | null;
  workDate?: string;
  issueKey?: string;
  worklogIds?: string[];
  // Rule-specific numbers, so a UI or a model can restate the finding without
  // parsing the message.
  detail?: Record<string, number | string | null>;
}

// -------------------------------------------------------------------
// Roll-ups
// -------------------------------------------------------------------
export interface DurationTotals {
  seconds: number;
  hours: number;
}

export interface BillableSplit {
  billableSeconds: number;
  nonBillableSeconds: number;
  // Neither the issue nor its parent said. Deliberately its own bucket: folded
  // into non-billable it would write hours off in silence.
  unsetSeconds: number;
  billableHours: number;
  nonBillableHours: number;
  unsetHours: number;
  // Billable as a share of the total, 0-1, or null when there is no time at
  // all. Null rather than 0 because "nothing logged" is not "nothing
  // billable".
  billableRatio: number | null;
}

export interface PersonTotal extends DurationTotals {
  personId: string;
  personName: string | null;
  worklogCount: number;
  split: BillableSplit;
  daysWorked: number;
}

export interface PersonDayTotal extends DurationTotals {
  personId: string;
  personName: string | null;
  workDate: string;
  worklogCount: number;
  split: BillableSplit;
  // Hours against a full working day. 1 is a full day. Null when
  // workingHoursPerDay is not positive.
  utilisation: number | null;
}

export interface ProjectTotal extends DurationTotals {
  // The PROJECT the work rolls up to - Jira calls this the worklog's parent
  // issue - or null for work booked with no parent above it.
  projectKey: string | null;
  projectSummary: string | null;
  // The CLIENT the project belongs to. Jira calls this the project key; it is
  // the space, and it is who the work is for.
  clientKey: string | null;
  category: string | null;
  worklogCount: number;
  split: BillableSplit;
}

// -------------------------------------------------------------------
// One project, with its budget and what has been booked to it.
//
// EVERY project appears, including the ones with no hours against them. A
// project with nothing booked is not an empty row to hide; it is one nobody
// has started, or one whose time is being recorded somewhere else entirely.
// Both are worth seeing, and both vanish if the table only lists projects
// with hours.
//
// Baseline and current come from Jira's estimates. Actual is summed from the
// facts and never stored.
// -------------------------------------------------------------------
export interface BudgetRow {
  projectKey: string;
  projectSummary: string | null;
  clientKey: string | null;
  category: string | null;
  // What the project itself declares, which is what its deliverables inherit.
  billable: string | null;
  baselineSeconds: number | null;
  currentSeconds: number | null;
  actualSeconds: number;
  baselineHours: number | null;
  currentHours: number | null;
  actualHours: number;
  // actual - current, positive means over. Null when there is no current
  // estimate to be over.
  varianceSeconds: number | null;
  varianceHours: number | null;
  // Actual as a share of current estimate, or null when there is no estimate.
  consumedRatio: number | null;
  // How the booked time splits. All zeroes for a project with nothing on it.
  split: BillableSplit;
  worklogCount: number;
}

// -------------------------------------------------------------------
// The report. Everything a dashboard, an export or an invoice needs, computed
// from one snapshot in one pass.
// -------------------------------------------------------------------
export interface TimesheetReport {
  facts: WorklogFactRow[];
  totals: DurationTotals & { worklogCount: number };
  split: BillableSplit;
  byPerson: PersonTotal[];
  byPersonDay: PersonDayTotal[];
  byProject: ProjectTotal[];
  budget: BudgetRow[];
  findings: Finding[];
  // False when any finding is blocking. The dashboard shows this as a hard
  // state, not a footnote: a period with a blocker does not get invoiced.
  isBillable: boolean;
  blockingCount: number;
  warningCount: number;
}
