import { getAdminTimesheetsService, TimesheetRequest } from "../admin-timesheets.service";
import { JobsCard, ProjectsCard, StatTile, SyncStatusLine } from "../timesheet-panels";
import TimesheetShell from "../timesheet-shell";

// -------------------------------------------------------------------
// Jobs: the book of work.
//
// Every job appears, including the ones nobody has started. A job list that
// hides unstarted jobs is not a job list - and an unstarted job with a large
// budget is the most interesting row on the page, because it means the work is
// either not begun or being recorded somewhere other than Jira.
//
// The job filter is hidden here: this view IS the list of jobs, so filtering it
// down to one would leave a single row and no way to see the rest.
// -------------------------------------------------------------------
export default async function JobsView(request: TimesheetRequest) {
  const data = await getAdminTimesheetsService(request);
  const { period, report, syncStatus } = data;

  const jobs = report.budget;
  const started = jobs.filter((job) => job.worklogCount > 0).length;

  const budgeted = jobs.reduce((total, job) => total + (job.currentSeconds ?? job.baselineSeconds ?? 0), 0) / 3600;

  return (
    <TimesheetShell
      view="jobs"
      data={data}
      title="Jobs"
      description={`The book of work as it stands in ${period.label}.`}
      showProjectFilter={false}
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Jobs" hours={jobs.length} format="count" hint={`${started} with time booked`} index={0} />
        <StatTile label="Logged" hours={report.totals.hours} index={1} />
        <StatTile label="Budgeted" hours={budgeted} hint="From Jira estimates" emphasis="muted" index={2} />
        <StatTile
          label="Billable"
          hours={report.split.billableHours}
          ratio={report.split.billableRatio}
          index={3}
        />
      </div>

      <JobsCard jobs={jobs} index={4} />

      {/* Where the time actually landed, for the jobs that have any. */}
      {report.byProject.length > 0 && (
        <ProjectsCard projects={report.byProject} totalHours={report.totals.hours} index={5} />
      )}

      <SyncStatusLine syncStatus={syncStatus} />
    </TimesheetShell>
  );
}
