import { describe, expect, it } from "vitest";

import {
  buildBurnUp,
  forecastFromPace,
  forecastRemainingCost,
  MIN_ELAPSED_FOR_PACE,
  periodProgress,
  weekdaysBetween,
} from "./forecast";
import type { StaffCapacity } from "./staff-capacity";
import type { StaffRateRow } from "./revenue";

// -------------------------------------------------------------------
// A forecast is the one figure on these screens that is not a measurement, so
// these tests are mostly about keeping it honest:
//
//   - committed cost is CAPACITY x the rate on each remaining day, not a
//     guess, and not today's rate multiplied out;
//   - pace extrapolation REFUSES to answer early in a period rather than
//     multiplying one day by twenty-one;
//   - a partial remainder yields no total, the same rule as margin;
//   - the assumptions it cannot verify are on the result, not in a comment.
//
// 2026-08-17 is a Monday, so 17-21 Aug are weekdays and 22-23 are the weekend.
// -------------------------------------------------------------------

const capacity = (over: Partial<StaffCapacity> = {}): StaffCapacity => ({
  personId: "p1",
  workingWeekdays: null,
  workingDaysPerWeek: 5,
  hoursPerDay: 7.5,
  weeklyHours: 37.5,
  billableTargetPercent: null,
  isDefault: false,
  ...over,
});

const rate = (over: Partial<StaffRateRow> = {}): StaffRateRow => ({
  personId: "p1",
  effectiveFrom: "2026-01-01",
  chargeRateCents: 20_000,
  costRateCents: 10_000,
  ...over,
});

describe("weekdaysBetween", () => {
  it("counts Monday to Friday and skips the weekend", () => {
    expect(weekdaysBetween("2026-08-17", "2026-08-23")).toEqual([
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
    ]);
  });

  it("returns nothing for a reversed range rather than looping", () => {
    expect(weekdaysBetween("2026-08-23", "2026-08-17")).toEqual([]);
  });
});

describe("periodProgress", () => {
  it("counts today as elapsed, because today's work is in progress", () => {
    // Thursday of a Mon-Sun week: Mon, Tue, Wed, Thu are done or doing.
    const p = periodProgress("2026-08-17", "2026-08-23", "2026-08-20");

    expect(p.weekdaysInPeriod).toBe(5);
    expect(p.weekdaysElapsed).toBe(4);
    expect(p.weekdaysRemaining).toBe(1);
    expect(p.elapsedRatio).toBeCloseTo(0.8, 5);
    expect(p.isComplete).toBe(false);
    expect(p.isFuture).toBe(false);
  });

  it("treats a finished period as all actual and nothing to forecast", () => {
    const p = periodProgress("2026-08-10", "2026-08-16", "2026-08-20");

    expect(p.isComplete).toBe(true);
    expect(p.weekdaysRemaining).toBe(0);
    expect(p.elapsedRatio).toBe(1);
  });

  it("treats a future period as all forecast and nothing actual", () => {
    const p = periodProgress("2026-08-24", "2026-08-30", "2026-08-20");

    expect(p.isFuture).toBe(true);
    expect(p.weekdaysElapsed).toBe(0);
    expect(p.weekdaysRemaining).toBe(5);
  });

  it("does not divide by zero for a period with no weekdays in it", () => {
    // A weekend-only range. Contrived, but a null ratio is the right answer
    // and a NaN one would render as a percentage.
    const p = periodProgress("2026-08-22", "2026-08-23", "2026-08-22");

    expect(p.weekdaysInPeriod).toBe(0);
    expect(p.elapsedRatio).toBeNull();
  });
});

describe("forecastRemainingCost", () => {
  it("costs the remaining contracted days at their own rate", () => {
    // Thursday: one weekday left (Friday) at 7.5h and $100/h = $750.
    const forecast = forecastRemainingCost({
      from: "2026-08-17",
      to: "2026-08-23",
      today: "2026-08-20",
      capacity: capacity(),
      daysAlreadyWorked: 0,
      personId: "p1",
      rates: [rate()],
    });

    expect(forecast.committedRemainingHours).toBe(7.5);
    expect(forecast.committedRemainingCostCents).toBe(75_000);
  });

  it("uses a rate change dated INSIDE the remainder", () => {
    // Monday, so Tue-Fri remain. A rise from Thursday must apply to Thu and
    // Fri only. Multiplying today's rate by four days would get this wrong,
    // which is the whole reason rates carry dates.
    const forecast = forecastRemainingCost({
      from: "2026-08-17",
      to: "2026-08-23",
      today: "2026-08-17",
      capacity: capacity(),
      daysAlreadyWorked: 0,
      personId: "p1",
      rates: [rate(), rate({ effectiveFrom: "2026-08-20", costRateCents: 20_000 })],
    });

    // Tue + Wed at $100 = $1,500; Thu + Fri at $200 = $3,000.
    expect(forecast.committedRemainingCostCents).toBe(450_000);
  });

  it("counts the DAYS the arrangement expects, not a share of each weekday", () => {
    // Monday, nothing logged, contracted to three days: three days remain -
    // 22.5h - not four weekdays x 3/5 of a day. The old spread gave 18h,
    // silently writing off a contracted day that had not happened yet.
    const forecast = forecastRemainingCost({
      from: "2026-08-17",
      to: "2026-08-23",
      today: "2026-08-17",
      capacity: capacity({ workingDaysPerWeek: 3, weeklyHours: 22.5 }),
      daysAlreadyWorked: 0,
      personId: "p1",
      rates: [rate()],
    });

    expect(forecast.committedRemainingHours).toBe(22.5);
    expect(forecast.committedRemainingCostCents).toBe(225_000);
    expect(forecast.proratedAcrossWeekdays).toBe(true);
  });

  it("gives a part-timer with one day left a WHOLE day, not a fraction of one", () => {
    // The case that exposed the old model. Contracted to three days, two
    // already worked, one weekday left: he either works it or he does not, so
    // 4.5h was a number that could never be the actual.
    const forecast = forecastRemainingCost({
      from: "2026-08-17",
      to: "2026-08-23",
      today: "2026-08-20",
      capacity: capacity({ workingDaysPerWeek: 3, weeklyHours: 22.5 }),
      daysAlreadyWorked: 2,
      personId: "p1",
      rates: [rate({ costRateCents: 4_500 })],
    });

    expect(forecast.committedRemainingHours).toBe(7.5);
    expect(forecast.committedRemainingCostCents).toBe(33_750);
  });

  it("forecasts nothing more once the contracted days are done", () => {
    // Three days contracted, three worked, two weekdays left. The arrangement
    // is satisfied, so there is nothing committed - the old model would have
    // added another 0.6 of a day per remaining weekday regardless.
    const forecast = forecastRemainingCost({
      from: "2026-08-17",
      to: "2026-08-23",
      today: "2026-08-19",
      capacity: capacity({ workingDaysPerWeek: 3, weeklyHours: 22.5 }),
      daysAlreadyWorked: 3,
      personId: "p1",
      rates: [rate()],
    });

    expect(forecast.committedRemainingHours).toBe(0);
  });

  it("never forecasts more days than there are weekdays left", () => {
    // Five days contracted, none worked, one weekday remaining. Nobody works
    // five days in one day, so the remainder is capped at what is left.
    const forecast = forecastRemainingCost({
      from: "2026-08-17",
      to: "2026-08-23",
      today: "2026-08-20",
      capacity: capacity(),
      daysAlreadyWorked: 0,
      personId: "p1",
      rates: [rate()],
    });

    expect(forecast.committedRemainingHours).toBe(7.5);
  });

  it("forecasts nothing for a period that has already finished", () => {
    const forecast = forecastRemainingCost({
      from: "2026-08-10",
      to: "2026-08-16",
      today: "2026-08-20",
      capacity: capacity(),
      daysAlreadyWorked: 0,
      personId: "p1",
      rates: [rate()],
    });

    expect(forecast.committedRemainingHours).toBe(0);
    expect(forecast.committedRemainingCostCents).toBeNull();
    expect(forecast.progress.isComplete).toBe(true);
  });

  it("forecasts the WHOLE of a period that has not started", () => {
    const forecast = forecastRemainingCost({
      from: "2026-08-24",
      to: "2026-08-30",
      today: "2026-08-20",
      capacity: capacity(),
      daysAlreadyWorked: 0,
      personId: "p1",
      rates: [rate()],
    });

    expect(forecast.committedRemainingHours).toBe(37.5);
    expect(forecast.committedRemainingCostCents).toBe(375_000);
  });

  it("withholds the total when any remaining day has no cost rate", () => {
    // A rate that expires is not a thing here, but a rate that STARTS mid
    // remainder is: the days before it cannot be costed, and a total covering
    // only the later ones is wrong rather than merely smaller.
    const forecast = forecastRemainingCost({
      from: "2026-08-17",
      to: "2026-08-23",
      today: "2026-08-17",
      capacity: capacity(),
      daysAlreadyWorked: 0,
      personId: "p1",
      rates: [rate({ effectiveFrom: "2026-08-20" })],
    });

    expect(forecast.committedRemainingCostCents).toBeNull();
  });

  it("withholds the total when the rate has no cost side", () => {
    const forecast = forecastRemainingCost({
      from: "2026-08-17",
      to: "2026-08-23",
      today: "2026-08-20",
      capacity: capacity(),
      daysAlreadyWorked: 0,
      personId: "p1",
      rates: [rate({ costRateCents: null })],
    });

    expect(forecast.committedRemainingCostCents).toBeNull();
  });

  it("states the leave assumption on the result rather than in a comment", () => {
    // Nothing in this system records holidays, so every projection assumes the
    // remaining days are worked. That is the most likely reason a forecast is
    // too high, so it travels with the figure.
    const forecast = forecastRemainingCost({
      from: "2026-08-17",
      to: "2026-08-23",
      today: "2026-08-20",
      capacity: capacity(),
      daysAlreadyWorked: 0,
      personId: "p1",
      rates: [rate()],
    });

    expect(forecast.assumesNoLeave).toBe(true);
  });
});

describe("forecastFromPace", () => {
  it("refuses to extrapolate early in a period", () => {
    // One weekday of five. Multiplying by five and showing it beside measured
    // figures is how a guess with a factor of five in it gets quoted.
    const early = periodProgress("2026-08-17", "2026-08-23", "2026-08-17");

    expect(early.elapsedRatio).toBeLessThan(MIN_ELAPSED_FOR_PACE);
    expect(forecastFromPace(10_000, early)).toBeNull();
  });

  it("extrapolates once enough of the period has gone", () => {
    // Wednesday: 3 of 5 weekdays. $300 so far implies $500.
    const midway = periodProgress("2026-08-17", "2026-08-23", "2026-08-19");

    expect(forecastFromPace(30_000, midway)).toBe(50_000);
  });

  it("returns the actual for a finished period, not an extrapolation", () => {
    const done = periodProgress("2026-08-10", "2026-08-16", "2026-08-20");

    expect(forecastFromPace(42_000, done)).toBe(42_000);
  });

  it("has nothing to extrapolate from when the actual is unknown", () => {
    const midway = periodProgress("2026-08-17", "2026-08-23", "2026-08-19");

    expect(forecastFromPace(null, midway)).toBeNull();
  });

  it("returns nothing for a period that has not started", () => {
    // No elapsed days to extrapolate from. The committed figure is the only
    // honest answer for a future period.
    const future = periodProgress("2026-08-24", "2026-08-30", "2026-08-20");

    expect(forecastFromPace(0, future)).toBeNull();
  });
});

describe("buildBurnUp", () => {
  const daily = [
    { date: "2026-08-17", costCents: 10_000, valueCents: 20_000 },
    { date: "2026-08-18", costCents: 10_000, valueCents: 20_000 },
  ];

  it("accumulates and flags each point as actual or forecast", () => {
    // Tuesday. Mon and Tue are actual; Wed, Thu and Fri carry the projection.
    const points = buildBurnUp({
      from: "2026-08-17",
      to: "2026-08-23",
      today: "2026-08-18",
      daily,
      committedRemainingCostCents: 30_000,
      projectedValueCents: 100_000,
      actualValueCents: 40_000,
    });

    expect(points.map((point) => point.isActual)).toEqual([true, true, false, false, false]);
    // Cumulative, not per-day.
    expect(points[0].cumulativeCostCents).toBe(10_000);
    expect(points[1].cumulativeCostCents).toBe(20_000);
    // The $300 remainder spread over three days lands exactly on the total.
    expect(points[4].cumulativeCostCents).toBe(50_000);
    expect(points[4].cumulativeValueCents).toBe(100_000);
  });

  it("gives one point per WEEKDAY, so a quiet day is a flat step", () => {
    // Wednesday has no rows. Omitting it would compress the axis and make the
    // shape of the period a lie.
    const points = buildBurnUp({
      from: "2026-08-17",
      to: "2026-08-23",
      today: "2026-08-21",
      daily,
      committedRemainingCostCents: null,
      projectedValueCents: null,
      actualValueCents: 40_000,
    });

    expect(points).toHaveLength(5);
    expect(points[1].cumulativeCostCents).toBe(20_000);
    // Wed, Thu, Fri had no rows: the line holds rather than dropping.
    expect(points[2].cumulativeCostCents).toBe(20_000);
    expect(points[4].cumulativeCostCents).toBe(20_000);
  });

  it("nulls every point after a day that could not be costed", () => {
    // Somebody without a rate on the Tuesday. Every later cumulative figure is
    // unknowable too, and a bar returning to the axis would read as a day that
    // cost nothing.
    const points = buildBurnUp({
      from: "2026-08-17",
      to: "2026-08-23",
      today: "2026-08-21",
      daily: [
        { date: "2026-08-17", costCents: 10_000, valueCents: 20_000 },
        { date: "2026-08-18", costCents: null, valueCents: 20_000 },
      ],
      committedRemainingCostCents: null,
      projectedValueCents: null,
      actualValueCents: 40_000,
    });

    expect(points[0].cumulativeCostCents).toBe(10_000);
    expect(points[1].cumulativeCostCents).toBeNull();
    expect(points[4].cumulativeCostCents).toBeNull();
    // Value was known throughout, so it survives independently.
    expect(points[4].cumulativeValueCents).toBe(40_000);
  });

  it("marks nothing as forecast once the period has finished", () => {
    const points = buildBurnUp({
      from: "2026-08-10",
      to: "2026-08-16",
      today: "2026-08-21",
      daily: [{ date: "2026-08-10", costCents: 10_000, valueCents: 20_000 }],
      committedRemainingCostCents: 0,
      projectedValueCents: 20_000,
      actualValueCents: 20_000,
    });

    expect(points.every((point) => point.isActual)).toBe(true);
  });

  it("returns nothing for a range with no weekdays rather than an empty axis", () => {
    expect(
      buildBurnUp({
        from: "2026-08-22",
        to: "2026-08-23",
        today: "2026-08-22",
        daily: [],
        committedRemainingCostCents: null,
        projectedValueCents: null,
        actualValueCents: null,
      }),
    ).toEqual([]);
  });
});
