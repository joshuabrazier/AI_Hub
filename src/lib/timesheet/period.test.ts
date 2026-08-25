import { describe, expect, it } from "vitest";

import { bucketFor, endOfPeriod, isGranularity, resolvePeriod, startOfPeriod } from "./period";

// August 2026: the 1st is a Saturday, the 10th and 17th are Mondays.
const TODAY = "2026-08-18";

describe("startOfPeriod", () => {
  it("snaps a week to its Monday", () => {
    expect(startOfPeriod("week", "2026-08-20")).toBe("2026-08-17");
    expect(startOfPeriod("week", "2026-08-17")).toBe("2026-08-17");
    // Sunday belongs to the week that started six days earlier.
    expect(startOfPeriod("week", "2026-08-23")).toBe("2026-08-17");
  });

  it("snaps a month to the first", () => {
    expect(startOfPeriod("month", "2026-08-18")).toBe("2026-08-01");
  });

  it("snaps a year to 1 January", () => {
    expect(startOfPeriod("year", "2026-08-18")).toBe("2026-01-01");
  });

  // -------------------------------------------------------------------
  // A fortnight is THIS WEEK AND LAST WEEK, never this week and next.
  //
  // TODAY is 2026-08-18, a Tuesday, so this week runs 17-23 Aug and last week
  // runs 10-16. The fortnight containing today is therefore 10-23 Aug.
  // -------------------------------------------------------------------
  it("ends the current fortnight with the current week", () => {
    // The behaviour this replaced: a fixed epoch put today in the first half
    // half the time, so "this fortnight" showed a week that had not happened.
    expect(startOfPeriod("fortnight", TODAY, TODAY)).toBe("2026-08-10");
    expect(endOfPeriod("fortnight", startOfPeriod("fortnight", TODAY, TODAY))).toBe("2026-08-23");
  });

  it("resolves both weeks of a fortnight to the same start", () => {
    // Otherwise a link built from a date inside the period would open a
    // different period from the one it was copied out of.
    const start = startOfPeriod("fortnight", TODAY, TODAY);

    // Both weeks: Mon-Sun of last week, and Mon-Sun of this one.
    for (const day of ["2026-08-10", "2026-08-13", "2026-08-16", "2026-08-17", "2026-08-18", "2026-08-23"]) {
      expect(startOfPeriod("fortnight", day, TODAY)).toBe(start);
    }
  });

  it("is idempotent, so a reload cannot walk the period backwards", () => {
    // The trap in a trailing definition: if resolving a START shifted it again,
    // every reload would slide the fortnight a week earlier.
    const once = startOfPeriod("fortnight", TODAY, TODAY);

    expect(startOfPeriod("fortnight", once, TODAY)).toBe(once);
    expect(startOfPeriod("fortnight", startOfPeriod("fortnight", once, TODAY), TODAY)).toBe(once);
  });

  it("partitions earlier fortnights cleanly, two weeks at a time", () => {
    // The day before the current fortnight begins falls in the previous one.
    expect(startOfPeriod("fortnight", "2026-08-09", TODAY)).toBe("2026-07-27");
    expect(startOfPeriod("fortnight", "2026-08-02", TODAY)).toBe("2026-07-27");
    expect(startOfPeriod("fortnight", "2026-07-26", TODAY)).toBe("2026-07-13");
  });

  it("puts a future week in its own fortnight rather than the current one", () => {
    // Next week must not be dragged into "this fortnight" - that was the whole
    // complaint about the epoch alignment.
    expect(startOfPeriod("fortnight", "2026-08-24", TODAY)).toBe("2026-08-24");
    expect(startOfPeriod("fortnight", "2026-09-01", TODAY)).toBe("2026-08-24");
  });
});

describe("endOfPeriod", () => {
  it("ends a week six days later", () => {
    expect(endOfPeriod("week", "2026-08-17")).toBe("2026-08-23");
  });

  it("ends a fortnight thirteen days later", () => {
    expect(endOfPeriod("fortnight", "2026-08-10")).toBe("2026-08-23");
  });

  it("ends a month on its actual last day", () => {
    expect(endOfPeriod("month", "2026-08-01")).toBe("2026-08-31");
    expect(endOfPeriod("month", "2026-02-01")).toBe("2026-02-28");
    // December must roll into the next year rather than overflowing.
    expect(endOfPeriod("month", "2026-12-01")).toBe("2026-12-31");
  });

  it("handles a leap February", () => {
    expect(endOfPeriod("month", "2028-02-01")).toBe("2028-02-29");
  });

  it("ends a year on 31 December", () => {
    expect(endOfPeriod("year", "2026-01-01")).toBe("2026-12-31");
  });
});

describe("resolvePeriod", () => {
  it("labels a week as a span", () => {
    const period = resolvePeriod("week", "2026-08-18", TODAY);
    expect(period.label).toBe("17-23 Aug 2026");
  });

  it("names both months when a span crosses one", () => {
    const period = resolvePeriod("week", "2026-08-31", TODAY);
    expect(period.label).toBe("31 Aug-6 Sep 2026");
  });

  it("labels a month and a year plainly", () => {
    expect(resolvePeriod("month", "2026-08-18", TODAY).label).toBe("August 2026");
    expect(resolvePeriod("year", "2026-08-18", TODAY).label).toBe("2026");
  });

  it("steps by its own granularity", () => {
    expect(resolvePeriod("week", "2026-08-18", TODAY).previousStart).toBe("2026-08-10");
    expect(resolvePeriod("fortnight", "2026-08-18", TODAY).previousStart).toBe(
      startOfPeriod("fortnight", "2026-08-04", TODAY),
    );
    expect(resolvePeriod("month", "2026-08-18", TODAY).previousStart).toBe("2026-07-01");
    expect(resolvePeriod("year", "2026-08-18", TODAY).previousStart).toBe("2025-01-01");
  });

  it("steps a month back across a year boundary", () => {
    expect(resolvePeriod("month", "2026-01-15", TODAY).previousStart).toBe("2025-12-01");
    expect(resolvePeriod("month", "2026-12-15", TODAY).nextStart).toBe("2027-01-01");
  });

  it("does not offer a period that has not begun", () => {
    // Next week has not started on 18 Aug.
    expect(resolvePeriod("week", TODAY, TODAY).hasNext).toBe(false);
    // Last week's next period is this one, which has.
    expect(resolvePeriod("week", "2026-08-10", TODAY).hasNext).toBe(true);
    expect(resolvePeriod("year", TODAY, TODAY).hasNext).toBe(false);
  });

  it("falls back to today for an unusable anchor rather than throwing", () => {
    // A stale or hand-edited link should show the current period, not an
    // error page.
    expect(resolvePeriod("month", "not-a-date", TODAY).start).toBe("2026-08-01");
    expect(resolvePeriod("month", "2026-02-31", TODAY).start).toBe("2026-08-01");
  });
});

describe("bucketFor", () => {
  it("buckets a year by month and everything else by day", () => {
    // 365 daily slivers cannot be read or hovered; a week of monthly bars is
    // a single bar.
    expect(bucketFor("year")).toBe("month");
    expect(bucketFor("month")).toBe("day");
    expect(bucketFor("fortnight")).toBe("day");
    expect(bucketFor("week")).toBe("day");
  });
});

describe("isGranularity", () => {
  it("accepts the four known values and nothing else", () => {
    expect(isGranularity("week")).toBe(true);
    expect(isGranularity("year")).toBe(true);
    expect(isGranularity("decade")).toBe(false);
    expect(isGranularity(undefined)).toBe(false);
  });
});

describe("isCurrent", () => {
  it("is true for the period containing today", () => {
    expect(resolvePeriod("week", TODAY, TODAY).isCurrent).toBe(true);
    expect(resolvePeriod("month", TODAY, TODAY).isCurrent).toBe(true);
    expect(resolvePeriod("year", TODAY, TODAY).isCurrent).toBe(true);
  });

  it("is false for any other period", () => {
    // So a "this week" control can disable itself rather than looking like a
    // button that does nothing.
    expect(resolvePeriod("week", "2026-08-10", TODAY).isCurrent).toBe(false);
    expect(resolvePeriod("month", "2026-07-15", TODAY).isCurrent).toBe(false);
    expect(resolvePeriod("year", "2025-08-18", TODAY).isCurrent).toBe(false);
  });
});
