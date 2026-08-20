import { ROUTES } from "@/lib/routes";

import { getStaffSummaryService } from "../admin-timesheets-ai.service";
import { AiSummaryPanel } from "../ai-summary-panel";
import { getStaffDashboardService, TimesheetRequest } from "../admin-timesheets.service";
import { StaffList } from "../staff-cards";
import { EmptyState, StatTile, SyncStatusLine } from "../timesheet-panels";
import TimesheetShell from "../timesheet-shell";

// -------------------------------------------------------------------
// Staff: the team as a list, then click into somebody.
//
// Four figures and the list, and nothing else. The week chart used to sit here
// too, but a chart of everybody's days combined answered a question this
// screen is not asking - the comparison BETWEEN people is the point, and each
// person's own week is one click away where it means something.
//
// Every person is measured against THEIR contracted arrangement. Somebody on
// three days a week who works three full days shows 100%, not 60% - a number
// that is wrong in a predictable direction gets ignored, and then so does the
// dashboard around it.
// -------------------------------------------------------------------
export default async function StaffView(request: TimesheetRequest) {
  const { data, dashboard } = await getStaffDashboardService(request);
  const { period, filters, report, syncStatus, periodTotalHours } = data;

  const { totals } = dashboard;

  // Read-only, and built from the data already fetched above rather than
  // re-querying it. Rendering never calls the model - see the service.
  const summary = await getStaffSummaryService(data, dashboard);
  const hasAnyone = dashboard.people.length > 0;

  return (
    <TimesheetShell
      data={data}
      pathname={ROUTES.ADMIN_TIMESHEETS_STAFF}
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
              format="percent"
              hint={`${totals.loggedHours.toFixed(2)}h of ${totals.capacityHours.toFixed(2)}h capacity`}
              index={0}
            />
            <StatTile
              label="Billable share"
              hours={totals.billableShare === null ? 0 : Math.round(totals.billableShare * 100)}
              format="percent"
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

          <StaffList people={dashboard.people} filters={filters} />

          <AiSummaryPanel summary={summary} filters={filters} periodLabel={period.label} index={4} />

          {report.totals.worklogCount === 0 && (
            <EmptyState syncStatus={syncStatus} periodLabel={period.label} filtered={periodTotalHours > 0} />
          )}

          <SyncStatusLine syncStatus={syncStatus} />
        </>
      )}
    </TimesheetShell>
  );
}
