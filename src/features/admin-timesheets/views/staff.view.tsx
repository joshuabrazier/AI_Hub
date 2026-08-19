import { ROUTES } from "@/lib/routes";

import { getStaffDashboardService, TimesheetRequest } from "../admin-timesheets.service";
import { ProductivityChart } from "../productivity-chart";
import { StaffList } from "../staff-cards";
import { EmptyState, StatTile, SyncStatusLine } from "../timesheet-panels";
import TimesheetShell, { weekHref } from "../timesheet-shell";

// -------------------------------------------------------------------
// Staff: the team at a glance, then click into somebody.
//
// This is the overview. It answers "how is the team doing" with a few figures
// and the week's shape, then lists everyone so the comparison between them is
// visible on the page rather than hidden behind a dropdown.
//
// Every person is measured against THEIR contracted arrangement. Somebody on
// three days a week who works three full days shows 100%, not 60% - a number
// that is wrong in a predictable direction gets ignored, and then so does the
// dashboard around it.
// -------------------------------------------------------------------
export default async function StaffView(request: TimesheetRequest) {
  const { data, dashboard } = await getStaffDashboardService(request);
  const { period, filters, report, syncStatus, weekSeries, week, periodTotalHours } = data;

  const { totals } = dashboard;
  const hasAnyone = dashboard.people.length > 0;

  return (
    <TimesheetShell
      data={data}
      title="Staff"
      description={`How the team is tracking in ${period.label}, each against their own contracted days.`}
    >
      {!hasAnyone ? (
        <>
          <EmptyState syncStatus={syncStatus} periodLabel={period.label} filtered={periodTotalHours > 0} />
          <SyncStatusLine syncStatus={syncStatus} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="Team utilisation"
              hours={totals.utilisation === null ? 0 : Math.round(totals.utilisation * 100)}
              format="count"
              hint={`${totals.loggedHours.toFixed(2)}h of ${totals.capacityHours.toFixed(2)}h capacity`}
              index={0}
            />
            <StatTile
              label="Billable share"
              hours={totals.billableShare === null ? 0 : Math.round(totals.billableShare * 100)}
              format="count"
              ratio={totals.billableShare}
              hint={`${totals.billableHours.toFixed(2)}h billable`}
              index={1}
            />
            <StatTile
              label="Meeting target"
              hours={totals.meetingTarget}
              format="count"
              hint={
                totals.withTarget === 0
                  ? "No billable targets set yet"
                  : `of ${totals.withTarget} with a target set`
              }
              emphasis={totals.withTarget > 0 && totals.meetingTarget < totals.withTarget ? "alert" : "normal"}
              index={2}
            />
            <StatTile
              label="People"
              hours={totals.peopleCount}
              format="count"
              hint={`${dashboard.weekdaysInPeriod} weekdays in this period`}
              emphasis="muted"
              index={3}
            />
          </div>

          <ProductivityChart
            series={weekSeries}
            week={week}
            title="The team's week"
            previousHref={weekHref(ROUTES.ADMIN_TIMESHEETS_STAFF, filters, week.previousStart)}
            nextHref={weekHref(ROUTES.ADMIN_TIMESHEETS_STAFF, filters, week.nextStart)}
          />

          <div>
            <h2 className="mb-3 font-heading text-lg font-semibold text-foreground">Everyone</h2>
            <StaffList people={dashboard.people} filters={filters} />
          </div>

          {report.totals.worklogCount === 0 && (
            <EmptyState syncStatus={syncStatus} periodLabel={period.label} filtered={periodTotalHours > 0} />
          )}

          <SyncStatusLine syncStatus={syncStatus} />
        </>
      )}
    </TimesheetShell>
  );
}
