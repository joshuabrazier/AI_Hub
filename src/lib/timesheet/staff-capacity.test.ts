import { describe, expect, it } from "vitest";

import {
  capacityHoursForPeriod,
  countWeekdays,
  measureAgainstTarget,
  toStaffCapacity,
  capacityHoursForRange,
  countWeekdaysMatching,
  workingDatesInRange,
} from "./staff-capacity";

// Every expectation is a hand-worked literal.
const FULL_TIME = { personId: "josh", workingDaysTenths: 50, minutesPerDay: 450, billableTargetPercent: 80 };
const THREE_DAYS = { personId: "louis", workingDaysTenths: 30, minutesPerDay: 450, billableTargetPercent: 90 };

describe("toStaffCapacity", () => {
  it("reads tenths and minutes back as readable days and hours", () => {
    const capacity = toStaffCapacity(FULL_TIME, "josh");

    expect(capacity.workingDaysPerWeek).toBe(5);
    expect(capacity.hoursPerDay).toBe(7.5);
    expect(capacity.weeklyHours).toBe(37.5);
    expect(capacity.isDefault).toBe(false);
  });

  it("handles a half day without rounding it away", () => {
    // 4.5 days is a real arrangement, and rounding it to 4 or 5 misstates a
    // tenth of somebody's working life.
    const capacity = toStaffCapacity({ ...FULL_TIME, workingDaysTenths: 45 }, "josh");

    expect(capacity.workingDaysPerWeek).toBe(4.5);
    expect(capacity.weeklyHours).toBe(33.75);
  });

  it("falls back to the company default and says that it did", () => {
    const capacity = toStaffCapacity(null, "nobody");

    expect(capacity.workingDaysPerWeek).toBe(5);
    expect(capacity.hoursPerDay).toBe(7.5);
    // The flag is what stops an assumed target being read as an agreed one.
    expect(capacity.isDefault).toBe(true);
    expect(capacity.billableTargetPercent).toBeNull();
  });
});

describe("countWeekdays", () => {
  it("counts Monday to Friday only", () => {
    // 10 Aug 2026 is a Monday; the 15th and 16th are the weekend.
    expect(countWeekdays("2026-08-10", "2026-08-16")).toBe(5);
  });

  it("counts a full month", () => {
    // August 2026 has 21 weekdays.
    expect(countWeekdays("2026-08-01", "2026-08-31")).toBe(21);
  });

  it("returns zero for a weekend-only range", () => {
    expect(countWeekdays("2026-08-15", "2026-08-16")).toBe(0);
  });

  it("returns zero rather than looping on a malformed range", () => {
    expect(countWeekdays("not-a-date", "2026-08-16")).toBe(0);
  });
});

describe("capacityHoursForPeriod", () => {
  it("gives a full-timer the whole period", () => {
    // 21 weekdays at 7.5h.
    expect(capacityHoursForPeriod(toStaffCapacity(FULL_TIME, "josh"), 21)).toBe(157.5);
  });

  it("prorates somebody on three days a week", () => {
    // 21 weekdays x 3/5 x 7.5h = 94.5h, not 157.5h.
    expect(capacityHoursForPeriod(toStaffCapacity(THREE_DAYS, "louis"), 21)).toBe(94.5);
  });

  it("prorates a week the same way", () => {
    // 5 weekdays x 3/5 x 7.5h = 22.5h, which is exactly three days.
    expect(capacityHoursForPeriod(toStaffCapacity(THREE_DAYS, "louis"), 5)).toBe(22.5);
  });

  it("is zero for a period with no working days", () => {
    expect(capacityHoursForPeriod(toStaffCapacity(FULL_TIME, "josh"), 0)).toBe(0);
  });
});

describe("measureAgainstTarget", () => {
  it("does not punish a part-timer for being part-time", () => {
    // This is the whole point. 22.5h in a week is a FULL week for somebody on
    // three days: 100%, not the 60% a company-wide 37.5h would report.
    const performance = measureAgainstTarget(toStaffCapacity(THREE_DAYS, "louis"), 5, 22.5, 22.5);

    expect(performance.capacityHours).toBe(22.5);
    expect(performance.utilisation).toBe(1);
  });

  it("measures a full-timer against the full week", () => {
    const performance = measureAgainstTarget(toStaffCapacity(FULL_TIME, "josh"), 5, 22.5, 18);

    expect(performance.capacityHours).toBe(37.5);
    expect(performance.utilisation).toBe(0.6);
  });

  it("computes billable share of what was logged, not of capacity", () => {
    const performance = measureAgainstTarget(toStaffCapacity(FULL_TIME, "josh"), 5, 20, 15);
    expect(performance.billableShare).toBe(0.75);
  });

  it("reports the gap to the billable target in percentage points", () => {
    // 75% against an 80% target is 5 points short.
    const performance = measureAgainstTarget(toStaffCapacity(FULL_TIME, "josh"), 5, 20, 15);

    expect(performance.billableTargetPercent).toBe(80);
    expect(performance.billableVariance).toBe(-5);
    expect(performance.meetsBillableTarget).toBe(false);
  });

  it("counts hitting the target exactly as met", () => {
    // 90% against a 90% target. Reached is met, so this is >= not >.
    const performance = measureAgainstTarget(toStaffCapacity(THREE_DAYS, "louis"), 5, 20, 18);

    expect(performance.billableVariance).toBe(0);
    expect(performance.meetsBillableTarget).toBe(true);
  });

  it("reports no variance at all when no target is set", () => {
    const noTarget = toStaffCapacity({ ...FULL_TIME, billableTargetPercent: null }, "josh");
    const performance = measureAgainstTarget(noTarget, 5, 20, 15);

    expect(performance.billableVariance).toBeNull();
    // Null, not false: nobody has said what is expected, so nothing is failed.
    expect(performance.meetsBillableTarget).toBeNull();
  });

  it("reports no share for a period with nothing logged", () => {
    const performance = measureAgainstTarget(toStaffCapacity(FULL_TIME, "josh"), 5, 0, 0);

    expect(performance.billableShare).toBeNull();
    expect(performance.utilisation).toBe(0);
  });

  it("reports no utilisation for somebody contracted to zero days", () => {
    const onLeave = toStaffCapacity({ ...FULL_TIME, workingDaysTenths: 0 }, "josh");
    const performance = measureAgainstTarget(onLeave, 5, 0, 0);

    // Null rather than zero: there is no capacity to have used.
    expect(performance.capacityHours).toBe(0);
    expect(performance.utilisation).toBeNull();
  });
});

// -------------------------------------------------------------------
// WHICH days somebody works, not just how many.
//
// The week of 17-23 Aug 2026 starts on a Monday, so 17-21 are weekdays.
// -------------------------------------------------------------------
describe("capacity with named working days", () => {
  const monTueWed = toStaffCapacity(
    { personId: "p1", workingDaysTenths: 30, minutesPerDay: 450, billableTargetPercent: null, workingWeekdays: [1, 2, 3] },
    "p1",
  );

  it("counts the person's OWN days in the range", () => {
    // Three days at 7.5h is 22.5h - the same total prorating would give for a
    // whole week, but now placed on Monday, Tuesday and Wednesday.
    expect(capacityHoursForRange(monTueWed, "2026-08-17", "2026-08-23")).toBe(22.5);
  });

  it("gives no capacity in a stretch containing none of their days", () => {
    // Thursday to Sunday, for somebody who works Mon-Wed. Prorating would
    // still hand them three fifths of each weekday, which is capacity on days
    // they are not contracted to work at all.
    expect(capacityHoursForRange(monTueWed, "2026-08-20", "2026-08-23")).toBe(0);
  });

  it("scales across a longer range by counting real days", () => {
    // Two full weeks: six working days at 7.5h.
    expect(capacityHoursForRange(monTueWed, "2026-08-17", "2026-08-30")).toBe(45);
  });

  it("falls back to prorating when the days are unset", () => {
    const countOnly = toStaffCapacity(
      { personId: "p1", workingDaysTenths: 30, minutesPerDay: 450, billableTargetPercent: null },
      "p1",
    );

    expect(countOnly.workingWeekdays).toBeNull();
    // Five weekdays x 3/5 x 7.5h, the behaviour every existing row keeps.
    expect(capacityHoursForRange(countOnly, "2026-08-17", "2026-08-23")).toBe(22.5);
    // And the difference shows on a partial range, where the average is not
    // the answer: Thu-Sun prorated still yields capacity.
    expect(capacityHoursForRange(countOnly, "2026-08-20", "2026-08-23")).toBeGreaterThan(0);
  });

  it("keeps prorating for a half-day arrangement even with days chosen", () => {
    // A list of whole weekdays cannot express 4.5 days, so the tenths stay the
    // authority rather than the list silently rounding somebody up.
    const halfDay = toStaffCapacity(
      { personId: "p1", workingDaysTenths: 45, minutesPerDay: 450, billableTargetPercent: null, workingWeekdays: [1, 2, 3, 4, 5] },
      "p1",
    );

    expect(capacityHoursForRange(halfDay, "2026-08-17", "2026-08-23")).toBe(33.75);
  });

  it("sorts and de-duplicates the days it is given", () => {
    // A repeated day would double that day's capacity, and the database cannot
    // reject one - see migration 009.
    const messy = toStaffCapacity(
      { personId: "p1", workingDaysTenths: 30, minutesPerDay: 450, billableTargetPercent: null, workingWeekdays: [3, 1, 2] },
      "p1",
    );

    expect(messy.workingWeekdays).toEqual([1, 2, 3]);
  });

  it("treats an empty list as unspecified rather than as no days", () => {
    const empty = toStaffCapacity(
      { personId: "p1", workingDaysTenths: 30, minutesPerDay: 450, billableTargetPercent: null, workingWeekdays: [] },
      "p1",
    );

    expect(empty.workingWeekdays).toBeNull();
  });
});

describe("countWeekdaysMatching", () => {
  it("maps Sunday to ISO 7 rather than 0", () => {
    // getUTCDay calls Sunday 0; ISO calls it 7. Getting this wrong silently
    // drops every Sunday from a weekend worker's capacity.
    expect(countWeekdaysMatching("2026-08-17", "2026-08-23", [7])).toBe(1);
    expect(countWeekdaysMatching("2026-08-17", "2026-08-23", [6, 7])).toBe(2);
  });

  it("counts nothing for a reversed range", () => {
    expect(countWeekdaysMatching("2026-08-23", "2026-08-17", [1])).toBe(0);
  });
});

describe("workingDatesInRange", () => {
  it("names the actual dates, which is what lets a forecast price each one", () => {
    const capacity = toStaffCapacity(
      { personId: "p1", workingDaysTenths: 30, minutesPerDay: 450, billableTargetPercent: null, workingWeekdays: [2, 4] },
      "p1",
    );

    expect(workingDatesInRange(capacity, "2026-08-17", "2026-08-23")).toEqual(["2026-08-18", "2026-08-20"]);
  });

  it("returns nothing when the days are unset", () => {
    const capacity = toStaffCapacity(
      { personId: "p1", workingDaysTenths: 30, minutesPerDay: 450, billableTargetPercent: null },
      "p1",
    );

    expect(workingDatesInRange(capacity, "2026-08-17", "2026-08-23")).toEqual([]);
  });
});
