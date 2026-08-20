import { type StaffCapacity } from "./staff-capacity";
import { resolveRateFor, type StaffRateRow } from "./revenue";

// -------------------------------------------------------------------
// Forecasting a period that has not finished.
//
// Pure: dates, capacity and rates in, projections out. No clock - `today` is
// passed in, because the app derives it in its own timezone and a forecast
// that read the machine clock would disagree with the dashboard beside it.
//
// THE DISTINCTION THIS FILE EXISTS TO MAKE. There are two very different
// numbers people call a forecast, and presenting them as one is how a guess
// gets quoted as a commitment:
//
//   COMMITTED - what the remaining CONTRACTED days will cost. Not a prediction
//   at all: it is capacity the business has already agreed to pay for,
//   multiplied by the rate in force on each of those days. Wrong only if
//   somebody takes leave or the arrangement changes.
//
//   PACE - extrapolated from what has been logged so far. A genuine
//   prediction, and a bad one early in a period: one day into a month, it
//   multiplies a single day by twenty-one. It is offered WITH its elapsed
//   fraction so the reader can discount it, and never on its own.
//
// WHAT IT CANNOT KNOW, and therefore says out loud:
//
//   - LEAVE. Nothing in this system records holidays, sick days or public
//     holidays. Every projection assumes the remaining contracted days are
//     worked. That assumption is stated on the DTO rather than buried here,
//     because it is the single most likely reason a forecast is too high.
//   - WHICH days somebody works. staff_target records how MANY days a week,
//     never which. So the remaining DAYS are counted against the arrangement
//     and then spread across the remaining weekdays for rate purposes - see
//     forecastRemainingCost. For a three-day person that spread is an average,
//     not a rota, but the day COUNT is exact.
// -------------------------------------------------------------------

const SECONDS_PER_DAY = 24 * 60 * 60;
const DAYS_PER_FULL_WEEK = 5;

export interface PeriodProgress {
  weekdaysInPeriod: number;
  // Weekdays from the start of the period up to and INCLUDING today, because
  // today's work is in progress rather than still to come. A period that has
  // ended counts every weekday as elapsed.
  weekdaysElapsed: number;
  weekdaysRemaining: number;
  // 0 to 1. Null when the period contains no weekdays at all, which would
  // otherwise divide by zero.
  elapsedRatio: number | null;
  // The period has finished: nothing to forecast, everything is actual.
  isComplete: boolean;
  // The period has not started: everything is forecast, nothing is actual.
  isFuture: boolean;
}

function isWeekday(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * SECONDS_PER_DAY * 1000)
    .toISOString()
    .slice(0, 10);
}

// -------------------------------------------------------------------
// Every weekday in an inclusive range.
//
// UTC arithmetic on date-only strings, the same reasoning as countWeekdays in
// staff-capacity.ts: there is no wall clock in these values, so parsing them
// in a local zone is what shifts a Monday onto the previous Sunday.
// -------------------------------------------------------------------
export function weekdaysBetween(from: string, to: string): string[] {
  const days: string[] = [];

  if (from > to) return days;

  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
    if (isWeekday(cursor)) days.push(cursor);
    // Guard against a malformed bound producing an unbounded loop.
    if (days.length > 4000) break;
  }

  return days;
}

export function periodProgress(from: string, to: string, today: string): PeriodProgress {
  const all = weekdaysBetween(from, to);

  const isComplete = today > to;
  const isFuture = today < from;

  const elapsed = isComplete ? all : isFuture ? [] : all.filter((day) => day <= today);

  return {
    weekdaysInPeriod: all.length,
    weekdaysElapsed: elapsed.length,
    weekdaysRemaining: all.length - elapsed.length,
    elapsedRatio: all.length > 0 ? elapsed.length / all.length : null,
    isComplete,
    isFuture,
  };
}

export interface CostForecast {
  progress: PeriodProgress;

  // What the remaining contracted days will cost, at the rate in force on
  // each of them. Null when the person has no cost rate covering some
  // remaining day, because a partial remainder understates the total.
  committedRemainingCostCents: number | null;
  // The contracted hours behind that figure, so the reader can see what is
  // being assumed rather than only its price.
  committedRemainingHours: number;

  // Every projection here assumes the remaining contracted days are actually
  // worked. Nothing in this system knows about leave.
  assumesNoLeave: true;
  // True when capacity had to be prorated across weekdays because the
  // arrangement records how many days, not which.
  proratedAcrossWeekdays: boolean;
}

// -------------------------------------------------------------------
// What the rest of the period is already committed to cost.
//
// THE DAY COUNT COMES FROM THE ARRANGEMENT, NOT FROM THE CALENDAR, and getting
// that the wrong way round was a real error worth naming. Spreading "three
// days a week" evenly over five weekdays gives 0.6 of a day per weekday, so a
// three-day person with one weekday left forecast 4.5 hours - a number that
// can never be the actual, because that last day is either worked in full or
// not at all. It was also wrong in the other direction: with the whole week
// ahead it forecast only the days that fell after today, quietly writing off
// contracted days that had not happened yet.
//
// So: DAYS REMAINING = the days the arrangement expects in this period, minus
// the days already worked. `daysAlreadyWorked` comes from the report, and it
// is what makes this exact rather than averaged - somebody contracted to three
// days who has worked two has one left, whichever weekday it lands on.
//
// Capped at the number of weekdays actually left, because nobody works four
// contracted days in the one day remaining.
//
// The resulting days are then SPREAD across the remaining weekdays only to
// resolve rates, since a rate is keyed to a date and a remaining day has no
// particular one. That spread is an average; the total is not.
// -------------------------------------------------------------------
export function forecastRemainingCost(input: {
  from: string;
  to: string;
  today: string;
  capacity: StaffCapacity;
  // Distinct days this person has already logged time on, within this period.
  daysAlreadyWorked: number;
  personId: string;
  rates: StaffRateRow[];
}): CostForecast {
  const progress = periodProgress(input.from, input.to, input.today);

  const remainingWeekdays = weekdaysBetween(input.from, input.to).filter((day) =>
    progress.isComplete ? false : progress.isFuture ? true : day > input.today,
  );

  const share = input.capacity.workingDaysPerWeek / DAYS_PER_FULL_WEEK;

  // What the arrangement expects across the WHOLE period, prorated by weekdays
  // so a month and a week both work without a special case.
  const expectedWorkingDays = progress.weekdaysInPeriod * share;

  const remainingWorkingDays = Math.max(
    0,
    Math.min(expectedWorkingDays - input.daysAlreadyWorked, remainingWeekdays.length),
  );

  const remainingHours = remainingWorkingDays * input.capacity.hoursPerDay;

  // Spread across the remaining weekdays purely so each fraction can be priced
  // at the rate in force on a real date - which is what catches a rate change
  // dated inside the remainder.
  const hoursPerWeekday = remainingWeekdays.length > 0 ? remainingHours / remainingWeekdays.length : 0;

  let costCents = 0;
  let anyRate = false;
  let missingRate = false;

  for (const day of remainingWeekdays) {
    const rate = resolveRateFor(input.rates, input.personId, day);

    if (rate === null || rate.costRateCents === null) {
      missingRate = true;
      continue;
    }

    anyRate = true;
    costCents += rate.costRateCents * hoursPerWeekday;
  }

  return {
    progress,
    // Withheld when ANY remaining day could not be costed, for the same reason
    // a partial cost base yields no margin: a total covering four days of five
    // is not a smaller total, it is a wrong one.
    committedRemainingCostCents: anyRate && !missingRate ? Math.round(costCents) : null,
    committedRemainingHours: Math.round(remainingHours * 100) / 100,
    assumesNoLeave: true,
    proratedAcrossWeekdays: input.capacity.workingDaysPerWeek < DAYS_PER_FULL_WEEK,
  };
}

// -------------------------------------------------------------------
// The pace extrapolation, and its confidence.
//
// Deliberately returns null until enough of the period has gone for the
// arithmetic to mean anything. One day into a month it would multiply a single
// day by twenty-one and present the result next to real figures - the reader
// would have no way to see that one is measured and the other is a guess with
// a factor of twenty in it.
//
// The threshold is a share of the period rather than a day count, so it scales
// from a week to a year without a special case.
// -------------------------------------------------------------------
export const MIN_ELAPSED_FOR_PACE = 0.25;

export function forecastFromPace(actualCents: number | null, progress: PeriodProgress): number | null {
  if (actualCents === null) return null;
  if (progress.isComplete) return actualCents;
  if (progress.elapsedRatio === null || progress.elapsedRatio < MIN_ELAPSED_FOR_PACE) return null;
  if (progress.weekdaysElapsed === 0) return null;

  return Math.round(actualCents * (progress.weekdaysInPeriod / progress.weekdaysElapsed));
}

// -------------------------------------------------------------------
// The burn-up series: cumulative cost and value across a period, with the
// committed remainder carried to the end of it.
//
// CUMULATIVE, not per-day, because the question a forecast answers is "where
// will this land", and a reader answering it from daily bars has to add them
// up in their head. A rising line with a projected tail says it directly.
//
// EVERY POINT IS FLAGGED as actual or forecast. The one thing a burn-up must
// not do is let a projected segment read as measured - so the flag travels on
// the point rather than being inferred from the date by whoever draws it.
//
// Points are the period's WEEKDAYS, not the days with rows on them. A quiet
// Wednesday is a flat step, which is information; omitting it would compress
// the axis and make the shape a lie.
// -------------------------------------------------------------------
export interface BurnUpPoint {
  date: string;
  // Cumulative to the end of this day.
  cumulativeCostCents: number | null;
  cumulativeValueCents: number | null;
  // False for a day still to come, whose figures are the committed projection.
  isActual: boolean;
}

export function buildBurnUp(input: {
  from: string;
  to: string;
  today: string;
  // Actual money per day, from buildDailyMoney. Days without rows may be
  // absent; they become flat steps.
  daily: { date: string; costCents: number | null; valueCents: number | null }[];
  // The committed remainder to distribute across the days still to come.
  committedRemainingCostCents: number | null;
  projectedValueCents: number | null;
  // Actual value so far, so the value tail can be derived as the difference.
  actualValueCents: number | null;
}): BurnUpPoint[] {
  const weekdays = weekdaysBetween(input.from, input.to);
  if (weekdays.length === 0) return [];

  const byDate = new Map(input.daily.map((day) => [day.date, day]));

  const remainingWeekdays = weekdays.filter((day) => day > input.today);

  // The tail is spread evenly across the days still to come. An even spread is
  // an assumption, and the honest one: nothing here knows which of those days
  // somebody will work.
  const costStep =
    input.committedRemainingCostCents !== null && remainingWeekdays.length > 0
      ? input.committedRemainingCostCents / remainingWeekdays.length
      : null;

  const valueTail =
    input.projectedValueCents !== null && input.actualValueCents !== null
      ? input.projectedValueCents - input.actualValueCents
      : null;

  const valueStep = valueTail !== null && remainingWeekdays.length > 0 ? valueTail / remainingWeekdays.length : null;

  let cost = 0;
  let value = 0;
  let costKnown = true;
  let valueKnown = true;

  return weekdays.map((date) => {
    const isActual = date <= input.today;

    if (isActual) {
      const day = byDate.get(date);

      // A day with rows but no cost - somebody without a rate - makes every
      // later point unknowable rather than merely lower. Nulling from there on
      // is the only honest option: a line that silently skipped it would slope
      // wrongly for the rest of the period.
      if (day) {
        if (day.costCents === null) costKnown = false;
        else cost += day.costCents;

        if (day.valueCents === null) valueKnown = false;
        else value += day.valueCents;
      }
    } else {
      if (costStep === null) costKnown = false;
      else cost += costStep;

      if (valueStep === null) valueKnown = false;
      else value += valueStep;
    }

    return {
      date,
      cumulativeCostCents: costKnown ? Math.round(cost) : null,
      cumulativeValueCents: valueKnown ? Math.round(value) : null,
      isActual,
    };
  });
}
