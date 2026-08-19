import { describe, expect, it } from "vitest";

import { addDays, buildDailySeries, mondayOf } from "./daily-series";
import { PersonDayTotal } from "./timesheet.types";

// Every expectation is a hand-worked literal. August 2026: the 10th is a
// Monday, so the 15th and 16th are the weekend.
function day(workDate: string, billableSeconds: number, nonBillableSeconds = 0, unsetSeconds = 0): PersonDayTotal {
  const seconds = billableSeconds + nonBillableSeconds + unsetSeconds;

  return {
    personId: "josh",
    personName: "Joshua",
    workDate,
    seconds,
    hours: seconds / 3600,
    worklogCount: 1,
    utilisation: null,
    split: {
      billableSeconds,
      nonBillableSeconds,
      unsetSeconds,
      billableHours: billableSeconds / 3600,
      nonBillableHours: nonBillableSeconds / 3600,
      unsetHours: unsetSeconds / 3600,
      billableRatio: seconds > 0 ? billableSeconds / seconds : null,
    },
  };
}

const OPTIONS = { from: "2026-08-10", to: "2026-08-16", capacityHours: 7.5 };

describe("buildDailySeries", () => {
  it("gives every working day a slot, including the empty ones", () => {
    // Only Tuesday was worked. The chart still has to show Mon and Wed-Fri,
    // because an empty working day is the thing it exists to reveal.
    const series = buildDailySeries([day("2026-08-11", 27000)], OPTIONS);

    expect(series.points.map((point) => point.date)).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
    ]);
  });

  it("leaves out a weekend nobody worked", () => {
    const series = buildDailySeries([], OPTIONS);
    expect(series.points).toHaveLength(5);
    expect(series.points.some((point) => point.date === "2026-08-15")).toBe(false);
  });

  it("keeps a weekend somebody did work, with no capacity against it", () => {
    // A Saturday bar must not be measured against a target nobody set.
    const series = buildDailySeries([day("2026-08-15", 7200)], OPTIONS);
    const saturday = series.points.find((point) => point.date === "2026-08-15");

    expect(saturday).toBeDefined();
    expect(saturday?.isWorkingDay).toBe(false);
    expect(saturday?.capacityHours).toBe(0);
    expect(saturday?.billableHours).toBe(2);
  });

  it("splits each day three ways and keeps unset separate", () => {
    const series = buildDailySeries([day("2026-08-11", 18000, 5400, 3600)], OPTIONS);
    const tuesday = series.points.find((point) => point.date === "2026-08-11");

    expect(tuesday?.billableHours).toBe(5);
    expect(tuesday?.nonBillableHours).toBe(1.5);
    expect(tuesday?.unsetHours).toBe(1);
    expect(tuesday?.loggedHours).toBe(7.5);
  });

  it("sums several people onto the same day", () => {
    // Unfiltered, the chart is the team's day, so two people on one date add up
    // rather than one overwriting the other.
    const series = buildDailySeries(
      [day("2026-08-11", 27000), { ...day("2026-08-11", 18000), personId: "louis" }],
      OPTIONS,
    );

    expect(series.points.find((point) => point.date === "2026-08-11")?.billableHours).toBe(12.5);
  });

  it("computes utilisation against working days only", () => {
    // 7.5h logged, 5 working days at 7.5h = 37.5h available.
    const series = buildDailySeries([day("2026-08-11", 27000)], OPTIONS);

    expect(series.totals.workingDays).toBe(5);
    expect(series.totals.availableHours).toBe(37.5);
    expect(series.totals.loggedHours).toBe(7.5);
    expect(series.totals.utilisation).toBe(0.2);
  });

  it("computes billable share of what was logged", () => {
    const series = buildDailySeries([day("2026-08-11", 18000, 9000)], OPTIONS);
    // 5h billable of 7.5h logged.
    expect(series.totals.billableShare).toBe(0.6667);
  });

  it("reports no share at all for an empty period rather than nought per cent", () => {
    const series = buildDailySeries([], OPTIONS);
    expect(series.totals.billableShare).toBeNull();
    expect(series.totals.loggedHours).toBe(0);
  });

  it("sizes the axis to clear both the tallest bar and the capacity line", () => {
    const quiet = buildDailySeries([day("2026-08-11", 3600)], OPTIONS);
    // The tallest bar is 1h, but the capacity line sits at 7.5h and must fit.
    expect(quiet.maxHours).toBe(7.5);

    const heavy = buildDailySeries([day("2026-08-11", 43200)], OPTIONS);
    // A 12h day is taller than capacity, so the axis follows the bar.
    expect(heavy.maxHours).toBe(12);
  });

  it("labels weekdays correctly across a month boundary", () => {
    const series = buildDailySeries([], { from: "2026-08-31", to: "2026-09-01", capacityHours: 7.5 });

    expect(series.points.map((point) => `${point.weekdayLabel} ${point.dayOfMonth}`)).toEqual(["Mon 31", "Tue 1"]);
  });

  it("returns nothing for a malformed range instead of looping", () => {
    expect(buildDailySeries([], { from: "not-a-date", to: "2026-08-16", capacityHours: 7.5 }).points).toEqual([]);
  });

  it("honours a different working week", () => {
    // A six-day week: Saturday becomes a working day with capacity.
    const series = buildDailySeries([], { ...OPTIONS, workingWeekdays: [1, 2, 3, 4, 5, 6] });

    expect(series.points).toHaveLength(6);
    expect(series.points.at(-1)?.capacityHours).toBe(7.5);
  });
});

// -------------------------------------------------------------------
// Week helpers and the Monday-to-Sunday week view
// -------------------------------------------------------------------
describe("mondayOf", () => {
  it("returns the same day for a Monday", () => {
    expect(mondayOf("2026-08-10")).toBe("2026-08-10");
  });

  it("walks back to Monday from mid-week", () => {
    expect(mondayOf("2026-08-13")).toBe("2026-08-10");
  });

  it("treats Sunday as the END of its week, not the start", () => {
    // ISO weeks. Getting this wrong puts Sunday's hours in the wrong week and
    // makes two adjacent weeks both look wrong.
    expect(mondayOf("2026-08-16")).toBe("2026-08-10");
  });

  it("crosses a month boundary", () => {
    // 1 Sep 2026 is a Tuesday, so its Monday is 31 Aug.
    expect(mondayOf("2026-09-01")).toBe("2026-08-31");
  });
});

describe("addDays", () => {
  it("steps forward and back across month boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
    expect(addDays("2026-08-10", 7)).toBe("2026-08-17");
  });
});

describe("week view (Monday to Sunday)", () => {
  const WEEK = { from: "2026-08-10", to: "2026-08-16", capacityHours: 7.5, includeNonWorkingDays: true };

  it("always renders seven slots, Monday first", () => {
    const series = buildDailySeries([], WEEK);

    expect(series.points).toHaveLength(7);
    expect(series.points.map((point) => point.weekdayLabel)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
  });

  it("keeps the weekend visible but with no capacity to miss", () => {
    const series = buildDailySeries([], WEEK);
    const [saturday, sunday] = series.points.slice(5);

    expect(saturday.capacityHours).toBe(0);
    expect(sunday.capacityHours).toBe(0);
    expect(series.totals.availableHours).toBe(37.5);
  });

  it("still counts weekend work in the totals", () => {
    const series = buildDailySeries([day("2026-08-15", 7200)], WEEK);

    expect(series.totals.loggedHours).toBe(2);
    // Utilisation can exceed nothing here: capacity is only the five weekdays.
    expect(series.totals.availableHours).toBe(37.5);
  });
});

// -------------------------------------------------------------------
// Month bucketing, for a period too long to draw a bar per day
// -------------------------------------------------------------------
describe("monthly buckets", () => {
  const YEAR = { from: "2026-01-01", to: "2026-12-31", capacityHours: 7.5, bucket: "month" as const };

  it("draws twelve bars for a year, including the empty months", () => {
    // A year with a quiet quarter should show the gap, not close it up.
    const series = buildDailySeries([day("2026-08-11", 27000)], YEAR);

    expect(series.points).toHaveLength(12);
    expect(series.points.map((point) => point.weekdayLabel)).toEqual([
      "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]);
  });

  it("puts each entry in its own month", () => {
    const series = buildDailySeries(
      [day("2026-08-11", 27000), day("2026-03-04", 3600)],
      YEAR,
    );

    expect(series.points[2].loggedHours).toBe(1); // March
    expect(series.points[7].loggedHours).toBe(7.5); // August
  });

  it("measures each month against its own weekday count", () => {
    // February 2026 has 20 weekdays, August has 21. Holding February to
    // August's capacity would report it as permanently behind.
    const series = buildDailySeries([], YEAR);

    expect(series.points[1].capacityHours).toBe(20 * 7.5);
    expect(series.points[7].capacityHours).toBe(21 * 7.5);
  });

  it("sizes the axis to clear the tallest capacity track, not just the bars", () => {
    // A quiet year still has to draw its capacity tracks inside the plot.
    const series = buildDailySeries([day("2026-08-11", 3600)], YEAR);
    expect(series.maxHours).toBeGreaterThanOrEqual(20 * 7.5);
  });

  it("totals the whole year", () => {
    const series = buildDailySeries(
      [day("2026-08-11", 18000, 9000), day("2026-03-04", 3600)],
      YEAR,
    );

    expect(series.totals.loggedHours).toBe(8.5);
    expect(series.totals.billableHours).toBe(6);
    expect(series.totals.nonBillableHours).toBe(2.5);
  });
});
