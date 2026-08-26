import { z } from "zod";
import { DailySeries } from "@/lib/timesheet/daily-series";
import { Granularity } from "@/lib/timesheet/period";
import { InvoiceReadiness, JobSlice, SplitSlice } from "@/lib/timesheet/overview-series";
import { TimesheetReport } from "@/lib/timesheet/timesheet.types";

// -------------------------------------------------------------------
// Admin timesheets - DTOs
//
// The report itself comes straight from the aggregation engine. Nothing here
// recomputes a figure: the whole point of that engine is that the dashboard,
// the export and the sync job all read the same numbers from the same code.
// -------------------------------------------------------------------

// The one period the whole screen describes: its bounds, how to say it, and
// where the arrows go.
export interface TimesheetPeriodDTO {
  granularity: Granularity;
  // The period's own start, 'YYYY-MM-DD'. This is what the URL carries.
  start: string;
  // "17-23 Aug 2026", "August 2026", "2026"
  label: string;
  // Inclusive bounds, 'YYYY-MM-DD'. `from` is the period's start OR the
  // history floor when that is later - see resolvePeriod. Query and measure
  // against these, never against `start`.
  from: string;
  to: string;
  previousStart: string;
  nextStart: string;
  hasNext: boolean;
  // False once stepping back would leave the recorded history entirely.
  hasPrevious: boolean;
  // True when `from` moved off `start`, so the label names a longer period
  // than the figures cover and the screen should say so.
  clipped: boolean;
  // True when this IS the period containing today, so a "this week" control can
  // disable itself rather than looking like a button that does nothing.
  isCurrent: boolean;
}

// -------------------------------------------------------------------
// Job category. Internal vs External is the Jira PROJECT CATEGORY, not a
// custom field, so the values are whatever the Jira admin named them. They are
// discovered from the period's data rather than hardcoded here: an
// installation that renames "External" to "Client" must keep working.
// -------------------------------------------------------------------
export const ALL_CATEGORIES = "all";

export interface CategoryOptionDTO {
  // 'all', or the category name exactly as Jira reports it.
  value: string;
  label: string;
  // Hours in this category, so the selector shows the shape of the period
  // before you click into it.
  hours: number;
  worklogCount: number;
}

// -------------------------------------------------------------------
// A CLIENT: who the work is for. Jira calls this a project and keys it
// "TSSS"; the business calls it Trainer Suzie Swim School. The name comes
// from Jira, so it is whatever the Jira admin typed - never hardcoded here.
// -------------------------------------------------------------------
export interface ClientOptionDTO {
  // 'all', or the Jira project key.
  value: string;
  // The client's name, falling back to the key when Jira has no name for it.
  label: string;
  category: string | null;
  hours: number;
  projectCount: number;
}

// -------------------------------------------------------------------
// A PROJECT: the item an invoice is written against. Jira calls this the
// parent issue and keys it "TSSS-59".
// -------------------------------------------------------------------
export interface ProjectOptionDTO {
  // 'all', or the project key.
  value: string;
  label: string;
  summary: string | null;
  category: string | null;
  hours: number;
  // Which client this belongs to, so choosing a client can narrow the list
  // rather than leaving every project of every client in one long dropdown.
  clientKey: string | null;
  clientName: string | null;
}

// -------------------------------------------------------------------
// What the user has narrowed to. Every one of these lives in the URL, so a
// filtered view can be linked to and sent to someone - which is exactly what
// happens when a client queries one line of an invoice.
// -------------------------------------------------------------------
export interface PersonOptionDTO {
  // 'all', or the Atlassian accountId. Never the display name.
  value: string;
  label: string;
  hours: number;
  daysWorked: number;
}

// The billable states a screen can narrow to. 'unset' is its own option and
// not folded into non-billable: "nobody has said whether this bills" is a
// data-quality problem, and hiding it inside "non-billable" writes hours off
// in silence - the same reasoning the engine's three-way split uses.
export const BILLABLE_FILTERS = ["all", "Billable", "Non-billable", "unset"] as const;

export type BillableFilter = (typeof BILLABLE_FILTERS)[number];

export interface TimesheetFiltersDTO {
  granularity: Granularity;
  // The period's start, carried in the URL.
  start: string;
  category: string;
  // Who the work is for. 'all', or a Jira project key.
  client: string;
  // What it is booked against. 'all', or a project key. Narrowed by client
  // when one is chosen, and reset to 'all' if it does not belong to them.
  project: string;
  // THE AUTHORITATIVE person filter, and an array because "Louis and Josh"
  // is a normal thing to ask for. Empty means everyone.
  people: string[];
  // The single-person view of the above, kept because the person page and the
  // staff cards are about one person by definition. Exactly one selected
  // gives that id; none or several gives 'all'. Derived in one place so the
  // two can never disagree.
  person: string;
  billable: BillableFilter;
}

// -------------------------------------------------------------------
// Where the read model stands. Shown so an empty dashboard can say WHY it is
// empty: never synced, synced and genuinely quiet, or synced but failing.
// A blank page with no explanation is the thing people file a bug about.
// -------------------------------------------------------------------
export interface SyncStatusDTO {
  configured: boolean;
  lastSuccessAt: Date | null;
  lastRunAt: Date | null;
  lastError: string | null;
  lastUpdatedCount: number;
  totalWorklogs: number;
}

export interface AdminTimesheetsDTO {
  period: TimesheetPeriodDTO;
  filters: TimesheetFiltersDTO;
  categoryOptions: CategoryOptionDTO[];
  clientOptions: ClientOptionDTO[];
  projectOptions: ProjectOptionDTO[];
  personOptions: PersonOptionDTO[];
  // The report for the CURRENT filter selection.
  report: TimesheetReport;
  // The chart's series for the SAME period as the tables, derived from the
  // same report, so the two can never disagree.
  periodSeries: DailySeries;
  // Today in the app zone. The period control anchors "this week" to it, and it
  // never comes from the browser clock - a viewer in another timezone must not
  // see a different "today" from the server that produced these figures.
  todayIso: string;
  // Totals for the whole period, ignoring category and project. Kept so the
  // filtered view can say "18.75 of 62.00 h" rather than presenting a filtered
  // subtotal as if it were the period.
  periodTotalHours: number;
  syncStatus: SyncStatusDTO;
  // A full working day, for the utilisation column's denominator.
  workingHoursPerDay: number;
}

// -------------------------------------------------------------------
// Staff targets
//
// The form works in the units a person thinks in - days per week, hours per
// day, a billable percentage - and the storage layer converts to the tenths
// and minutes it keeps. Nobody should have to think in tenths.
// -------------------------------------------------------------------
export const StaffTargetSchema = z.object({
  personId: z.string().min(1, "A person is required"),
  personName: z.string().optional(),
  // WHICH days, as ISO weekday numbers. Optional: leaving it empty keeps the
  // old behaviour of prorating the count across every weekday, which is the
  // right default because nothing knows somebody's days until they are set.
  //
  // Duplicates are rejected HERE, because a CHECK constraint cannot express it
  // without a subquery - see migration 009. A repeated Tuesday would double
  // that day's capacity.
  workingWeekdays: z
    .array(z.coerce.number().int().min(1).max(7))
    .max(7)
    .optional()
    .transform((days) => (days && days.length > 0 ? [...new Set(days)].sort((a, b) => a - b) : null))
    .refine((days) => days === null || days.length > 0, "Choose at least one day, or none at all"),
  // 0 to 7, half days allowed. Someone on leave for a period is legitimately 0.
  workingDaysPerWeek: z.coerce
    .number()
    .min(0, "Days cannot be negative")
    .max(7, "A week has seven days")
    .refine((value) => Number.isInteger(value * 2), "Use whole or half days"),
  hoursPerDay: z.coerce.number().gt(0, "A working day must be longer than zero").max(24, "A day has 24 hours"),
  // Empty means "no target", which is different from a target of zero.
  billableTargetPercent: z
    .union([z.literal(""), z.coerce.number().min(0).max(100)])
    .transform((value) => (value === "" ? null : Number(value)))
    .nullable(),
});

export type StaffTargetRequestDTO = z.infer<typeof StaffTargetSchema>;

export interface StaffTargetDTO {
  // ISO weekday numbers the person works, 1 = Monday. Null when only a count
  // is recorded - see migration 009.
  workingWeekdays: number[] | null;
  personId: string;
  personName: string | null;
  workingDaysPerWeek: number;
  hoursPerDay: number;
  weeklyHours: number;
  billableTargetPercent: number | null;
  // True when no row exists and the company default is standing in, so an
  // assumed target is never shown as an agreed one.
  isDefault: boolean;
}

// -------------------------------------------------------------------
// One person on the team dashboard: what they logged, what was expected of
// them, and how the two compare. Sorted and rendered as a list you click into.
// -------------------------------------------------------------------
export interface StaffSummaryDTO {
  personId: string;
  personName: string;
  loggedHours: number;
  capacityHours: number;
  // logged / their capacity. Null when they have no capacity to measure.
  utilisation: number | null;
  billableHours: number;
  nonBillableHours: number;
  billableShare: number | null;
  billableTargetPercent: number | null;
  // Percentage points above or below target. Positive is ahead.
  billableVariance: number | null;
  meetsBillableTarget: boolean | null;
  daysWorked: number;
  worklogCount: number;
  target: StaffTargetDTO;
}

// -------------------------------------------------------------------
// The team dashboard.
// -------------------------------------------------------------------
export interface StaffDashboardDTO {
  people: StaffSummaryDTO[];
  totals: {
    loggedHours: number;
    capacityHours: number;
    billableHours: number;
    nonBillableHours: number;
    unsetHours: number;
    utilisation: number | null;
    billableShare: number | null;
    peopleCount: number;
    // How many have a billable target set and are meeting it.
    meetingTarget: number;
    withTarget: number;
  };
  // Weekdays in the selected period, the denominator every capacity is
  // prorated from.
  weekdaysInPeriod: number;
}

// -------------------------------------------------------------------
// The company overview.
// -------------------------------------------------------------------
export interface OverviewDTO {
  categories: SplitSlice[];
  topJobs: JobSlice[];
  readiness: InvoiceReadiness;
  // Team capacity for the period, so utilisation is against contracted days
  // rather than a headcount times five.
  capacityHours: number;
  utilisation: number | null;
  peopleCount: number;
  weekdaysInPeriod: number;
  // How many weeks the trend covers.
}
