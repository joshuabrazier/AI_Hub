import { getAdminTimesheetsService, TimesheetRequest } from "../admin-timesheets.service";
import { AuditCard, BillableStateBanner, StatTile, SyncStatusLine } from "../timesheet-panels";
import TimesheetShell from "../timesheet-shell";

// -------------------------------------------------------------------
// Review: what needs fixing in Jira before this period is invoiced.
//
// This is where the findings live, and the reason they live here is that they
// were previously stacked under the numbers on every screen. Data quality
// matters, but a warning panel that appears whether or not you came to deal
// with warnings stops being read - and the numbers it sits on top of are what
// people actually opened the page for.
//
// So the rest of the product carries a count on the Review tab, and the detail
// is one click away. Nothing is hidden; it is just no longer in the way.
// -------------------------------------------------------------------
export default async function ReviewView(request: TimesheetRequest) {
  const data = await getAdminTimesheetsService(request);
  const { period, report, syncStatus } = data;

  const missingNarrativeSeconds = report.facts.reduce(
    (total, fact) => total + (fact.hasNarrative ? 0 : fact.timeSpentSeconds),
    0,
  );

  return (
    <TimesheetShell
      data={data}
      title="Review"
      description={`What to fix in Jira before invoicing ${period.label}. Nothing here is edited in this app.`}
    >
      <BillableStateBanner report={report} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Blocking"
          hours={report.blockingCount}
          format="count"
          hint={report.blockingCount === 0 ? "Nothing stops invoicing" : "Must be fixed first"}
          emphasis={report.blockingCount > 0 ? "alert" : "muted"}
          index={0}
        />
        <StatTile
          label="Warnings"
          hours={report.warningCount}
          format="count"
          hint="Worth a look"
          emphasis="muted"
          index={1}
        />
        <StatTile
          label="Undescribed"
          hours={missingNarrativeSeconds / 3600}
          hint="Hours with no work description"
          emphasis={missingNarrativeSeconds > 0 ? "alert" : "muted"}
          index={2}
        />
        <StatTile
          label="Unset billable"
          hours={report.split.unsetHours}
          hint="Nobody has said whether it bills"
          emphasis={report.split.unsetSeconds > 0 ? "alert" : "muted"}
          index={3}
        />
      </div>

      <AuditCard findings={report.findings} index={4} />
      <SyncStatusLine syncStatus={syncStatus} />
    </TimesheetShell>
  );
}
