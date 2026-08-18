import { ROUTES } from "@/lib/routes";

import { getAdminTimesheetsService, TimesheetRequest } from "../admin-timesheets.service";
import { ALL_CATEGORIES } from "../admin-timesheets.types";
import { ProductivityChart } from "../productivity-chart";
import { EmptyState, ProjectsCard, StatTile, SyncStatusLine } from "../timesheet-panels";
import TimesheetShell, { weekHref } from "../timesheet-shell";
import { EntriesTable, PersonDaysTable, StaffTable } from "../timesheet-tables";

// -------------------------------------------------------------------
// Staff: who worked, how much, and how much of it bills.
//
// Two states in one view. With nobody selected it is the team: one row per
// person, sorted by hours. Pick someone - from the selector or by clicking
// their name - and the same page becomes their timesheet: day by day, the jobs
// they touched, and every entry they logged.
//
// Selection is a URL parameter, not component state, so one person's month can
// be linked to and sent to them.
// -------------------------------------------------------------------
export default async function StaffView(request: TimesheetRequest) {
  const data = await getAdminTimesheetsService(request);
  const { period, filters, report, syncStatus, workingHoursPerDay, periodTotalHours, personOptions, weekSeries, week } =
    data;

  const isPersonSelected = filters.person !== ALL_CATEGORIES;
  const selected = personOptions.find((option) => option.value === filters.person);
  const person = report.byPerson[0];

  const hasEntries = report.totals.worklogCount > 0;

  return (
    <TimesheetShell
      view="staff"
      data={data}
      title={isPersonSelected ? (selected?.label ?? "Staff") : "Staff"}
      description={
        isPersonSelected
          ? `Their time in ${period.label}. Choose "Everyone" to compare the team.`
          : `Hours and utilisation across the team in ${period.label}.`
      }
    >
      {!hasEntries ? (
        <>
          <EmptyState syncStatus={syncStatus} periodLabel={period.label} filtered={periodTotalHours > 0} />
          <SyncStatusLine syncStatus={syncStatus} />
        </>
      ) : isPersonSelected && person ? (
        <>
          {/* One person's week: which days were full, which were billable, and
              which were not worked at all. */}
          <ProductivityChart
            series={weekSeries}
            week={week}
            title={`${person.personName ?? person.personId}, week of ${week.label}`}
            previousHref={weekHref(ROUTES.ADMIN_TIMESHEETS_STAFF, filters, week.previousStart)}
            nextHref={weekHref(ROUTES.ADMIN_TIMESHEETS_STAFF, filters, week.nextStart)}
          />

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="Logged"
              hours={person.hours}
              hint={`${person.daysWorked} ${person.daysWorked === 1 ? "day" : "days"} worked`}
              index={0}
            />
            <StatTile
              label="Billable"
              hours={person.split.billableHours}
              ratio={person.split.billableRatio}
              index={1}
            />
            <StatTile label="Non-billable" hours={person.split.nonBillableHours} emphasis="muted" index={2} />
            <StatTile
              label="Average day"
              hours={person.daysWorked > 0 ? person.hours / person.daysWorked : 0}
              hint={`Against ${workingHoursPerDay}h`}
              index={3}
            />
          </div>

          <PersonDaysTable days={report.byPersonDay} workingHoursPerDay={workingHoursPerDay} />

          {/* Which jobs their time went to. */}
          <ProjectsCard projects={report.byProject} totalHours={report.totals.hours} index={2} />

          {/* Their entries, so the figures above can be checked. */}
          <EntriesTable facts={report.facts} />

          <SyncStatusLine syncStatus={syncStatus} />
        </>
      ) : (
        <>
          <ProductivityChart
            series={weekSeries}
            week={week}
            title="The team's week"
            previousHref={weekHref(ROUTES.ADMIN_TIMESHEETS_STAFF, filters, week.previousStart)}
            nextHref={weekHref(ROUTES.ADMIN_TIMESHEETS_STAFF, filters, week.nextStart)}
          />

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="People" hours={report.byPerson.length} format="count" index={0} />
            <StatTile label="Logged" hours={report.totals.hours} index={1} />
            <StatTile
              label="Billable"
              hours={report.split.billableHours}
              ratio={report.split.billableRatio}
              index={2}
            />
            <StatTile label="Non-billable" hours={report.split.nonBillableHours} emphasis="muted" index={3} />
          </div>

          <StaffTable people={report.byPerson} workingHoursPerDay={workingHoursPerDay} filters={filters} />
          <SyncStatusLine syncStatus={syncStatus} />
        </>
      )}
    </TimesheetShell>
  );
}
