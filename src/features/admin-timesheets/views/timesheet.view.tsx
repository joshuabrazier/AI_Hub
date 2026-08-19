import { ROUTES } from "@/lib/routes";

import { getStaffDashboardService, TimesheetRequest } from "../admin-timesheets.service";
import { ProductivityChart } from "../productivity-chart";
import { EmptyState, StatTile, SyncStatusLine } from "../timesheet-panels";
import TimesheetShell, { periodHref } from "../timesheet-shell";
import { EntriesDataTable } from "../table/timesheet-data-tables";

// -------------------------------------------------------------------
// Timesheet: the entries themselves.
//
// The question: what was worked, by whom, on what, and can it be billed. One
// row per worklog, which is the grain every other figure in the product is
// summed from - so this is the view somebody checks a total against when they
// do not believe it.
//
// The findings are not here. Missing descriptions and unset billable status
// show as marks ON the row they belong to, where they are actionable, rather
// than as a separate wall of warnings above the data.
// -------------------------------------------------------------------
export default async function TimesheetView(request: TimesheetRequest) {
  // Through the dashboard service, so the chart s capacity track scales with
  // however many people are in view rather than sitting at one person s day.
  const { data } = await getStaffDashboardService(request);
  const { period, filters, report, syncStatus, periodTotalHours, periodSeries } = data;

  const hasEntries = report.totals.worklogCount > 0;

  return (
    <TimesheetShell
      data={data}
      pathname={ROUTES.ADMIN_TIMESHEETS_ENTRIES}
      title="Entries"
      description={`Time entries for ${period.label}, read from Jira.`}
    >
      {hasEntries ? (
        <>
          {/* The chart leads: the shape of the period is the thing you want
              before any individual figure. */}
          <ProductivityChart
            series={periodSeries}
            period={period}
            title="Hours this week"
            previousHref={periodHref(ROUTES.ADMIN_TIMESHEETS_ENTRIES, filters, period.previousStart)}
            nextHref={periodHref(ROUTES.ADMIN_TIMESHEETS_ENTRIES, filters, period.nextStart)}
          />

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="Logged"
              hours={report.totals.hours}
              hint={`${report.totals.worklogCount} ${report.totals.worklogCount === 1 ? "entry" : "entries"}`}
              index={0}
            />
            <StatTile
              label="Billable"
              hours={report.split.billableHours}
              ratio={report.split.billableRatio}
              index={1}
            />
            <StatTile label="Non-billable" hours={report.split.nonBillableHours} emphasis="muted" index={2} />
            <StatTile
              label="No description"
              hours={
                report.facts.reduce((total, fact) => total + (fact.hasNarrative ? 0 : fact.timeSpentSeconds), 0) / 3600
              }
              hint="Cannot be itemised on an invoice"
              emphasis={report.facts.some((fact) => !fact.hasNarrative) ? "alert" : "muted"}
              index={3}
            />
          </div>

          <EntriesDataTable facts={report.facts} />
          <SyncStatusLine syncStatus={syncStatus} />
        </>
      ) : (
        <>
          <EmptyState syncStatus={syncStatus} periodLabel={period.label} filtered={periodTotalHours > 0} />
          <SyncStatusLine syncStatus={syncStatus} />
        </>
      )}
    </TimesheetShell>
  );
}
