import "server-only";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { listStaffRatesRepo } from "@/lib/data/repositories/staff-rate.repository";
import { handleError } from "@/lib/handle-errors";
import {
  buildBurnUp,
  forecastFromPace,
  forecastRemainingCost,
  MIN_ELAPSED_FOR_PACE,
  periodProgress,
  type BurnUpPoint,
  type PeriodProgress,
} from "@/lib/timesheet/forecast";
import { buildDailyMoney, resolveRateFor } from "@/lib/timesheet/revenue";
import type { WorklogFactRow } from "@/lib/timesheet/timesheet.types";

import { toRateRows } from "./admin-timesheets-rate.service";
import type { RevenueDTO } from "./admin-timesheets-revenue.service";
import type { StaffDashboardDTO, TimesheetPeriodDTO } from "./admin-timesheets.types";

// -------------------------------------------------------------------
// Forecasting a period across everybody in scope.
//
// TWO FIGURES WITH VERY DIFFERENT STANDING, and the DTO keeps them apart
// because presenting them as one is how a guess gets quoted as a commitment.
//
//   projectedCost is COMMITTED: actual cost so far, plus the remaining
//   contracted days at the cost rate in force on each of them. Not a
//   prediction - capacity the business has already agreed to pay for. Wrong
//   only if somebody takes leave.
//
//   projectedValue is an ASSUMPTION: it takes the billable share observed so
//   far and applies it to the remaining hours. Revenue depends on what the
//   remaining days are spent on, which nothing here knows, so this is a
//   projection in the ordinary sense and is withheld until enough of the
//   period has elapsed for the observed share to mean anything.
//
// Neither knows about leave, and public holidays are not in this system at
// all. That assumption travels on the DTO.
// -------------------------------------------------------------------

export interface ForecastDTO {
  progress: PeriodProgress;

  // Contracted hours still to come across everybody in scope.
  committedRemainingHours: number;
  committedRemainingCostCents: number | null;

  // Actual so far plus the committed remainder.
  projectedCostCents: number | null;
  // Actual so far plus the remaining hours at the observed billable share.
  projectedValueCents: number | null;

  // How many people in scope had no usable cost rate for some remaining day.
  // Non-zero is why a projection is missing, and it names the fix.
  peopleWithoutCostRate: number;

  assumesNoLeave: true;
  // True when at least one part-timer's capacity had to be spread across
  // weekdays, because the arrangement records how many days and never which.
  proratedAcrossWeekdays: boolean;

  // The chart series: cumulative, one point per weekday, each flagged actual
  // or forecast. Empty when there is nothing worth drawing.
  burnUp: BurnUpPoint[];
}

export async function getForecastForScopeService(
  dashboard: StaffDashboardDTO,
  period: TimesheetPeriodDTO,
  today: string,
  revenue: RevenueDTO,
  // The rows the screen is showing, for the day-by-day series. The same facts
  // the revenue totals were computed from, so the chart and the tiles cannot
  // disagree.
  facts: WorklogFactRow[],
  // The people the question resolved to. Empty means everybody.
  //
  // REQUIRED, and not derivable from the dashboard: `dashboard.people` is
  // deliberately EVERYONE with time or a target, because the person page picks
  // its own row out of that list. Forecasting over it while the revenue half
  // used the filtered facts produced a one-person answer with the whole team's
  // remaining days added to it - a wrong number that read perfectly.
  personIds: string[] = [],
): Promise<ForecastDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const rates = toRateRows(await listStaffRatesRepo());
    const progress = periodProgress(period.from, period.to, today);

    const scopedPeople =
      personIds.length > 0
        ? dashboard.people.filter((person) => personIds.includes(person.personId))
        : dashboard.people;

    let committedHours = 0;
    let committedCost = 0;
    let peopleWithoutCostRate = 0;
    let prorated = false;
    let anyCosted = false;

    // Per person, because capacity and rate are both per person. Summing a
    // blended rate over a headcount would hide exactly the variation that
    // makes the figure worth having.
    for (const person of scopedPeople) {
      const forecast = forecastRemainingCost({
        from: period.from,
        to: period.to,
        today,
        capacity: person.target,
        // The days they have ALREADY worked in this period. This is what makes
        // the remainder exact rather than an average - see the note in
        // forecastRemainingCost.
        daysAlreadyWorked: person.daysWorked,
        personId: person.personId,
        rates,
      });

      committedHours += forecast.committedRemainingHours;
      if (forecast.proratedAcrossWeekdays) prorated = true;

      if (forecast.committedRemainingCostCents === null) {
        // Only counts as a gap when there was something left to cost. A
        // finished period legitimately has no remainder.
        if (forecast.committedRemainingHours > 0) peopleWithoutCostRate += 1;
        continue;
      }

      anyCosted = true;
      committedCost += forecast.committedRemainingCostCents;
    }

    // Withheld whenever anybody in scope is missing a rate, the same rule the
    // valuation uses: a total covering four people of five is not a smaller
    // number, it is a wrong one.
    const committedRemainingCostCents =
      progress.weekdaysRemaining === 0 ? 0 : anyCosted && peopleWithoutCostRate === 0 ? committedCost : null;

    // The actual side has to be known too. If the cost base for work already
    // done is incomplete, adding a solid remainder to it produces a total
    // whose error is invisible.
    const projectedCostCents =
      revenue.costCents !== null && committedRemainingCostCents !== null
        ? revenue.costCents + committedRemainingCostCents
        : null;

    // Hoisted so the chart and the figure are the same number rather than two
    // calls that could drift.
    const projectedValueCents = projectValue(revenue, progress, scopedPeople, rates, period, today);

    return {
      progress,
      committedRemainingHours: Math.round(committedHours * 100) / 100,
      committedRemainingCostCents,
      projectedCostCents,
      projectedValueCents,
      peopleWithoutCostRate,
      assumesNoLeave: true,
      proratedAcrossWeekdays: prorated,
      burnUp: buildBurnUp({
        from: period.from,
        to: period.to,
        today,
        daily: buildDailyMoney(facts, rates),
        committedRemainingCostCents,
        projectedValueCents,
        actualValueCents: revenue.chargeableValueCents,
      }),
    };
  } catch (error) {
    throw handleError("getForecastForScopeService", error);
  }
}

// -------------------------------------------------------------------
// Projected revenue, which is a genuinely softer number than projected cost.
//
// Cost is committed by the arrangement; revenue depends on what the remaining
// days are SPENT on. So this takes the billable share actually observed in the
// period so far and assumes it continues, priced at each person's charge rate.
//
// Withheld until MIN_ELAPSED_FOR_PACE of the period has gone, because a
// billable share measured over one day of twenty-one is not a share, it is a
// sample of one - and the resulting figure would sit next to measured ones
// with nothing to say it was a guess.
// -------------------------------------------------------------------
function projectValue(
  revenue: RevenueDTO,
  progress: PeriodProgress,
  // Already scoped by the caller - see the note there about why the full
  // dashboard list is the wrong input.
  scopedPeople: StaffDashboardDTO["people"],
  rates: ReturnType<typeof toRateRows>,
  period: TimesheetPeriodDTO,
  today: string,
): number | null {
  if (revenue.chargeableValueCents === null) return null;
  if (progress.isComplete) return revenue.chargeableValueCents;
  if (progress.elapsedRatio === null || progress.elapsedRatio < MIN_ELAPSED_FOR_PACE) return null;
  if (revenue.loggedHours <= 0) return null;

  // The share of logged time that has been billable so far. Not the target,
  // and not an aspiration: what actually happened.
  const billableShare = revenue.billableHours / revenue.loggedHours;

  let remainingValue = 0;

  for (const person of scopedPeople) {
    const forecast = forecastRemainingCost({
      from: period.from,
      to: period.to,
      today,
      capacity: person.target,
      daysAlreadyWorked: person.daysWorked,
      personId: person.personId,
      rates,
    });

    if (forecast.committedRemainingHours <= 0) continue;

    // Charge rate resolved at the period end: a future-dated rise inside the
    // remainder is an edge case the committed-cost path handles day by day,
    // and doing the same here would imply more precision than an assumed
    // billable share deserves.
    const rate = resolveRateFor(rates, person.personId, period.to);
    if (rate === null) return null;

    remainingValue += rate.chargeRateCents * forecast.committedRemainingHours * billableShare;
  }

  return revenue.chargeableValueCents + Math.round(remainingValue);
}

// Re-exported so the answer builder can use the same pace rule without
// reaching into the engine directly.
export { forecastFromPace };
