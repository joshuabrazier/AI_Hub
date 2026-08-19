import { ROUTES } from "@/lib/routes";

import { getOverviewService, TimesheetRequest } from "../admin-timesheets.service";
import { CategorySplitCard, OverviewLegend, ReadinessCard, TopJobsCard } from "../overview-panels";
import { ProductivityChart } from "../productivity-chart";
import { EmptyState, StatTile, SyncStatusLine } from "../timesheet-panels";
import TimesheetShell, { weekHref } from "../timesheet-shell";

// -------------------------------------------------------------------
// Overview: the company at a glance.
//
// This screen answers the four questions the raw entry list cannot:
//
//   1. Is the trend holding, and is the billable part of it holding with it?
//   2. Where is the time going - client work or our own overheads?
//   3. Which jobs are consuming it?
//   4. How much of it could actually go on an invoice today?
//
// There is deliberately no entry table here. Entries are the grain everything
// is summed from, not a summary, and putting eight hundred rows under a
// dashboard is what made the old screen unreadable. They live on their own
// page, and on each person and job.
// -------------------------------------------------------------------
export default async function OverviewView(request: TimesheetRequest) {
  const { data, overview } = await getOverviewService(request);
  const { period, filters, report, syncStatus, periodTotalHours, weekSeries, week } = data;

  const hasData = report.totals.worklogCount > 0;

  return (
    <TimesheetShell
      data={data}
      title="Overview"
      description={`How the business is tracking in ${period.label}.`}
    >
      {!hasData ? (
        <>
          <EmptyState syncStatus={syncStatus} periodLabel={period.label} filtered={periodTotalHours > 0} />
          <SyncStatusLine syncStatus={syncStatus} />
        </>
      ) : (
        <>
          {/* The four headline figures. Utilisation is against contracted
              capacity, so a part-time team is not reported as underperforming. */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="Logged"
              hours={report.totals.hours}
              hint={`${report.totals.worklogCount} entries across ${overview.peopleCount} people`}
              index={0}
            />
            <StatTile
              label="Utilisation"
              hours={overview.utilisation === null ? 0 : Math.round(overview.utilisation * 100)}
              format="count"
              ratio={overview.utilisation}
              hint={`of ${overview.capacityHours.toFixed(2)}h contracted`}
              index={1}
            />
            <StatTile
              label="Billable"
              hours={report.split.billableHours}
              ratio={report.split.billableRatio}
              hint={
                report.split.billableRatio === null
                  ? undefined
                  : `${Math.round(report.split.billableRatio * 100)}% of logged time`
              }
              index={2}
            />
            <StatTile
              label="Ready to invoice"
              hours={overview.readiness.readyHours}
              hint={
                overview.readiness.undescribedBillableHours > 0
                  ? `${overview.readiness.undescribedBillableHours.toFixed(2)}h has no description`
                  : "All billable time is described"
              }
              emphasis={overview.readiness.undescribedBillableHours > 0 ? "alert" : "normal"}
              index={3}
            />
          </div>

          {/* The week, day by day. The company shape at the grain people
              actually think in - a quarter of weekly bars answered a question
              nobody was asking on this screen. */}
          <ProductivityChart
            series={weekSeries}
            week={week}
            title="The company week"
            previousHref={weekHref(ROUTES.ADMIN_TIMESHEETS, filters, week.previousStart)}
            nextHref={weekHref(ROUTES.ADMIN_TIMESHEETS, filters, week.nextStart)}
          />

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <TopJobsCard jobs={overview.topJobs} index={5} />
            </div>
            <div className="space-y-6">
              <CategorySplitCard categories={overview.categories} index={6} />
              <ReadinessCard readiness={overview.readiness} index={7} />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <OverviewLegend />
            <SyncStatusLine syncStatus={syncStatus} />
          </div>
        </>
      )}
    </TimesheetShell>
  );
}
