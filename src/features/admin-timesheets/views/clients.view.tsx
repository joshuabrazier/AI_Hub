import { ROUTES } from "@/lib/routes";

import { getAdminTimesheetsService, TimesheetRequest } from "../admin-timesheets.service";
import { ClientsCard } from "../clients-card";
import { StatTile, SyncStatusLine } from "../timesheet-panels";
import TimesheetShell from "../timesheet-shell";

// -------------------------------------------------------------------
// Clients: the book of work, at the two levels the business has.
//
// A CLIENT is who the work is for - Jira calls it a project and keys it
// "TSSS". A PROJECT is what an invoice is written against - Jira calls it the
// parent issue and keys it "TSSS-59". The screen this replaced showed only the
// second level and called it a job, which is why a card could end up headed
// "Hours per client" while listing project items.
//
// Every client and every project appears, including the ones nobody has
// started. An unstarted project with a budget is the most interesting row on
// the page: it means the work is either not begun or being recorded somewhere
// other than Jira. Both vanish if the list only shows what has hours.
//
// The client filter is hidden here: this view IS the client list, so narrowing
// it to one would leave a single row and no way to see the rest. The project
// filter goes for the same reason.
// -------------------------------------------------------------------
export default async function ClientsView(request: TimesheetRequest) {
  const data = await getAdminTimesheetsService(request);
  const { period, report, syncStatus, clientOptions } = data;

  const projects = report.budget;
  const started = projects.filter((project) => project.worklogCount > 0).length;
  const clientCount = clientOptions.filter((option) => option.value !== "all").length;

  const budgeted =
    projects.reduce((total, project) => total + (project.currentSeconds ?? project.baselineSeconds ?? 0), 0) / 3600;

  return (
    <TimesheetShell
      data={data}
      pathname={ROUTES.ADMIN_TIMESHEETS_CLIENTS}
      title="Clients"
      description={`Who the work is for, and what is booked against them in ${period.label}.`}
      showClientFilter={false}
      showProjectFilter={false}
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Clients" hours={clientCount} format="count" index={0} />
        <StatTile
          label="Projects"
          hours={projects.length}
          format="count"
          hint={`${started} with time booked`}
          index={1}
        />
        <StatTile label="Logged" hours={report.totals.hours} index={2} />
        <StatTile label="Budgeted" hours={budgeted} hint="From Jira estimates" emphasis="muted" index={3} />
      </div>

      <ClientsCard clients={clientOptions} projects={projects} index={4} />

      <SyncStatusLine syncStatus={syncStatus} />
    </TimesheetShell>
  );
}
