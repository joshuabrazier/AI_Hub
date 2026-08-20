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
// 3. MONEY IS INTEGER CENTS throughout. See migration 007: node-postgres
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
  // What it cost, where a cost rate exists. Null when no cost rate applied.
  costCents: number | null;
  // value - cost. Null unless both sides are known: a margin computed against
  // a partial cost base is worse than no margin.
  marginCents: number | null;
  // margin / value, 0-1. Null on the same condition.
  marginRatio: number | null;

  // Value per BILLABLE hour: the average rate actually achieved.
  chargeRatePerBillableHourCents: number | null;
  // Value per LOGGED hour - the diluted figure, and the one that answers "what
  // is an hour of this team's time actually worth to us". Non-billable time
  // drags it down, which is the point of looking at it.
  effectiveRatePerLoggedHourCents: number | null;

  // Billable hours no rate could be found for. The honesty field: if this is
  // non-zero the value above is an understatement, and the UI must say so.
  unratedBillableHours: number;
  // Billable hours whose rate had no cost side, so cost and margin are
  // partial. Same reasoning.
  uncostedBillableHours: number;
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// -------------------------------------------------------------------
// Value a set of worklogs.
//
// Only BILLABLE rows are valued. Non-billable and unset time is real work and
// it is counted in the hours, but it is not revenue - and unset in particular
// must never be valued, because "nobody has said whether this bills" is not
// "this bills".
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
  let valuedAny = false;
  let costedAny = false;

  for (const fact of facts) {
    loggedSeconds += fact.timeSpentSeconds;

    if (fact.billable !== BILLABLE_YES) continue;

    billableSeconds += fact.timeSpentSeconds;

    const rate = resolveRateFor(rates, fact.personId, fact.workDate);

    if (rate === null) {
      unratedSeconds += fact.timeSpentSeconds;
      continue;
    }

    valuedAny = true;
    valueCentSeconds += rate.chargeRateCents * fact.timeSpentSeconds;

    if (rate.costRateCents === null) {
      uncostedSeconds += fact.timeSpentSeconds;
      continue;
    }

    costedAny = true;
    costCentSeconds += rate.costRateCents * fact.timeSpentSeconds;
  }

  const loggedHours = round(loggedSeconds / SECONDS_PER_HOUR, 2);
  const billableHours = round(billableSeconds / SECONDS_PER_HOUR, 2);

  const chargeableValueCents = valuedAny ? Math.round(valueCentSeconds / SECONDS_PER_HOUR) : null;

  // Cost is only reported when EVERY valued hour had a cost rate. A cost base
  // covering half the hours makes margin look twice as good as it is, and a
  // partially-costed margin is the number somebody would quote in a board
  // meeting.
  const costComplete = costedAny && uncostedSeconds === 0;
  const costCents = costComplete ? Math.round(costCentSeconds / SECONDS_PER_HOUR) : null;

  const marginCents =
    chargeableValueCents !== null && costCents !== null ? chargeableValueCents - costCents : null;

  return {
    loggedHours,
    billableHours,
    chargeableValueCents,
    costCents,
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
    uncostedBillableHours: round(uncostedSeconds / SECONDS_PER_HOUR, 2),
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
