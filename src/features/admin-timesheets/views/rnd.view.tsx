import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/routes";
import { computeRevenue, formatCents, type RevenueTotals } from "@/lib/timesheet/revenue";
import {
  rollUpRndByIssue,
  rollUpRndByMonth,
  rollUpRndByPerson,
  rollUpRndBySpace,
  summariseRnd,
  type RndGroupTotal,
} from "@/lib/timesheet/aggregate";

import { getAdminTimesheetsService, TimesheetRequest } from "../admin-timesheets.service";
import { getStaffRateRowsService } from "../admin-timesheets-rate.service";
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
  const [data, rates] = await Promise.all([getAdminTimesheetsService(request), getStaffRateRowsService()]);
  const { period, report, syncStatus } = data;

  // Read off the fact rows, which are one row per worklog. Never joined to an
  // issue-level table: an issue with six worklogs would count its hours six
  // times over.
  const totals = summariseRnd(report.facts);

  const unclassified = report.facts.filter((fact) => fact.rndClass === null).length;

  // -----------------------------------------------------------------
  // COST, because a claim is made in dollars and hours are only the
  // working.
  //
  // computeRevenue is reused rather than reimplemented, so this cannot
  // disagree with the money shown anywhere else in the product - same rate
  // resolution, same effective-dated lookup, and crucially the same rule
  // about when a cost is not reportable.
  //
  // THAT RULE IS THE IMPORTANT PART HERE. Cost comes back NULL unless every
  // logged hour in the set had a cost rate. A partially costed total is the
  // dangerous number for a claim: it looks complete, it is quotable, and it
  // understates by exactly the hours nobody priced. uncostedHours says how
  // much is missing, so a null is fixable rather than mysterious.
  //
  // Charge rates are deliberately not shown. What a client would have been
  // billed is not the claimable figure - what the work cost the business is.
  // -----------------------------------------------------------------
  const coreMoney = computeRevenue(
    report.facts.filter((fact) => fact.rndClass === "core"),
    rates,
  );
  const supportingMoney = computeRevenue(
    report.facts.filter((fact) => fact.rndClass === "supporting"),
    rates,
  );
  const rndMoney = computeRevenue(
    report.facts.filter((fact) => fact.rndClass !== null),
    rates,
  );

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

      {/* -------------------------------------------------------------
          Claimable expenditure.
          A claim is made in dollars; the hours above are the working. Cost
          rather than charge rate, because what a client would have been
          billed is not what the work cost the business.
          ------------------------------------------------------------- */}
      <section className="mt-6">
        <h2 className="text-base font-semibold text-foreground">Cost of R&amp;D time</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          What the classified hours cost the business, at the cost rates in force on each day the work was
          done. This is the expenditure figure, not what a client would have been charged.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <CostTile label="Core" money={coreMoney} hours={totals.coreHours} />
          <CostTile label="Supporting" money={supportingMoney} hours={totals.supportingHours} />
          <CostTile
            label="Total R&D"
            money={rndMoney}
            hours={totals.coreHours + totals.supportingHours}
            emphasis
          />
        </div>
      </section>

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

// -------------------------------------------------------------------
// One cost figure, and an honest account of it when there is not one.
//
// A NULL COST IS SHOWN AS "NOT AVAILABLE", NEVER AS ZERO OR AS A PARTIAL
// TOTAL. It means somebody in this set has no cost rate on file, so the
// true figure is higher than anything that could be printed here. For a
// claim that distinction is the whole ballgame: a number that is quietly
// too low is worse than no number, because only one of the two gets
// questioned.
//
// The uncosted hours are named so it is actionable - the fix is a cost rate
// on the Staff screen, not anything on this page.
// -------------------------------------------------------------------
function CostTile({
  label,
  money,
  hours,
  emphasis = false,
}: {
  label: string;
  money: RevenueTotals;
  hours: number;
  emphasis?: boolean;
}) {
  const available = money.costCents !== null;

  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        emphasis ? "border-primary/40 bg-primary/5" : "border-border bg-card",
      )}
    >
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>

      <p className={cn("mt-1 text-2xl font-semibold", available ? "text-foreground" : "text-muted-foreground")}>
        {available ? formatCents(money.costCents) : "Not available"}
      </p>

      {available ? (
        <p className="mt-1 text-sm text-muted-foreground">{hours.toFixed(2)} h at cost</p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          {money.uncostedHours.toFixed(2)} of {hours.toFixed(2)} hours have no cost rate on file, so the total
          would be understated. Set one on the Staff screen.
        </p>
      )}
    </div>
  );
}
