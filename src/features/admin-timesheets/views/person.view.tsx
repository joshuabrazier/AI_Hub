import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/lib/routes";

import { getStaffDashboardService, TimesheetRequest } from "../admin-timesheets.service";
import { ProductivityChart } from "../productivity-chart";
import { StaffTargetDialog } from "../staff-target-dialog";
import { ProjectsCard, StatTile, SyncStatusLine } from "../timesheet-panels";
import TimesheetShell, { filterQuery, weekHref } from "../timesheet-shell";
import { EntriesTable, PersonDaysTable } from "../timesheet-tables";

// -------------------------------------------------------------------
// One person.
//
// Reached by clicking a name on the Staff list, not by choosing an account id
// from a dropdown. Their week, their days, the jobs they touched and every
// entry they logged - with the figures measured against their own contracted
// arrangement rather than a company-wide assumption.
//
// The person id comes from the URL. It is an identifier for a row, not a grant
// of access: the admin check in the service already decided that, and this
// screen is unreachable without it.
// -------------------------------------------------------------------
export default async function PersonView({ personId, ...request }: TimesheetRequest & { personId: string }) {
  // The person filter is forced to the id in the path, so every figure and
  // every table on this screen describes them and nobody else.
  const { data, dashboard } = await getStaffDashboardService({ ...request, person: personId });
  const { period, filters, report, syncStatus, workingHoursPerDay, weekSeries, week } = data;

  const person = dashboard.people.find((candidate) => candidate.personId === personId);

  // Somebody who has never logged time and has no target does not exist as far
  // as this screen is concerned. notFound rather than an error page: a guessed
  // id should not confirm whether an account exists.
  if (!person) notFound();

  const backHref = `${ROUTES.ADMIN_TIMESHEETS_STAFF}?${filterQuery({ ...filters, person: "all" })}`;

  return (
    <TimesheetShell
      data={data}
      title={person.personName}
      description={
        `${person.target.workingDaysPerWeek} ${person.target.workingDaysPerWeek === 1 ? "day" : "days"} a week at ` +
        `${person.target.hoursPerDay}h, ${person.target.weeklyHours.toFixed(2)}h a week` +
        (person.target.isDefault ? " (company default - no target set yet)" : "") +
        `. Showing ${period.label}.`
      }
      backLink={{ href: backHref, label: "Back to everyone" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StaffTargetDialog
          personId={person.personId}
          personName={person.personName}
          target={person.target}
          triggerLabel="Edit target"
        />

        {person.target.isDefault && <Badge variant="warning">Using the company default</Badge>}
        {person.meetsBillableTarget === true && <Badge variant="success">Meeting billable target</Badge>}
        {person.meetsBillableTarget === false && <Badge variant="destructive">Below billable target</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Utilisation"
          hours={person.utilisation === null ? 0 : Math.round(person.utilisation * 100)}
          format="count"
          ratio={person.utilisation}
          hint={`${person.loggedHours.toFixed(2)}h of ${person.capacityHours.toFixed(2)}h`}
          index={0}
        />
        <StatTile
          label="Billable share"
          hours={person.billableShare === null ? 0 : Math.round(person.billableShare * 100)}
          format="count"
          ratio={person.billableShare}
          hint={
            person.billableTargetPercent === null
              ? "No target set"
              : `Target ${person.billableTargetPercent}%` +
                (person.billableVariance === null
                  ? ""
                  : ` (${person.billableVariance >= 0 ? "+" : ""}${person.billableVariance.toFixed(0)} pts)`)
          }
          emphasis={person.meetsBillableTarget === false ? "alert" : "normal"}
          index={1}
        />
        <StatTile label="Logged" hours={person.loggedHours} hint={`${person.daysWorked} days worked`} index={2} />
        <StatTile label="Non-billable" hours={person.nonBillableHours} emphasis="muted" index={3} />
      </div>

      <ProductivityChart
        series={weekSeries}
        week={week}
        title={`${person.personName}, week of ${week.label}`}
        previousHref={weekHref(`${ROUTES.ADMIN_TIMESHEETS_STAFF}/${encodeURIComponent(personId)}`, filters, week.previousStart)}
        nextHref={weekHref(`${ROUTES.ADMIN_TIMESHEETS_STAFF}/${encodeURIComponent(personId)}`, filters, week.nextStart)}
      />

      <PersonDaysTable days={report.byPersonDay} workingHoursPerDay={workingHoursPerDay} />

      {report.byProject.length > 0 && (
        <ProjectsCard projects={report.byProject} totalHours={report.totals.hours} index={2} />
      )}

      {report.facts.length > 0 && <EntriesTable facts={report.facts} />}

      <SyncStatusLine syncStatus={syncStatus} />
    </TimesheetShell>
  );
}
