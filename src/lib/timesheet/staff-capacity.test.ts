import { describe, expect, it } from "vitest";

import {
  capacityHoursForPeriod,
  countWeekdays,
  measureAgainstTarget,
  toStaffCapacity,
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
