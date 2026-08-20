import type { WorklogFactRow } from "./timesheet.types";

// -------------------------------------------------------------------
// Valuing time.
//
// Pure, like the rest of the engine: rows and rates in, money out. No clock,
// no I/O, no model.
//
// THREE RULES, and every one of them exists because breaking it produces a
// confident wrong number rather than an obvious failure.
//
// 1. A WORKLOG IS VALUED AT THE RATE IN FORCE ON THE DAY IT WAS WORKED, not
//    the rate today. Otherwise a pay review in July restates what May was
//    worth, and last quarter's report stops matching itself.
//
// 2. NO RATE MEANS UNVALUED, NEVER FREE. Hours with no applicable rate are
//    counted and reported separately (`unratedBillableHours`). Treating them
//    as zero would understate revenue with nothing on screen to say so, which
//    is the worst kind of wrong.
//
// 3. COST APPLIES TO EVERY LOGGED HOUR, revenue only to billable ones. The
//    business pays for the day whether or not it was chargeable, so
//    non-billable time is cost with no income against it - which is the
//    number an executive is looking for. Costing only billable hours makes
//    internal work look free and overstates margin by what is being absorbed.
//
// 4. MONEY IS INTEGER CENTS throughout. See migration 007: node-postgres
//    returns NUMERIC as a string, and a float pound is a rounding error
//    waiting to be summed a thousand times.
// -------------------------------------------------------------------

// The one currency the reporting is in. A constant rather than an env var
// because multi-currency is a real feature, not a config flag: it would need a
// currency on the rate, on the job, and a conversion policy with dated rates.
// Anything less would silently add dollars to pounds.
export const REPORTING_CURRENCY = "AUD";

const SECONDS_PER_HOUR = 3600;
const CENTS_PER_UNIT = 100;

// Jira's own words for the billable flag. Compared as literals in three places
// in overview-series.ts; named here because a valuation that silently treats
// "Billable " as non-billable is a revenue bug rather than a display one.
export const BILLABLE_YES = "Billable";
export const BILLABLE_NO = "Non-billable";

export interface StaffRateRow {
  personId: string;
  // 'YYYY-MM-DD'. A DATE from the database, so a string - compared
  // lexicographically, which is safe and correct for this format and needs no
  // timezone reasoning at all.
  effectiveFrom: string;
  chargeRateCents: number;
  costRateCents: number | null;
}

// -------------------------------------------------------------------
// The rate in force for a person on a date.
//
// The latest row whose effectiveFrom is on or before the work date. Returns
// null when the person has no rate at all, or none yet at that date - which is
// a real state, not an error: somebody's first rate starts somewhere, and work
// logged before it is genuinely unvalued.
//
// Lexicographic comparison on 'YYYY-MM-DD' is deliberate. Parsing these into
// Date objects to compare them is how a date-only value picks up a timezone it
// never had and lands on the wrong side of a month boundary.
// -------------------------------------------------------------------
export function resolveRateFor(
  rates: StaffRateRow[],
  personId: string,
  workDate: string,
): StaffRateRow | null {
  let best: StaffRateRow | null = null;

  for (const rate of rates) {
    if (rate.personId !== personId) continue;
    if (rate.effectiveFrom > workDate) continue;
    if (best === null || rate.effectiveFrom > best.effectiveFrom) best = rate;
  }

  return best;
}

export interface RevenueTotals {
  // Hours, for context. Copied from the caller's own sum rather than
  // recomputed, so this can never disagree with the hours on screen.
  loggedHours: number;
  billableHours: number;

  // What the billable time is worth at the rates in force. Null when NOTHING
  // could be valued - distinct from 0, which means valued at nought.
  chargeableValueCents: number | null;
  // What the time COST, across EVERY logged hour - billable or not.
  //
  // This is the whole point of the field and it was wrong once: an employer
  // pays for the day whether or not the day was chargeable. Costing only
  // billable hours makes internal work, admin, rework and bench time look
  // free, which flatters margin by exactly the amount the business is
  // actually absorbing.
  //
  // Null when the cost base is incomplete - see the note in computeRevenue.
  costCents: number | null;
  // The part of that cost with no revenue against it: what the business wore.
  // Its own figure because "we absorbed $2,800 of internal time" is the
  // sentence somebody acts on, and it is invisible inside a total.
  nonBillableCostCents: number | null;
  // value - cost, across all logged hours. CAN BE NEGATIVE, and that is not a
  // bug: a period of mostly internal work loses money, and a margin that
  // could not go below zero would be hiding the thing worth knowing.
  marginCents: number | null;
  // margin / value. Null unless both sides are known.
  marginRatio: number | null;

  // Value per BILLABLE hour: the average rate actually achieved.
  chargeRatePerBillableHourCents: number | null;
  // Value per LOGGED hour - the diluted figure, and the one that answers "what
  // is an hour of this team's time actually worth to us". Non-billable time
  // drags it down, which is the point of looking at it.
  effectiveRatePerLoggedHourCents: number | null;

  // Billable hours no charge rate could be found for. The honesty field: if
  // this is non-zero the value above is an understatement, and the UI says so.
  unratedBillableHours: number;
  // LOGGED hours - billable or not - whose person had no cost rate on the day.
  // Broadened along with cost itself: an uncosted non-billable hour leaves the
  // cost base just as incomplete as an uncosted billable one.
  uncostedHours: number;
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// -------------------------------------------------------------------
// Value a set of worklogs.
//
// TWO DIFFERENT RULES, and keeping them apart is the whole of it:
//
//   REVENUE counts only BILLABLE rows. Non-billable time is real work but it
//   is not income, and UNSET time must never be valued because "nobody has
//   said whether this bills" is not "this bills".
//
//   COST counts EVERY logged row. The business pays for the hour whether or
//   not it was chargeable, so internal work, admin, rework and unset time all
//   cost exactly what they cost. This is the half that was wrong first time
//   round: costing only billable hours makes non-billable time look free and
//   overstates margin by precisely the amount the business is absorbing.
// -------------------------------------------------------------------
export function computeRevenue(facts: WorklogFactRow[], rates: StaffRateRow[]): RevenueTotals {
  let loggedSeconds = 0;
  let billableSeconds = 0;
  let unratedSeconds = 0;
  let uncostedSeconds = 0;

  // Accumulated in cent-seconds and divided once at the end, so a 20-minute
  // entry at an odd rate does not round on every row.
  let valueCentSeconds = 0;
  let costCentSeconds = 0;
  let nonBillableCostCentSeconds = 0;
  let valuedAny = false;
  let costedAny = false;

  for (const fact of facts) {
    loggedSeconds += fact.timeSpentSeconds;

    const isBillable = fact.billable === BILLABLE_YES;
    if (isBillable) billableSeconds += fact.timeSpentSeconds;

    const rate = resolveRateFor(rates, fact.personId, fact.workDate);

    if (rate === null) {
      // No rate at all: it can be neither valued nor costed. Only the
      // billable share is called out as unvalued, because that is the figure
      // an understated revenue number belongs to.
      if (isBillable) unratedSeconds += fact.timeSpentSeconds;
      uncostedSeconds += fact.timeSpentSeconds;
      continue;
    }

    if (isBillable) {
      valuedAny = true;
      valueCentSeconds += rate.chargeRateCents * fact.timeSpentSeconds;
    }

    // COST APPLIES REGARDLESS of the billable flag - the point of the fix.
    if (rate.costRateCents === null) {
      uncostedSeconds += fact.timeSpentSeconds;
      continue;
    }

    costedAny = true;
    costCentSeconds += rate.costRateCents * fact.timeSpentSeconds;

    if (!isBillable) nonBillableCostCentSeconds += rate.costRateCents * fact.timeSpentSeconds;
  }

  const loggedHours = round(loggedSeconds / SECONDS_PER_HOUR, 2);
  const billableHours = round(billableSeconds / SECONDS_PER_HOUR, 2);

  const chargeableValueCents = valuedAny ? Math.round(valueCentSeconds / SECONDS_PER_HOUR) : null;

  // Cost is reported only when EVERY LOGGED hour had a cost rate. A cost base
  // covering some of the hours makes margin look better than it is, and a
  // partially-costed margin is exactly the number somebody quotes in a board
  // meeting. One person without a cost rate withholds the figure for everyone,
  // which is blunt but honest - and `uncostedHours` says how much is missing so
  // it is fixable rather than mysterious.
  const costComplete = costedAny && uncostedSeconds === 0;
  const costCents = costComplete ? Math.round(costCentSeconds / SECONDS_PER_HOUR) : null;

  const marginCents =
    chargeableValueCents !== null && costCents !== null ? chargeableValueCents - costCents : null;

  return {
    loggedHours,
    billableHours,
    chargeableValueCents,
    costCents,
    nonBillableCostCents: costComplete
      ? Math.round(nonBillableCostCentSeconds / SECONDS_PER_HOUR)
      : null,
    marginCents,
    marginRatio:
      marginCents !== null && chargeableValueCents !== null && chargeableValueCents > 0
        ? round(marginCents / chargeableValueCents)
        : null,
    chargeRatePerBillableHourCents:
      chargeableValueCents !== null && billableSeconds > 0
        ? Math.round(chargeableValueCents / (billableSeconds / SECONDS_PER_HOUR))
        : null,
    effectiveRatePerLoggedHourCents:
      chargeableValueCents !== null && loggedSeconds > 0
        ? Math.round(chargeableValueCents / (loggedSeconds / SECONDS_PER_HOUR))
        : null,
    unratedBillableHours: round(unratedSeconds / SECONDS_PER_HOUR, 2),
    uncostedHours: round(uncostedSeconds / SECONDS_PER_HOUR, 2),
  };
}

// -------------------------------------------------------------------
// The same valuation, split by something.
//
// One generic grouper rather than three near-identical ones, because the only
// thing that differs between "by person", "by job" and "by category" is the
// key function - and three copies of this loop is three places for the
// billable check to drift.
// -------------------------------------------------------------------
export interface RevenueSlice extends RevenueTotals {
  key: string;
  label: string;
  // Share of the whole set's chargeable value, 0-1. Null when nothing in the
  // set could be valued. This is the concentration measure: one client at 0.6
  // is a risk somebody should have named out loud.
  valueShare: number | null;
}

export function computeRevenueBy(
  facts: WorklogFactRow[],
  rates: StaffRateRow[],
  keyOf: (fact: WorklogFactRow) => { key: string; label: string },
): RevenueSlice[] {
  const groups = new Map<string, { label: string; facts: WorklogFactRow[] }>();

  for (const fact of facts) {
    const { key, label } = keyOf(fact);
    const existing = groups.get(key);

    if (existing) existing.facts.push(fact);
    else groups.set(key, { label, facts: [fact] });
  }

  const total = computeRevenue(facts, rates).chargeableValueCents;

  return [...groups.entries()]
    .map(([key, group]) => {
      const totals = computeRevenue(group.facts, rates);

      return {
        key,
        label: group.label,
        ...totals,
        valueShare:
          total !== null && total > 0 && totals.chargeableValueCents !== null
            ? round(totals.chargeableValueCents / total)
            : null,
      };
    })
    // Largest value first, then largest hours, so an unvalued-but-busy group
    // still surfaces rather than sinking below everything with a rate.
    .sort((a, b) => (b.chargeableValueCents ?? 0) - (a.chargeableValueCents ?? 0) || b.loggedHours - a.loggedHours);
}

// -------------------------------------------------------------------
// Display. Cents to a readable string, in the reporting currency.
//
// Whole units by default: a leadership pack showing $12,480 rather than
// $12,480.00 reads faster, and the cents are noise at that scale. Anything
// that genuinely needs them can pass places.
// -------------------------------------------------------------------
export function formatCents(cents: number | null, places = 0): string {
  if (cents === null) return "-";

  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: REPORTING_CURRENCY,
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  }).format(cents / CENTS_PER_UNIT);
}

// A rate reads better with its unit than as a bare amount.
export function formatRate(cents: number | null): string {
  return cents === null ? "-" : `${formatCents(cents)}/h`;
}

// -------------------------------------------------------------------
// Cost and value day by day, for a burn-up.
//
// Keyed on the worklog's own date and summed there, so a chart can show the
// shape of a period rather than only its total. Same two rules as the totals:
// every logged hour costs, only billable hours earn.
//
// Returns only the days that HAVE rows. A chart wanting a point per weekday
// fills the gaps itself, because only the caller knows which days it means to
// draw - the period's weekdays, or the days somebody actually worked.
// -------------------------------------------------------------------
export interface DailyMoney {
  // 'YYYY-MM-DD'.
  date: string;
  hours: number;
  costCents: number | null;
  valueCents: number | null;
}

export function buildDailyMoney(facts: WorklogFactRow[], rates: StaffRateRow[]): DailyMoney[] {
  const byDate = new Map<string, WorklogFactRow[]>();

  for (const fact of facts) {
    const existing = byDate.get(fact.workDate);
    if (existing) existing.push(fact);
    else byDate.set(fact.workDate, [fact]);
  }

  return [...byDate.entries()]
    .map(([date, dayFacts]) => {
      const totals = computeRevenue(dayFacts, rates);

      return {
        date,
        hours: totals.loggedHours,
        costCents: totals.costCents,
        valueCents: totals.chargeableValueCents,
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
