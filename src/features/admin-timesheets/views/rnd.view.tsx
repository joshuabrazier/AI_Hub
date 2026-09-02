import { ROUTES } from "@/lib/routes";
import {
  rollUpRndByIssue,
  rollUpRndByMonth,
  rollUpRndByPerson,
  rollUpRndBySpace,
  summariseRnd,
  type RndGroupTotal,
} from "@/lib/timesheet/aggregate";

import { getAdminTimesheetsService, TimesheetRequest } from "../admin-timesheets.service";
import { StatTile, SyncStatusLine } from "../timesheet-panels";
import TimesheetShell from "../timesheet-shell";

// -------------------------------------------------------------------
// R&D: core, supporting and everything else.
//
// The figures here may support an R&D Tax Incentive claim, so two things
// govern how this screen is built.
//
// FIRST, every number comes from the classification FROZEN onto each worklog
// at sync time. Nothing here reads an issue's current labels. Jira labels are
// mutable and have no history, so a screen that derived them live would show
// a different answer for the same period depending on when you opened it -
// and the whole point of the snapshot is that it cannot.
//
// SECOND, "not R&D" is shown, not hidden. A claim is defended by being able
// to say what was excluded and why, and a page that only totalled the two R&D
// buckets would quietly stop reconciling with the timesheet next to it.
//
// The four groupings are the four questions asked of a claim: which client or
// programme the work was for, who did it, what it was booked to, and when.
// -------------------------------------------------------------------
export default async function RndView(request: TimesheetRequest) {
  const data = await getAdminTimesheetsService(request);
  const { period, report, syncStatus } = data;

  // Read off the fact rows, which are one row per worklog. Never joined to an
  // issue-level table: an issue with six worklogs would count its hours six
  // times over.
  const totals = summariseRnd(report.facts);

  const unclassified = report.facts.filter((fact) => fact.rndClass === null).length;

  return (
    <TimesheetShell
      data={data}
      pathname={ROUTES.ADMIN_TIMESHEETS_RND}
      title="R&D"
      description={`Core, supporting and non-R&D hours for ${period.label}, as classified when each entry was synced.`}
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Core"
          hours={totals.coreHours}
          hint="Labelled RnD-core in Jira"
          emphasis={totals.coreSeconds > 0 ? "normal" : "muted"}
          index={0}
        />
        <StatTile
          label="Supporting"
          hours={totals.supportingHours}
          hint="Labelled RnD-supporting"
          emphasis={totals.supportingSeconds > 0 ? "normal" : "muted"}
          index={1}
        />
        <StatTile
          label="Not R&D"
          hours={totals.nonRndHours}
          hint="Carried neither label"
          emphasis="muted"
          index={2}
        />
        <StatTile
          label="Total"
          hours={totals.totalHours}
          hint="Every hour in the period"
          emphasis="muted"
          index={3}
        />
      </div>

      {/* The classification is a snapshot, and saying so on the screen is
          part of what makes the figure defensible. Somebody reading this in
          a year needs to know it is not a live view of Jira's labels. */}
      <p className="mt-4 text-sm text-muted-foreground">
        Each entry keeps the classification it had when it was synced. Changing a label in Jira does not
        reclassify hours already recorded, which is deliberate: a claim has to stay reproducible.
        {unclassified > 0
          ? ` ${unclassified.toLocaleString()} of ${report.facts.length.toLocaleString()} entries carried neither label.`
          : ""}
      </p>

      <RndTable
        title="By space"
        caption="R&D is a property of the work item, not the space, so client work carrying a label appears here too."
        rows={rollUpRndBySpace(report.facts)}
        firstColumn="Space"
      />

      <RndTable title="By person" caption="Who did the work." rows={rollUpRndByPerson(report.facts)} firstColumn="Person" />

      <RndTable
        title="By month"
        caption="Claim periods are annual, but the evidence is monthly."
        rows={rollUpRndByMonth(report.facts)}
        firstColumn="Month"
      />

      <RndTable
        title="By work item"
        caption="Only items with R&D hours are worth listing here."
        rows={rollUpRndByIssue(report.facts).filter((row) => row.coreSeconds > 0 || row.supportingSeconds > 0)}
        firstColumn="Item"
        showKey
      />

      <SyncStatusLine syncStatus={syncStatus} />
    </TimesheetShell>
  );
}

// -------------------------------------------------------------------
// One grouping.
//
// Hours to two decimals rather than the raw four the engine carries: this is
// a table somebody reads, and 2.0000 in a cell is noise. The underlying sums
// are untouched - rounding happens here, at the edge, once.
// -------------------------------------------------------------------
function RndTable({
  title,
  caption,
  rows,
  firstColumn,
  showKey = false,
}: {
  title: string;
  caption: string;
  rows: RndGroupTotal[];
  firstColumn: string;
  // Show the key beside the label, for items where "RDP-25" is more use to
  // the reader than the summary alone.
  showKey?: boolean;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{caption}</p>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nothing in this period.
        </p>
      ) : (
        // Its own scroll container, so a wide table never makes the page
        // scroll sideways.
        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="border-b border-border bg-muted/40 text-left">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium text-muted-foreground">
                  {firstColumn}
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                  Core
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                  Supporting
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                  Not R&amp;D
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="px-4 py-2.5 text-foreground">
                    {showKey && row.key !== row.label ? (
                      <>
                        <span className="font-mono text-xs text-muted-foreground">{row.key}</span>{" "}
                        <span>{row.label}</span>
                      </>
                    ) : (
                      row.label
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                    {row.coreHours.toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                    {row.supportingHours.toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {row.nonRndHours.toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-foreground">
                    {row.totalHours.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
