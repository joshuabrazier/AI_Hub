import { describe, expect, it } from "vitest";

import { roundHours, summaryCacheKey, summaryFingerprint, toPercent, type SummaryFacts } from "./summary-facts";

// -------------------------------------------------------------------
// The cache key and the fingerprint decide whether a paid call happens, so
// they are worth pinning down. Two failure modes matter and neither is
// visible by inspection:
//
//   - a key that varies when it should not means the cache never hits, and
//     the only symptom is a Bedrock bill;
//   - a fingerprint that does NOT vary when the figures move means confident
//     prose describing numbers that have since changed.
// -------------------------------------------------------------------

function facts(overrides: Partial<SummaryFacts> = {}): SummaryFacts {
  return {
    scope: "staff",
    periodLabel: "17-23 Aug 2026",
    granularity: "week",
    weekdaysInPeriod: 5,
    filters: { category: "all", project: "all", person: "all" },
    totals: {
      loggedHours: 14.5,
      capacityHours: 22.5,
      utilisationPercent: 64,
      billableHours: 8,
      nonBillableHours: 6.5,
      billableSharePercent: 55,
      peopleCount: 3,
      worklogCount: 51,
    },
    people: [],
    subject: null,
    days: [],
    jobs: [],
    categories: [],
    topJobs: [],
    readiness: null,
    ...overrides,
  };
}

describe("summaryCacheKey", () => {
  const base = { scope: "staff", granularity: "week", start: "2026-08-17", category: "all", project: "all", person: "all" };

  it("is stable for the same filters", () => {
    expect(summaryCacheKey(base)).toBe(summaryCacheKey({ ...base }));
  });

  it("does not depend on the order the filters were assembled in", () => {
    // The service spreads a DTO into this, and property order in a spread
    // follows the source object. If the key depended on it, a refactor that
    // reordered TimesheetFiltersDTO would silently invalidate every cached row.
    const reordered = { person: "all", project: "all", category: "all", start: "2026-08-17", granularity: "week", scope: "staff" };
    expect(summaryCacheKey(reordered)).toBe(summaryCacheKey(base));
  });

  it("separates the two scopes so one screen never serves the other's prose", () => {
    expect(summaryCacheKey({ ...base, scope: "overview" })).not.toBe(summaryCacheKey(base));
  });

  it.each([
    ["granularity", { granularity: "month" }],
    ["start", { start: "2026-08-24" }],
    ["category", { category: "External" }],
    ["project", { project: "TSSS" }],
    ["person", { person: "712020:abc" }],
  ])("changes when %s changes", (_label, patch) => {
    expect(summaryCacheKey({ ...base, ...patch })).not.toBe(summaryCacheKey(base));
  });
});

describe("summaryFingerprint", () => {
  it("is stable for identical figures", () => {
    expect(summaryFingerprint(facts())).toBe(summaryFingerprint(facts()));
  });

  it("changes when a total moves", () => {
    const moved = facts();
    moved.totals.loggedHours = 15;

    expect(summaryFingerprint(moved)).not.toBe(summaryFingerprint(facts()));
  });

  it("changes when capacity moves, which is what setting a staff target does", () => {
    // The 37.50h to 22.50h case: same logged hours, different denominator.
    // A fingerprint that missed this would leave prose calling somebody
    // underutilised after their part-time target was recorded.
    const retargeted = facts();
    retargeted.totals.capacityHours = 37.5;
    retargeted.totals.utilisationPercent = 39;

    expect(summaryFingerprint(retargeted)).not.toBe(summaryFingerprint(facts()));
  });

  it("changes when a person's figures move, not just the totals", () => {
    const withPerson = facts({
      people: [
        {
          name: "A",
          loggedHours: 14.5,
          capacityHours: 22.5,
          utilisationPercent: 64,
          billableHours: 8,
          billableSharePercent: 55,
          billableTargetPercent: null,
          billableVariancePoints: null,
          daysWorked: 2,
          contractedDaysPerWeek: 3,
          hoursPerDay: 7.5,
          usingCompanyDefault: false,
        },
      ],
    });

    const shifted = structuredClone(withPerson);
    shifted.people[0].utilisationPercent = 70;

    expect(summaryFingerprint(shifted)).not.toBe(summaryFingerprint(withPerson));
  });

  it("does not change when only the period LABEL differs", () => {
    // The label is presentation. If it fed the fingerprint, a copy change
    // would invalidate every cached summary in the database at once.
    expect(summaryFingerprint(facts({ periodLabel: "Week of 17 August" }))).toBe(
      summaryFingerprint(facts({ periodLabel: "17-23 Aug 2026" })),
    );
  });
});

describe("rounding", () => {
  it("rounds hours to two places so float noise cannot invalidate a summary", () => {
    // 0.1 + 0.2 is 0.30000000000000004. Hashing that raw would produce a
    // different fingerprint on a run that computed the same hours a different
    // way, and regenerate a summary that had not changed.
    expect(roundHours(0.1 + 0.2)).toBe(0.3);
  });

  it("keeps null as null rather than collapsing it to zero", () => {
    // Null means unknown - no capacity to measure, or nothing logged. Zero
    // means measured and none. The prompt tells the model to treat them
    // differently, which only works if they arrive different.
    expect(roundHours(null)).toBeNull();
    expect(toPercent(null)).toBeNull();
  });

  it("does not turn a non-finite number into a figure", () => {
    // Utilisation is logged over capacity, and a capacity of zero would make
    // that Infinity. The engine returns null for it, but a division slipping
    // through must not print as a percentage.
    expect(roundHours(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toPercent(Number.NaN)).toBeNull();
  });

  it("converts a ratio to whole percentage points", () => {
    expect(toPercent(0.6444)).toBe(64);
    expect(toPercent(1)).toBe(100);
  });
});
