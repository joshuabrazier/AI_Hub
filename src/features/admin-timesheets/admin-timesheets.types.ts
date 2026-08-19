import { z } from "zod";
import { DailySeries } from "@/lib/timesheet/daily-series";
import { InvoiceReadiness, JobSlice, SplitSlice } from "@/lib/timesheet/overview-series";
import { TimesheetReport } from "@/lib/timesheet/timesheet.types";

// -------------------------------------------------------------------
// Admin timesheets - DTOs
//
// The report itself comes straight from the aggregation engine. Nothing here
// recomputes a figure: the whole point of that engine is that the dashboard,
// the export and the sync job all read the same numbers from the same code.
// -------------------------------------------------------------------

export interface TimesheetPeriodDTO {
  // 'YYYY-MM', the value carried in the URL.
  month: string;
  // "August 2026"
  label: string;
  // Inclusive bounds, 'YYYY-MM-DD'.
  from: string;
  to: string;
}

export interface MonthOptionDTO {
  value: string;
  label: string;
}

// -------------------------------------------------------------------
// The week the chart is showing. Monday-anchored, and in the URL, so a week
// can be linked to and stepped through without losing the rest of the filters.
// -------------------------------------------------------------------
export interface TimesheetWeekDTO {
  // 'YYYY-MM-DD', always a Monday.
  start: string;
  end: string;
  // "10-16 Aug 2026"
  label: string;
  // Monday of the previous / next week, for the arrows.
  previousStart: string;
  nextStart: string;
  // False when the next week is entirely in the future, so the arrow can be
  // disabled rather than walking off into empty weeks forever.
  hasNext: boolean;
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

export interface ProjectOptionDTO {
  // 'all', or the parent issue key.
  value: string;
  label: string;
  summary: string | null;
  category: string | null;
  hours: number;
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

export interface TimesheetFiltersDTO {
  month: string;
  category: string;
  project: string;
  person: string;
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
  monthOptions: MonthOptionDTO[];
  categoryOptions: CategoryOptionDTO[];
  projectOptions: ProjectOptionDTO[];
  personOptions: PersonOptionDTO[];
  // The report for the CURRENT filter selection.
  report: TimesheetReport;
  // Monday to Sunday, for the chart. Derived from the same report, so the bars
  // can never disagree with the tables beside them.
  weekSeries: DailySeries;
  week: TimesheetWeekDTO;
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
