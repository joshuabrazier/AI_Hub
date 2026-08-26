import { describe, expect, it } from "vitest";

import {
  BILLABLE_NO,
  BILLABLE_YES,
  computeRevenue,
  computeRevenueBy,
  formatCents,
  formatRate,
  resolveRateFor,
  type StaffRateRow,
} from "./revenue";
import type { WorklogFactRow } from "./timesheet.types";

// -------------------------------------------------------------------
// Valuation is where a wrong number costs money rather than credibility, so
// these tests are mostly about the three rules that stop a confident
// understatement:
//
//   - the rate in force ON THE DAY, not today's rate;
//   - no rate means UNVALUED, never free;
//   - COST COVERS EVERY LOGGED HOUR while revenue covers only billable ones,
//     because the business pays for the day either way;
//   - a partial cost base yields NO margin rather than a flattering one.
// -------------------------------------------------------------------

function fact(over: Partial<WorklogFactRow> = {}): WorklogFactRow {
  return {
    worklogId: "w1",
    issueKey: "JOB-1",
    issueSummary: "Work",
    parentKey: "JOB-0",
    parentSummary: "A job",
    projectKey: "PRJ",
    category: "External",
    personId: "p1",
    personName: "Alex",
    workDate: "2026-08-18",
    startSecond: null,
    timeSpentSeconds: 3600,
    billable: BILLABLE_YES,
    billableSource: "issue",
    hasNarrative: true,
    isOrphan: false,
    ...over,
  };
}

// $150/h and $60/h cost, in cents.
const rate = (over: Partial<StaffRateRow> = {}): StaffRateRow => ({
  personId: "p1",
  effectiveFrom: "2026-01-01",
  chargeRateCents: 15_000,
  costRateCents: 6_000,
  ...over,
});

describe("resolveRateFor", () => {
  const rates = [
    rate({ effectiveFrom: "2026-01-01", chargeRateCents: 15_000 }),
    rate({ effectiveFrom: "2026-07-01", chargeRateCents: 18_000 }),
  ];

  it("uses the rate in force on the work date, not the newest one", () => {
    // The whole reason rates have history. If this ever returns 18000 for a
    // June date, every report of an earlier period silently restates itself.
    expect(resolveRateFor(rates, "p1", "2026-06-30")?.chargeRateCents).toBe(15_000);
    expect(resolveRateFor(rates, "p1", "2026-07-01")?.chargeRateCents).toBe(18_000);
    expect(resolveRateFor(rates, "p1", "2026-08-18")?.chargeRateCents).toBe(18_000);
  });

  it("returns null for work before any rate existed", () => {
    // A real state, not an error: a first rate starts somewhere.
    expect(resolveRateFor(rates, "p1", "2025-12-31")).toBeNull();
  });

  it("never returns another person's rate", () => {
    expect(resolveRateFor(rates, "p2", "2026-08-18")).toBeNull();
  });

  it("does not depend on the order rows arrive in", () => {
    const reversed = [...rates].reverse();

    expect(resolveRateFor(reversed, "p1", "2026-08-18")?.chargeRateCents).toBe(18_000);
  });
});

describe("computeRevenue", () => {
  it("values billable hours at the applicable rate", () => {
    const totals = computeRevenue([fact({ timeSpentSeconds: 7200 })], [rate()]);

    // 2h at $150 = $300.
    expect(totals.chargeableValueCents).toBe(30_000);
    expect(totals.billableHours).toBe(2);
  });

  it("does not value non-billable time but DOES cost it", () => {
    // The correction that matters most. An hour of internal work earns
    // nothing and costs $60, because the person is paid for it either way.
    // Costing only billable hours made that hour look free.
    const totals = computeRevenue([fact({ billable: BILLABLE_NO })], [rate()]);

    expect(totals.chargeableValueCents).toBeNull();
    expect(totals.billableHours).toBe(0);
    expect(totals.loggedHours).toBe(1);
    expect(totals.costCents).toBe(6_000);
    expect(totals.nonBillableCostCents).toBe(6_000);
  });

  it("costs UNSET time too, since somebody was still paid for it", () => {
    // Unset is never valued - nobody has said it bills - but the wage was
    // still paid. Leaving it out of cost would be the same mistake again.
    const totals = computeRevenue([fact({ billable: null })], [rate()]);

    expect(totals.chargeableValueCents).toBeNull();
    expect(totals.costCents).toBe(6_000);
    expect(totals.nonBillableCostCents).toBe(6_000);
  });

  it("reports margin as NEGATIVE when a period is mostly unbillable", () => {
    // A day of internal work and one chargeable hour: $150 in, $300 of wages
    // out. A margin floored at zero would hide the only thing worth knowing.
    const facts = [
      fact({ worklogId: "a" }),
      fact({ worklogId: "b", billable: BILLABLE_NO, timeSpentSeconds: 3600 * 4 }),
    ];

    const totals = computeRevenue(facts, [rate()]);

    expect(totals.chargeableValueCents).toBe(15_000);
    expect(totals.costCents).toBe(30_000);
    expect(totals.marginCents).toBe(-15_000);
    expect(totals.marginRatio).toBe(-1);
  });

  it("does not value UNSET time, because nobody has said it bills", () => {
    // The dangerous one. Unset is its own bucket everywhere else in the engine
    // for exactly this reason - folding it into billable would invoice time
    // nobody agreed was chargeable.
    const totals = computeRevenue([fact({ billable: null })], [rate()]);

    expect(totals.chargeableValueCents).toBeNull();
    expect(totals.billableHours).toBe(0);
  });

  it("reports unrated billable hours rather than treating them as free", () => {
    const facts = [
      fact({ worklogId: "a", workDate: "2026-08-18" }),
      // Before the rate starts: real billable work, no rate to value it at.
      fact({ worklogId: "b", workDate: "2025-06-01" }),
    ];

    const totals = computeRevenue(facts, [rate({ effectiveFrom: "2026-01-01" })]);

    expect(totals.billableHours).toBe(2);
    expect(totals.chargeableValueCents).toBe(15_000);
    // The honesty field. Without this the $150 reads as the full picture.
    expect(totals.unratedBillableHours).toBe(1);
    // One of the two hours has no rate, so no cost total is offered.
    expect(totals.costCents).toBeNull();
    expect(totals.uncostedHours).toBe(1);
  });

  it("returns null value, not zero, when nothing could be valued at all", () => {
    const totals = computeRevenue([fact({ workDate: "2020-01-01" })], [rate()]);

    expect(totals.chargeableValueCents).toBeNull();
    expect(totals.unratedBillableHours).toBe(1);
    // No rate at all means it cannot be costed either.
    expect(totals.costCents).toBeNull();
    expect(totals.uncostedHours).toBe(1);
  });

  it("computes margin when every LOGGED hour had a cost rate", () => {
    const totals = computeRevenue([fact({ timeSpentSeconds: 3600 })], [rate()]);

    // One billable hour: $150 charged, $60 cost, $90 margin at 60%.
    expect(totals.costCents).toBe(6_000);
    expect(totals.marginCents).toBe(9_000);
    expect(totals.marginRatio).toBe(0.6);
    expect(totals.nonBillableCostCents).toBe(0);
  });

  it("refuses a margin when the cost base is only partial", () => {
    // A margin computed against half the costs looks twice as good as it is,
    // and it is exactly the number somebody would quote out loud.
    const facts = [fact({ worklogId: "a", personId: "p1" }), fact({ worklogId: "b", personId: "p2" })];
    const rates = [rate({ personId: "p1" }), rate({ personId: "p2", costRateCents: null })];

    const totals = computeRevenue(facts, rates);

    expect(totals.chargeableValueCents).toBe(30_000);
    expect(totals.costCents).toBeNull();
    expect(totals.marginCents).toBeNull();
    expect(totals.marginRatio).toBeNull();
    expect(totals.uncostedHours).toBe(1);
  });

  it("counts an uncosted NON-BILLABLE hour as leaving the cost base partial", () => {
    // Broadened with cost itself. Before, somebody with no cost rate doing
    // only internal work left the cost base looking complete, and margin was
    // reported as though their time were free.
    const facts = [fact({ worklogId: "a", personId: "p1" }), fact({ worklogId: "b", personId: "p2", billable: BILLABLE_NO })];
    const rates = [rate({ personId: "p1" }), rate({ personId: "p2", costRateCents: null })];

    const totals = computeRevenue(facts, rates);

    expect(totals.costCents).toBeNull();
    expect(totals.marginCents).toBeNull();
    expect(totals.uncostedHours).toBe(1);
  });

  it("separates the achieved rate from the diluted effective rate", () => {
    // One billable hour at $150 and one non-billable hour. The team achieved
    // $150 on the work it charged for, but an hour of its time is worth $75.
    // Reporting only the first is how a utilisation problem stays invisible.
    const facts = [fact({ worklogId: "a" }), fact({ worklogId: "b", billable: BILLABLE_NO })];

    const totals = computeRevenue(facts, [rate()]);

    expect(totals.chargeRatePerBillableHourCents).toBe(15_000);
    expect(totals.effectiveRatePerLoggedHourCents).toBe(7_500);

    // And the honest margin on those two hours: $150 earned against $120 of
    // wages. Costing only the billable hour would have said $90 at 60%.
    expect(totals.costCents).toBe(12_000);
    expect(totals.marginCents).toBe(3_000);
    expect(totals.marginRatio).toBe(0.2);
  });

  it("values a part hour without rounding on every row", () => {
    // Twenty minutes at $150 is exactly $50. Three of them are $150, not
    // $149.99 - which is what per-row rounding produces.
    const twenty = () => fact({ timeSpentSeconds: 1200, worklogId: Math.random().toString() });

    expect(computeRevenue([twenty(), twenty(), twenty()], [rate()]).chargeableValueCents).toBe(15_000);
  });

  it("uses each person's own rate rather than a blended one", () => {
    const facts = [fact({ worklogId: "a", personId: "p1" }), fact({ worklogId: "b", personId: "p2" })];
    const rates = [rate({ personId: "p1", chargeRateCents: 15_000 }), rate({ personId: "p2", chargeRateCents: 25_000 })];

    expect(computeRevenue(facts, rates).chargeableValueCents).toBe(40_000);
  });

  it("handles an empty set without inventing figures", () => {
    const totals = computeRevenue([], [rate()]);

    expect(totals.chargeableValueCents).toBeNull();
    expect(totals.effectiveRatePerLoggedHourCents).toBeNull();
    expect(totals.loggedHours).toBe(0);
  });
});

describe("computeRevenueBy", () => {
  const facts = [
    fact({ worklogId: "a", parentKey: "BIG", parentSummary: "Big client", timeSpentSeconds: 7200 }),
    fact({ worklogId: "b", parentKey: "SMALL", parentSummary: "Small client", timeSpentSeconds: 3600 }),
  ];

  const grouped = () =>
    computeRevenueBy(facts, [rate()], (f) => ({ key: f.parentKey ?? "none", label: f.parentSummary ?? "No job" }));

  it("splits value by the key and orders largest first", () => {
    const slices = grouped();

    expect(slices.map((slice) => slice.label)).toEqual(["Big client", "Small client"]);
    expect(slices[0].chargeableValueCents).toBe(30_000);
    expect(slices[1].chargeableValueCents).toBe(15_000);
  });

  it("gives each slice its share of the whole, which is the concentration measure", () => {
    // Two thirds of the book with one client is the sort of thing a leadership
    // pack exists to say out loud.
    const slices = grouped();

    expect(slices[0].valueShare).toBeCloseTo(0.6667, 3);
    expect(slices[1].valueShare).toBeCloseTo(0.3333, 3);
  });

  it("still surfaces a busy group that could not be valued", () => {
    // Sorted on value, an unrated group would otherwise sink below every
    // trivial one that happens to have a rate.
    const unrated = [
      fact({ worklogId: "x", parentKey: "NORATE", parentSummary: "Unrated", personId: "p9", timeSpentSeconds: 36000 }),
      fact({ worklogId: "y", parentKey: "TINY", parentSummary: "Tiny", timeSpentSeconds: 600 }),
    ];

    const slices = computeRevenueBy(unrated, [rate()], (f) => ({
      key: f.parentKey ?? "none",
      label: f.parentSummary ?? "No job",
    }));

    const unratedSlice = slices.find((slice) => slice.label === "Unrated");

    expect(unratedSlice?.chargeableValueCents).toBeNull();
    expect(unratedSlice?.unratedBillableHours).toBe(10);
  });
});

describe("formatting", () => {
  it("formats whole units by default", () => {
    // A leadership pack reads faster without cents at this scale.
    expect(formatCents(1_248_000)).toBe("$12,480");
  });

  it("shows cents when asked", () => {
    expect(formatCents(15_050, 2)).toBe("$150.50");
  });

  it("renders an unknown amount as a dash, never as zero", () => {
    expect(formatCents(null)).toBe("-");
    expect(formatRate(null)).toBe("-");
  });

  it("marks a rate with its unit", () => {
    expect(formatRate(15_000)).toBe("$150/h");
  });
});
