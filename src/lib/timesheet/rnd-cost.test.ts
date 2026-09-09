import { describe, expect, it } from "vitest";

import { computeRevenue, type StaffRateRow } from "./revenue";
import type { WorklogFactRow } from "./timesheet.types";

// -------------------------------------------------------------------
// The cost of R&D time.
//
// An R&D Tax Incentive claim is made in DOLLARS; the hours are the working.
// So the R&D screen splits cost the same way it splits hours, by filtering
// the fact rows and reusing computeRevenue - which means it inherits that
// function's rate resolution and, far more importantly, its rule about when
// a cost may not be reported at all.
//
// THAT RULE IS THE ONE WORTH TESTING HERE. A partially costed total is the
// dangerous number: it looks complete, it is quotable, and it understates
// by exactly the hours nobody priced. Of the two ways to be wrong, only the
// overstated one gets questioned.
// -------------------------------------------------------------------

function fact(overrides: Partial<WorklogFactRow> = {}): WorklogFactRow {
  return {
    worklogId: "w1",
    issueKey: "RDP-1",
    issueSummary: "An item",
    parentKey: null,
    parentSummary: null,
    projectKey: "RDP",
    category: "Internal",
    personId: "ada",
    personName: "Ada",
    workDate: "2026-07-15",
    startSecond: null,
    timeSpentSeconds: 3600,
    billable: null,
    billableSource: "unset",
    hasNarrative: true,
    rndClass: null,
    isOrphan: false,
    ...overrides,
  };
}

// Ada is priced at $90/hour cost. Ben is deliberately not priced at all.
const RATES: StaffRateRow[] = [
  { personId: "ada", effectiveFrom: "2020-01-01", chargeRateCents: 25_000, costRateCents: 9_000 },
  { personId: "ben", effectiveFrom: "2020-01-01", chargeRateCents: 25_000, costRateCents: null },
];

const coreOf = (facts: WorklogFactRow[]) => facts.filter((f) => f.rndClass === "core");
const supportingOf = (facts: WorklogFactRow[]) => facts.filter((f) => f.rndClass === "supporting");
const rndOf = (facts: WorklogFactRow[]) => facts.filter((f) => f.rndClass !== null);

describe("R&D cost", () => {
  it("costs core and supporting separately", () => {
    const facts = [
      fact({ worklogId: "a", rndClass: "core", timeSpentSeconds: 7200 }),
      fact({ worklogId: "b", rndClass: "supporting", timeSpentSeconds: 3600 }),
    ];

    // Two hours at $90 and one hour at $90, worked out by hand.
    expect(computeRevenue(coreOf(facts), RATES).costCents).toBe(18_000);
    expect(computeRevenue(supportingOf(facts), RATES).costCents).toBe(9_000);
    expect(computeRevenue(rndOf(facts), RATES).costCents).toBe(27_000);
  });

  it("costs an hour whether or not it was billable", () => {
    // An employer pays for the day regardless. Costing only billable hours
    // would make internal R&D look free, which is the opposite of the truth
    // for a claim built almost entirely on internal work.
    const facts = [
      fact({ worklogId: "a", rndClass: "core", billable: "Non-billable", timeSpentSeconds: 3600 }),
    ];

    expect(computeRevenue(coreOf(facts), RATES).costCents).toBe(9_000);
  });

  it("REFUSES a total when any hour in the set is unpriced", () => {
    // The safety property. Ada is priced, Ben is not, so the honest answer
    // for the pair is "not available" - not Ada's $90 presented as the whole
    // cost of two hours' work.
    const facts = [
      fact({ worklogId: "a", personId: "ada", rndClass: "core", timeSpentSeconds: 3600 }),
      fact({ worklogId: "b", personId: "ben", rndClass: "core", timeSpentSeconds: 3600 }),
    ];

    const money = computeRevenue(coreOf(facts), RATES);

    expect(money.costCents).toBeNull();
    // And it says how much is missing, so the null is fixable rather than
    // mysterious: the remedy is a cost rate, not anything on the R&D page.
    expect(money.uncostedHours).toBe(1);
  });

  it("withholds one bucket without withholding the other", () => {
    // A gap in supporting must not blank core. Otherwise one unpriced
    // person hides the entire claim rather than the part they touched.
    const facts = [
      fact({ worklogId: "a", personId: "ada", rndClass: "core", timeSpentSeconds: 3600 }),
      fact({ worklogId: "b", personId: "ben", rndClass: "supporting", timeSpentSeconds: 3600 }),
    ];

    expect(computeRevenue(coreOf(facts), RATES).costCents).toBe(9_000);
    expect(computeRevenue(supportingOf(facts), RATES).costCents).toBeNull();
    // The combined figure is withheld too, which is correct: it genuinely
    // is not known.
    expect(computeRevenue(rndOf(facts), RATES).costCents).toBeNull();
  });

  it("ignores non-R&D hours when costing the claim", () => {
    // The point of filtering. Ordinary client work must not reach a figure
    // presented as R&D expenditure.
    const facts = [
      fact({ worklogId: "a", rndClass: "core", timeSpentSeconds: 3600 }),
      fact({ worklogId: "b", rndClass: null, timeSpentSeconds: 36_000 }),
    ];

    expect(computeRevenue(rndOf(facts), RATES).costCents).toBe(9_000);
  });

  it("uses the rate in force on the day the work was done", () => {
    // Effective-dated, so a pay rise in August does not retrospectively
    // reprice July - which for a claim spanning a year is the difference
    // between a defensible figure and a wrong one.
    const rates: StaffRateRow[] = [
      { personId: "ada", effectiveFrom: "2026-01-01", chargeRateCents: 25_000, costRateCents: 9_000 },
      { personId: "ada", effectiveFrom: "2026-08-01", chargeRateCents: 30_000, costRateCents: 11_000 },
    ];

    const july = [fact({ rndClass: "core", workDate: "2026-07-31", timeSpentSeconds: 3600 })];
    const august = [fact({ rndClass: "core", workDate: "2026-08-01", timeSpentSeconds: 3600 })];

    expect(computeRevenue(coreOf(july), rates).costCents).toBe(9_000);
    expect(computeRevenue(coreOf(august), rates).costCents).toBe(11_000);
  });
});
