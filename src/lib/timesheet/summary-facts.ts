import { createHash } from "node:crypto";

// -------------------------------------------------------------------
// The facts a summary is written FROM, and the two hashes that decide
// whether it has to be written again.
//
// Pure: numbers in, numbers and strings out. No clock, no I/O, no model. That
// is what makes it testable, and it is testable because the whole feature
// rests on one rule.
//
// THE RULE: THE MODEL NEVER COMPUTES A NUMBER.
//
// Every figure here has already been derived by the timesheet engine -
// capacityHoursForPeriod, measureAgainstTarget, the aggregate pass - all of
// which are pure and unit-tested. The model is handed the finished figures
// and asked for sentences about them.
//
// This is not a stylistic preference. Utilisation is logged hours over a
// capacity prorated by contracted days, and a model asked to work that out
// from parts will sometimes divide by five days for somebody on three. The
// dashboard exists to answer exactly that question, so a plausible wrong
// number in the prose next to the right number in the tile discredits both.
// Passing the arithmetic in removes the opportunity rather than trusting the
// model not to take it.
// -------------------------------------------------------------------

// Rounded before hashing as well as before display. Floating point noise in
// the fourteenth decimal place would otherwise make a fingerprint differ from
// one run to the next and regenerate a summary that had not changed.
function fixed(value: number | null | undefined, places = 2): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number(value.toFixed(places));
}

function percent(ratio: number | null | undefined): number | null {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return null;
  return Math.round(ratio * 100);
}

export interface SummaryPersonFacts {
  name: string;
  loggedHours: number | null;
  capacityHours: number | null;
  utilisationPercent: number | null;
  billableHours: number | null;
  billableSharePercent: number | null;
  billableTargetPercent: number | null;
  // Percentage points against target. Positive is ahead.
  billableVariancePoints: number | null;
  daysWorked: number | null;
  contractedDaysPerWeek: number | null;
  hoursPerDay: number | null;
  // True when no target row exists and the company default is standing in.
  // Carried through so the prose can say "assumed" rather than asserting an
  // arrangement nobody agreed to.
  usingCompanyDefault: boolean;
}

export interface SummaryFacts {
  scope: "overview" | "staff";
  periodLabel: string;
  granularity: string;
  weekdaysInPeriod: number | null;
  filters: { category: string; project: string; person: string };
  totals: {
    loggedHours: number | null;
    capacityHours: number | null;
    utilisationPercent: number | null;
    billableHours: number | null;
    nonBillableHours: number | null;
    billableSharePercent: number | null;
    peopleCount: number | null;
    worklogCount: number | null;
  };
  people: SummaryPersonFacts[];
  // Top jobs and category split, present on the overview only.
  // Each category's billable split as well as its size, so the prose can say
  // that client work is mostly billable and internal work is not, rather than
  // only how big each one is.
  categories: {
    label: string;
    hours: number | null;
    sharePercent: number | null;
    billableHours: number | null;
    nonBillableHours: number | null;
    unsetHours: number | null;
  }[];
  topJobs: { label: string; hours: number | null }[];
  readiness: { readyHours: number | null; undescribedBillableHours: number | null } | null;
}

// -------------------------------------------------------------------
// Stable JSON: keys in a fixed order, so two structurally identical fact sets
// hash the same. JSON.stringify preserves insertion order, and insertion
// order here comes from object literals rather than from a database row, so
// this holds without a sort - but the fingerprint is the thing that decides
// whether a paid call happens, so it is worth being explicit about why.
// -------------------------------------------------------------------
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner) => {
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const record = inner as Record<string, unknown>;
      return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((sorted, key) => {
          sorted[key] = record[key];
          return sorted;
        }, {});
    }
    return inner;
  });
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// -------------------------------------------------------------------
// What a cached row is a cache OF: the screen and the filters, never the
// figures. Two different weeks are two rows; the same week re-synced is the
// same row with a new fingerprint.
// -------------------------------------------------------------------
export function summaryCacheKey(input: {
  scope: string;
  granularity: string;
  start: string;
  category: string;
  project: string;
  person: string;
}): string {
  return sha256(
    stableJson({
      scope: input.scope,
      granularity: input.granularity,
      start: input.start,
      category: input.category,
      project: input.project,
      person: input.person,
    }),
  );
}

// -------------------------------------------------------------------
// Whether the FIGURES have moved.
//
// An explicit allowlist, not the whole object, and the distinction is the
// difference between a working cache and an expensive one. `periodLabel` is
// presentation: hashing it would mean a copy change to how a week is written
// invalidated every cached summary in the database at once, at one Opus call
// each to restore.
//
// `scope`, `granularity` and `filters` are left out for a different reason -
// they are already in the cache key, so they cannot differ between two rows
// being compared. Hashing them would not be wrong, just noise that reads as
// though it were doing something.
//
// `weekdaysInPeriod` IS included: it is the denominator every capacity is
// prorated from, so it is a figure, not a label.
// -------------------------------------------------------------------
export function summaryFingerprint(facts: SummaryFacts): string {
  return sha256(
    stableJson({
      weekdaysInPeriod: facts.weekdaysInPeriod,
      totals: facts.totals,
      people: facts.people,
      categories: facts.categories,
      topJobs: facts.topJobs,
      readiness: facts.readiness,
    }),
  );
}

export { fixed as roundHours, percent as toPercent };
