import { formatCents, formatRate } from "@/lib/timesheet/revenue";

import type { ForecastDTO } from "./admin-timesheets-forecast.service";
import type { RevenueDTO } from "./admin-timesheets-revenue.service";
import type { QueryMeasure, QueryMeasureDTO } from "./admin-timesheets-query.types";
import type { AdminTimesheetsDTO, StaffDashboardDTO } from "./admin-timesheets.types";

// -------------------------------------------------------------------
// Turning "which figures were asked for" into figures.
//
// Pure, and every value here is COPIED from what the engine already computed -
// the aggregate pass for hours, computeRevenue for money, the staff dashboard
// for utilisation. The model chose which of these to show; it computed none of
// them. That is what stops the ask box becoming a second source of numbers
// that disagrees with the screen it links to.
//
// EACH FIGURE CARRIES ITS OWN CAVEAT. A value with unrated hours behind it is
// an understatement and says so; a margin with a partial cost base is not
// reported at all. Presenting a qualified number bare is the thing that
// actually misleads somebody.
// -------------------------------------------------------------------

const LABELS: Record<QueryMeasure, string> = {
  hours: "Hours logged",
  billableHours: "Billable hours",
  nonBillableHours: "Non-billable hours",
  value: "Chargeable value",
  cost: "Cost to us",
  margin: "Margin",
  effectiveRate: "Effective rate",
  utilisation: "Utilisation",
  projectedCost: "Projected cost",
  projectedValue: "Projected value",
  remainingCapacity: "Contracted hours left",
};

function hours(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : `${value.toFixed(2)}h`;
}

// -------------------------------------------------------------------
// What a projection assumes, in one line, sitting with the number.
//
// Ordered by what would most likely make the figure wrong: a missing rate
// means there is no figure at all; leave is the reason a committed cost comes
// in high; and a projected VALUE additionally assumes the billable mix holds,
// which is the softest assumption on the screen.
// -------------------------------------------------------------------
function forecastCaveat(forecast: ForecastDTO | null, kind: "cost" | "value"): string | null {
  if (forecast === null) return null;

  if (forecast.progress.isComplete) return "The period has finished, so this is the actual";

  if (kind === "cost" && forecast.projectedCostCents === null) {
    return forecast.peopleWithoutCostRate > 0
      ? `${forecast.peopleWithoutCostRate} ${forecast.peopleWithoutCostRate === 1 ? "person has" : "people have"} no cost rate for the days ahead`
      : "Needs a cost rate on every hour, worked and remaining";
  }

  if (kind === "value" && forecast.projectedValueCents === null) {
    return forecast.progress.elapsedRatio !== null && forecast.progress.elapsedRatio < 0.25
      ? "Too early in the period to project revenue from the billable mix so far"
      : "Needs charge rates for everybody with days remaining";
  }

  const remaining = `${forecast.progress.weekdaysRemaining} weekday${forecast.progress.weekdaysRemaining === 1 ? "" : "s"} still to come`;

  return kind === "value"
    ? `${remaining}, assuming no leave and the same billable mix`
    : `${remaining}, assuming no leave`;
}

export function buildAnswerMeasures(
  measures: QueryMeasure[],
  data: AdminTimesheetsDTO,
  revenue: RevenueDTO,
  dashboard: StaffDashboardDTO | null,
  forecast: ForecastDTO | null,
): QueryMeasureDTO[] {
  // Deduplicated but order-preserving, so a model that asks for cost twice
  // does not produce two identical rows.
  const wanted = [...new Set(measures)];

  return wanted.map((key) => {
    switch (key) {
      case "hours":
        return { key, label: LABELS[key], value: hours(data.report.totals.hours), caveat: null };

      case "billableHours":
        return { key, label: LABELS[key], value: hours(data.report.split.billableHours), caveat: null };

      case "nonBillableHours":
        return {
          key,
          label: LABELS[key],
          value: hours(data.report.split.nonBillableHours),
          caveat:
            data.report.split.unsetHours > 0
              ? `${data.report.split.unsetHours.toFixed(2)}h more is unset, which is not the same as non-billable`
              : null,
        };

      case "value":
        return {
          key,
          label: LABELS[key],
          value: revenue.configured ? formatCents(revenue.chargeableValueCents) : "-",
          caveat: !revenue.configured
            ? "No charge rates are set, so nothing can be valued"
            : revenue.unratedBillableHours > 0
              ? `${revenue.unratedBillableHours.toFixed(2)}h of billable time has no rate, so this is an understatement`
              : null,
        };

      case "cost":
        return {
          key,
          label: LABELS[key],
          value: revenue.configured ? formatCents(revenue.costCents) : "-",
          caveat:
            revenue.configured && revenue.costCents === null
              ? revenue.uncostedHours > 0
                ? `${revenue.uncostedHours.toFixed(2)}h has no cost rate, so a total would be partial`
                : "No cost rates are recorded"
              : revenue.nonBillableCostCents
                ? `includes ${formatCents(revenue.nonBillableCostCents)} of non-billable time`
                : null,
        };

      case "margin": {
        // Same trap as the tiles: a billable-filtered set has had its
        // non-billable cost removed, so what is left flatters the margin.
        const filtered = data.filters.billable !== "all";

        return {
          key,
          label: LABELS[key],
          value: !revenue.configured || filtered ? "-" : formatCents(revenue.marginCents),
          caveat: filtered
            ? "Not meaningful for a billable-filtered question: the non-billable cost is excluded"
            : revenue.marginCents === null
              ? "Margin needs a cost rate on every valued hour"
              : revenue.marginRatio !== null
                ? `${Math.round(revenue.marginRatio * 100)}% of chargeable value`
                : null,
        };
      }

      case "effectiveRate":
        return {
          key,
          label: LABELS[key],
          value: revenue.configured ? formatRate(revenue.effectiveRatePerLoggedHourCents) : "-",
          // The distinction that makes the figure worth having: per hour of
          // team time, not per hour charged for.
          caveat:
            revenue.chargeRatePerBillableHourCents === null
              ? null
              : `per logged hour; ${formatRate(revenue.chargeRatePerBillableHourCents)} on billable hours alone`,
        };

      // -------------------------------------------------------------------
      // FORECASTS. Every one says what it assumes, in the caveat, because the
      // assumption is the figure's main weakness and a projection quoted
      // without it is worse than no projection.
      // -------------------------------------------------------------------
      case "projectedCost":
        return {
          key,
          label: LABELS[key],
          value: formatCents(forecast?.projectedCostCents ?? null),
          caveat: forecastCaveat(forecast, "cost"),
        };

      case "projectedValue":
        return {
          key,
          label: LABELS[key],
          value: formatCents(forecast?.projectedValueCents ?? null),
          caveat: forecastCaveat(forecast, "value"),
        };

      case "remainingCapacity":
        return {
          key,
          label: LABELS[key],
          value: forecast === null ? "-" : hours(forecast.committedRemainingHours),
          caveat:
            forecast === null
              ? null
              : forecast.progress.isComplete
                ? "The period has finished"
                : `${forecast.progress.weekdaysRemaining} weekday${forecast.progress.weekdaysRemaining === 1 ? "" : "s"} left, assuming no leave`,
        };

      case "utilisation":
        return {
          key,
          label: LABELS[key],
          value:
            dashboard === null || dashboard.totals.utilisation === null
              ? "-"
              : `${Math.round(dashboard.totals.utilisation * 100)}%`,
          caveat:
            dashboard === null
              ? null
              : `${dashboard.totals.loggedHours.toFixed(2)}h of ${dashboard.totals.capacityHours.toFixed(2)}h contracted`,
        };
    }
  });
}

// -------------------------------------------------------------------
// The scope line: what the answer is an answer ABOUT.
//
// Not decoration. "$8,430" with nothing beside it is how one person's week
// gets quoted as the firm's month. Built from the RESOLVED filters, so it
// describes what was actually measured rather than what was asked for.
// -------------------------------------------------------------------
export function describeScope(input: {
  periodLabel: string;
  peopleNames: string[];
  category: string | undefined;
  projectLabel: string | undefined;
  billable: string | undefined;
}): string {
  const parts: string[] = [];

  if (input.peopleNames.length === 0) parts.push("everyone");
  else if (input.peopleNames.length <= 3) parts.push(input.peopleNames.join(" and "));
  else parts.push(`${input.peopleNames.length} people`);

  if (input.billable && input.billable !== "all") {
    parts.push(input.billable === "unset" ? "time with no billable flag" : `${input.billable.toLowerCase()} time`);
  }

  if (input.category && input.category !== "all") parts.push(`in ${input.category}`);
  if (input.projectLabel) parts.push(`on ${input.projectLabel}`);

  return `${parts.join(", ")} - ${input.periodLabel}`;
}
