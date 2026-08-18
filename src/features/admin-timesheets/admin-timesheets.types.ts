import { DailySeries } from "@/lib/timesheet/daily-series";
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
