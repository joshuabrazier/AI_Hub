import "server-only";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { loadStaffRates, loadStaffTargets } from "./admin-timesheets-loaders";
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
import { buildDailyMoney, resolveRateFor, type StaffRateRow } from "@/lib/timesheet/revenue";
import { toStaffCapacity, type StaffCapacity } from "@/lib/timesheet/staff-capacity";
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
//
// TWO ENTRY POINTS, one shared core. They differ only in where the per-person
// capacity comes from, and that difference is a performance one - see the note
// on getForecastFromReportService.
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

// What the core needs per person: their arrangement, and what they have
// already done in this period.
interface ForecastPerson {
  personId: string;
  daysWorked: number;
  target: StaffCapacity;
}

// -------------------------------------------------------------------
// The cheap entry point, for a screen that has a report but no dashboard.
//
// WHY IT EXISTS. The overview used to call getStaffDashboardService purely to
// read each person's capacity - which rebuilds the ENTIRE report: a second full
// worklog scan, another issue fetch, and another round of service auth. One
// overview render reached 36 queries against a remote database, and because the
// filter tabs disable themselves while a navigation is in flight, that read as
// a tab that HANGS rather than a page that is slow.
//
// Everything needed is already on the report - byPerson carries daysWorked - so
// this adds one small targets query instead of a whole second report.
// -------------------------------------------------------------------
export async function getForecastFromReportService(input: {
  byPerson: { personId: string; daysWorked: number }[];
  period: TimesheetPeriodDTO;
  today: string;
  revenue: RevenueDTO;
  facts: WorklogFactRow[];
  personIds?: string[];
}): Promise<ForecastDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const [rateRows, targets] = await Promise.all([loadStaffRates(), loadStaffTargets()]);

    const targetByPerson = new Map(targets.map((row) => [row.personId, row]));
    const workedById = new Map(input.byPerson.map((person) => [person.personId, person]));

    // Everyone with time in the period PLUS anybody with a target who logged
    // none - the same population the dashboard reports on. A contracted person
    // who has logged nothing still has committed days ahead, and leaving them
    // out would understate what the period is going to cost.
    const ids = new Set<string>([...workedById.keys(), ...targetByPerson.keys()]);

    const people: ForecastPerson[] = [...ids].map((personId) => ({
      personId,
      daysWorked: workedById.get(personId)?.daysWorked ?? 0,
      target: toStaffCapacity(targetByPerson.get(personId) ?? null, personId),
    }));

    return buildForecast({
      people,
      period: input.period,
      today: input.today,
      revenue: input.revenue,
      facts: input.facts,
      rates: toRateRows(rateRows),
      personIds: input.personIds ?? [],
    });
  } catch (error) {
    throw handleError("getForecastFromReportService", error);
  }
}

// -------------------------------------------------------------------
// For a caller that already holds a staff dashboard, so capacity is to hand
// and nothing beyond the rates needs reading.
// -------------------------------------------------------------------
export async function getForecastForScopeService(
  dashboard: StaffDashboardDTO,
  period: TimesheetPeriodDTO,
  today: string,
  revenue: RevenueDTO,
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

    return buildForecast({
      people: dashboard.people.map((person) => ({
        personId: person.personId,
        daysWorked: person.daysWorked,
        target: person.target,
      })),
      period,
      today,
      revenue,
      facts,
      rates: toRateRows(await loadStaffRates()),
      personIds,
    });
  } catch (error) {
    throw handleError("getForecastForScopeService", error);
  }
}

// -------------------------------------------------------------------
// The shared core. No I/O, so the two entry points cannot drift apart in HOW
// they forecast - only in where they got the capacity from.
// -------------------------------------------------------------------
function buildForecast(input: {
  people: ForecastPerson[];
  period: TimesheetPeriodDTO;
  today: string;
  revenue: RevenueDTO;
  facts: WorklogFactRow[];
  rates: StaffRateRow[];
  personIds: string[];
}): ForecastDTO {
  const { period, today, revenue, rates } = input;
  const progress = periodProgress(period.from, period.to, today);

  const scopedPeople =
    input.personIds.length > 0
      ? input.people.filter((person) => input.personIds.includes(person.personId))
      : input.people;

  let committedHours = 0;
  let committedCost = 0;
  let peopleWithoutCostRate = 0;
  let prorated = false;
  let anyCosted = false;

  // Per person, because capacity and rate are both per person. Summing a
  // blended rate over a headcount would hide exactly the variation that makes
  // the figure worth having.
  for (const person of scopedPeople) {
    const forecast = forecastRemainingCost({
      from: period.from,
      to: period.to,
      today,
      capacity: person.target,
      // What makes the remainder exact rather than an average - see the note in
      // forecastRemainingCost.
      daysAlreadyWorked: person.daysWorked,
      personId: person.personId,
      rates,
    });

    committedHours += forecast.committedRemainingHours;
    if (forecast.proratedAcrossWeekdays) prorated = true;

    if (forecast.committedRemainingCostCents === null) {
      // Only a gap when there was something left to cost. A finished period
      // legitimately has no remainder.
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

  // The actual side has to be known too. If the cost base for work already done
  // is incomplete, adding a solid remainder to it produces a total whose error
  // is invisible.
  const projectedCostCents =
    revenue.costCents !== null && committedRemainingCostCents !== null
      ? revenue.costCents + committedRemainingCostCents
      : null;

  const projectedValueCents = projectValue({ revenue, progress, scopedPeople, rates, period, today });

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
      daily: buildDailyMoney(input.facts, rates),
      committedRemainingCostCents,
      projectedValueCents,
      actualValueCents: revenue.chargeableValueCents,
    }),
  };
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
// sample of one - and the resulting figure would sit next to measured ones with
// nothing to say it was a guess.
// -------------------------------------------------------------------
function projectValue(input: {
  revenue: RevenueDTO;
  progress: PeriodProgress;
  scopedPeople: ForecastPerson[];
  rates: StaffRateRow[];
  period: TimesheetPeriodDTO;
  today: string;
}): number | null {
  const { revenue, progress } = input;

  if (revenue.chargeableValueCents === null) return null;
  if (progress.isComplete) return revenue.chargeableValueCents;
  if (progress.elapsedRatio === null || progress.elapsedRatio < MIN_ELAPSED_FOR_PACE) return null;
  if (revenue.loggedHours <= 0) return null;

  // The share of logged time that has been billable so far. Not the target and
  // not an aspiration: what actually happened.
  const billableShare = revenue.billableHours / revenue.loggedHours;

  let remainingValue = 0;

  for (const person of input.scopedPeople) {
    const forecast = forecastRemainingCost({
      from: input.period.from,
      to: input.period.to,
      today: input.today,
      capacity: person.target,
      daysAlreadyWorked: person.daysWorked,
      personId: person.personId,
      rates: input.rates,
    });

    if (forecast.committedRemainingHours <= 0) continue;

    // Charge rate resolved at the period end: a future-dated rise inside the
    // remainder is handled day by day on the committed-cost path, and doing the
    // same here would imply more precision than an assumed billable share
    // deserves.
    const rate = resolveRateFor(input.rates, person.personId, input.period.to);
    if (rate === null) return null;

    remainingValue += rate.chargeRateCents * forecast.committedRemainingHours * billableShare;
  }

  return revenue.chargeableValueCents + Math.round(remainingValue);
}

// Re-exported so the answer builder can use the same pace rule without reaching
// into the engine directly.
export { forecastFromPace };
