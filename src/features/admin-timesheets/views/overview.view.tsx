import { isBedrockConfigured } from "@/lib/ai/bedrock-client";
import { ROUTES } from "@/lib/routes";

import { getForecastFromReportService } from "../admin-timesheets-forecast.service";
import { getOutstandingEffortService } from "../admin-timesheets-outstanding.service";
import { getRevenueForFactsService } from "../admin-timesheets-revenue.service";
import { ForecastChart } from "../forecast-chart";
import { OutstandingCard } from "../outstanding-card";
import { ConcentrationCard, RevenueTiles } from "../revenue-panels";
import { TimesheetAskBox } from "../timesheet-ask-box";
import { getOverviewService, TimesheetRequest } from "../admin-timesheets.service";
import { CategorySplitCard, ReadinessCard } from "../overview-panels";
import { ProductivityChart } from "../productivity-chart";
import { EmptyState, StatTile, SyncStatusLine } from "../timesheet-panels";
import TimesheetShell, { periodHref } from "../timesheet-shell";

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
  const { period, filters, report, syncStatus, periodTotalHours, periodSeries } = data;

  // Values the facts the report already fetched - one extra query, for the
  // rate table, which is one row per person per rate change.
  const revenue = await getRevenueForFactsService(report.facts);

  // From the report this screen ALREADY has, plus one small targets query.
  // Fetching a whole staff dashboard for the capacity rebuilt the entire report
  // a second time and took one render to 36 queries - which, because the filter
  // tabs disable themselves mid-navigation, read as a tab that hangs.
  const forecast = await getForecastFromReportService({
    byPerson: report.byPerson,
    period,
    today: data.todayIso,
    revenue,
    facts: report.facts,
  });

  const hasData = report.totals.worklogCount > 0;

  // -----------------------------------------------------------------
  // WHAT IS LEFT, once the screen is narrowed to somebody's work.
  //
  // Only fetched when a client is chosen. Unfiltered it would be the whole
  // company's backlog dropped into a page about one month, which is what the
  // Outstanding screen is for - and it would cost a query on every render of
  // the default view to show something nobody asked this screen for.
  //
  // A project narrows it further. Both come straight off the filters, so the
  // card describes exactly what the dropdowns say.
  // -----------------------------------------------------------------
  const isFiltered = filters.client !== "all";

  const outstanding = isFiltered
    ? await getOutstandingEffortService({ clientKey: filters.client, projectKey: filters.project })
    : null;

  // What the card calls the thing it is describing. The project's own summary
  // where one is chosen, otherwise the client - matching how the dropdowns
  // read, rather than making the reader hold the filter state in their head.
  const selectedProject =
    filters.project === "all" ? null : data.projectOptions.find((option) => option.value === filters.project);
  const selectedClient = data.clientOptions.find((option) => option.value === filters.client);

  const scopeLabel = selectedProject?.label ?? selectedClient?.label ?? filters.client;

  return (
    <TimesheetShell
      data={data}
      pathname={ROUTES.ADMIN_TIMESHEETS}
      title="Overview"
      description={`How the business is tracking in ${period.label}.`}
    >
      {!hasData ? (
        <>
          <EmptyState syncStatus={syncStatus} periodLabel={period.label} filtered={periodTotalHours > 0} />

          {/* Shown here TOO, and this is the case it matters most in: no time
              logged against this client in the period, but work still open on
              them. Those two facts together are the whole point of the card,
              and hiding it behind "there is nothing to show" would suppress
              the more interesting half of the answer. It is not period data,
              so an empty period does not make it empty. */}
          {outstanding && <OutstandingCard
              summary={outstanding}
              scopeLabel={scopeLabel}
              clientKey={filters.client}
              projectKey={filters.project}
            />}

          <SyncStatusLine syncStatus={syncStatus} />
        </>
      ) : (
        <>
          <TimesheetAskBox filters={filters} disabled={!isBedrockConfigured()} />

          {/* -------------------------------------------------------------
              ABOVE THE FOLD: four figures and one chart.

              This screen had eight tiles, three charts and four cards, which is
              not an overview - it is everything, in a pile. What survives up
              here is the set that answers "how are we doing" without scrolling:
              what the period is WORTH, whether the team is BUSY, how much of
              that busyness EARNS, and what can actually be INVOICED.

              Everything else is still on the page, below a divider. Nothing was
              deleted - it was demoted, which is the difference between a
              simpler screen and a screen missing its answers.
              ------------------------------------------------------------- */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="Chargeable value"
              hours={revenue.chargeableValueCents === null ? 0 : revenue.chargeableValueCents / 100}
              format="currency"
              hint={
                revenue.configured
                  ? `${report.split.billableHours.toFixed(2)}h billable`
                  : "No charge rates set"
              }
              emphasis={revenue.configured ? "normal" : "muted"}
              index={0}
            />
            <StatTile
              label="Utilisation"
              hours={overview.utilisation === null ? 0 : Math.round(overview.utilisation * 100)}
              format="percent"
              ratio={overview.utilisation}
              hint={`${report.totals.hours.toFixed(2)}h of ${overview.capacityHours.toFixed(2)}h contracted`}
              index={1}
            />
            <StatTile
              label="Billable share"
              hours={report.split.billableRatio === null ? 0 : Math.round(report.split.billableRatio * 100)}
              format="percent"
              ratio={report.split.billableRatio}
              hint={`${report.split.nonBillableHours.toFixed(2)}h non-billable`}
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

          {outstanding && <OutstandingCard
              summary={outstanding}
              scopeLabel={scopeLabel}
              clientKey={filters.client}
              projectKey={filters.project}
              index={4}
            />}

          {/* The week, day by day. The company shape at the grain people
              actually think in - a quarter of weekly bars answered a question
              nobody was asking on this screen. */}
          <ProductivityChart
            series={periodSeries}
            period={period}
            title="The company week"
            showFigures={false}
            previousHref={periodHref(ROUTES.ADMIN_TIMESHEETS, filters, period.previousStart)}
            nextHref={periodHref(ROUTES.ADMIN_TIMESHEETS, filters, period.nextStart)}
          />

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
            <SyncStatusLine syncStatus={syncStatus} />
          </div>

          {/* -------------------------------------------------------------
              BELOW THE FOLD: the detail, in the order somebody drills into it.
              Money first, then where it lands, then what needs fixing.
              ------------------------------------------------------------- */}
          <div className="space-y-6 pt-2">
            <h2 className="font-heading text-lg font-semibold text-foreground">In detail</h2>

            <RevenueTiles revenue={revenue} billableFilter={filters.billable} showValue={false} index={0} />

            <ForecastChart
              points={forecast.burnUp}
              periodLabel={period.label}
              projectedCostCents={forecast.projectedCostCents}
              projectedValueCents={forecast.projectedValueCents}
              weekdaysRemaining={forecast.progress.weekdaysRemaining}
              index={1}
            />

            {/* Concentration ranks jobs by VALUE and carries the risk
                threshold; Top jobs ranks the same jobs by hours. Keeping both
                was the clearest duplication on the page, so the hours version
                goes and the category split moves alongside. */}
            <ConcentrationCard revenue={revenue} index={2} />

            <div className="grid items-start gap-6 lg:grid-cols-2">
              <CategorySplitCard categories={overview.categories} index={3} />
              <ReadinessCard readiness={overview.readiness} index={4} />
            </div>
          </div>
        </>
      )}
    </TimesheetShell>
  );
}
