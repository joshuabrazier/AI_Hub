import { describe, expect, it } from "vitest";

import { RATE_BANDS } from "@/lib/data/kysely-database-types";

import {
  DAYS_IN_WEEK,
  DEFAULT_WEEK_START,
  WEEK_DAY_NUMBERS,
  addCalendarDays,
  budgetProgress,
  formatMinutesAsClock,
  formatMinutesAsHours,
  hoursToMinutes,
  isCalendarDate,
  marginCents,
  minutesToHours,
  rateValueCents,
  startOfWeek,
  weekDates,
  weekDayOf,
  CreateClientSchema,
  SetUserRateSchema,
  SetUserRatesSchema,
  UpdateClientSchema,
  UpdateProjectSchema,
  UpdateTaskSchema,
  UpdateTimeEntrySchema,
  type TimesheetCellDTO,
  type TimesheetCellEntryDTO,
  type UpdateClientRequestDTO,
  type UpdateTaskRequestDTO,
  type UpdateTimeEntryRequestDTO,
} from "./delivery.types";

// -------------------------------------------------------------------
// The pure arithmetic of the delivery module, and the reason it is tested
// this thoroughly is that NONE of it fails loudly.
//
// A rounding rule that truncates, a week that starts a day early, a budget
// that reads 100% when nobody set one: each produces a full screen of
// plausible numbers under the wrong headings. Nobody notices until a month
// is invoiced, and by then the figures have been believed.
//
// So every test below states the behaviour in its name and says what breaks
// if it regresses. Each was also checked against the obvious wrong
// implementation - truncation instead of rounding, a Date-based week, a
// division with no guard - and named it where the case exists to catch one.
// -------------------------------------------------------------------

describe("hoursToMinutes", () => {
  it("converts the fractions people actually type", () => {
    expect(hoursToMinutes(0.25)).toBe(15);
    expect(hoursToMinutes(0.5)).toBe(30);
    expect(hoursToMinutes(1.5)).toBe(90);
    expect(hoursToMinutes(8)).toBe(480);
  });

  it("ROUNDS to the nearest minute rather than truncating", () => {
    // THE CASE THAT TELLS THE TWO APART. 0.33 hours is 19.8 minutes:
    // rounding stores 20, truncating stores 19. Truncation costs up to 59
    // seconds on EVERY entry, so a week of seven never adds up to the day
    // somebody worked and the shortfall grows the more carefully they fill
    // the form in.
    expect(hoursToMinutes(0.33)).toBe(20);
    expect(hoursToMinutes(0.34)).toBe(20);
  });

  it("rounds a half minute UP, which is the boundary of the rule", () => {
    // 0.125 hours is exactly 7.5 minutes, and half-up gives 8. Truncation
    // gives 7, which is what this catches.
    expect(hoursToMinutes(0.125)).toBe(8);
    // The other side of the same boundary: 6.4998 minutes is just under the
    // half, so it rounds down.
    expect(hoursToMinutes(0.108_33)).toBe(6);
    // AND THE CASE THAT SEPARATES HALF-UP FROM BANKER'S ROUNDING, which the
    // two above do not. 0.375 hours is exactly 22.5 minutes: half-up gives
    // 23, round-half-to-even gives 22 because 22 is the even neighbour.
    // Without this, a banker's-rounding implementation passes the whole
    // block - and it is a plausible thing for somebody to reach for, since
    // it is what most currency code does.
    expect(hoursToMinutes(0.375)).toBe(23);
    // A second such case, and both have to be EXACTLY representable to be
    // worth anything: 0.875 hours is 52.5 minutes on the nose, whose
    // neighbours are 52 (even) and 53, so half-up gives 53 and half-even
    // gives 52. A value like 0.408333 looks like 24.5 minutes and is
    // actually 24.4999998, which rounds to 24 under every rule and tests
    // nothing.
    expect(hoursToMinutes(0.875)).toBe(53);
  });

  it("rounds a negative half TOWARDS zero, because half up means towards positive", () => {
    // Reductions are negative hours, so the sign asymmetry is reachable:
    // -7.5 minutes records as -7, not -8. Pinned rather than fixed - an
    // implementation that rounded the magnitude instead would answer -8 and
    // silently change what every existing reduction meant.
    expect(hoursToMinutes(-0.125)).toBe(-7);
    expect(hoursToMinutes(-1.5)).toBe(-90);
  });

  it("rounds a fraction of a minute away to nothing", () => {
    // 0.004 hours is a quarter of a minute. It stores as 0, which violates
    // `time_entries_minutes_sane`, and that is exactly why `entryHoursField`
    // re-checks `minutes >= 1` AFTER the transform rather than bounding the
    // hours before it.
    expect(hoursToMinutes(0.004)).toBe(0);
  });
});

describe("minutesToHours", () => {
  it("converts back exactly for the tidy cases", () => {
    expect(minutesToHours(90)).toBe(1.5);
    expect(minutesToHours(15)).toBe(0.25);
    expect(minutesToHours(30)).toBe(0.5);
  });

  it("keeps the fraction on a value that does not divide evenly", () => {
    // UNROUNDED on purpose - this is the arithmetic path, for a chart axis or
    // a utilisation figure. Rounding here would report 50 minutes as an hour,
    // and it is `formatMinutesAsHours` that decides how a number is shown.
    expect(minutesToHours(50)).toBeCloseTo(0.833_33, 5);
    expect(minutesToHours(50)).not.toBe(1);
    expect(minutesToHours(20)).not.toBe(0.33);
  });

  it("round-trips minutes through hours and back", () => {
    // The pair has to compose, because a form loads an existing entry in
    // hours and posts it back. A drift of a minute per edit is the failure.
    for (const minutes of [1, 7, 15, 20, 50, 90, 481, 1440]) {
      expect(hoursToMinutes(minutesToHours(minutes)), `${minutes}`).toBe(minutes);
    }
  });
});

describe("formatMinutesAsClock", () => {
  it("reads as hours and minutes", () => {
    expect(formatMinutesAsClock(90)).toBe("1h 30m");
    expect(formatMinutesAsClock(485)).toBe("8h 5m");
  });

  it("drops the minutes on a whole hour", () => {
    // "2h 0m" in a scanned column is noise. An implementation that always
    // prints both fields passes every other test here.
    expect(formatMinutesAsClock(60)).toBe("1h");
    expect(formatMinutesAsClock(120)).toBe("2h");
  });

  it("drops the hours under one", () => {
    expect(formatMinutesAsClock(45)).toBe("45m");
    expect(formatMinutesAsClock(59)).toBe("59m");
  });

  it("says 0m rather than nothing when there is no time at all", () => {
    // An empty cell and a cell with no time logged look the same on screen,
    // and only one of them means the row is there.
    expect(formatMinutesAsClock(0)).toBe("0m");
  });

  it("shows under a minute as zero rather than as a fraction", () => {
    expect(formatMinutesAsClock(0.4)).toBe("0m");
    expect(formatMinutesAsClock(0.6)).toBe("1m");
  });

  it("keeps the sign on a negative, and does not sign both halves", () => {
    // A remaining-budget figure goes negative and "-6h 30m" is the whole
    // point of showing it. Math.floor on a negative would give "-7h -30m",
    // which is both wrong and unreadable.
    expect(formatMinutesAsClock(-390)).toBe("-6h 30m");
    expect(formatMinutesAsClock(-30)).toBe("-30m");
    expect(formatMinutesAsClock(-120)).toBe("-2h");
  });
});

describe("formatMinutesAsHours", () => {
  it("is the form somebody can type over in a cell", () => {
    expect(formatMinutesAsHours(90)).toBe("1.5");
    expect(formatMinutesAsHours(15)).toBe("0.25");
  });

  it("trims the trailing zeros", () => {
    // `toFixed(2)` alone answers "1.00", and a grid of "1.00" is a grid
    // nobody wants to edit.
    expect(formatMinutesAsHours(60)).toBe("1");
    expect(formatMinutesAsHours(30)).toBe("0.5");
    expect(formatMinutesAsHours(0)).toBe("0");
  });

  it("shows two decimals for a value that does not divide evenly", () => {
    // 20 minutes shows as "0.33", which read back literally is 19.8 minutes.
    // The MINUTES stay the truth, which is why nothing ever sums these
    // strings.
    expect(formatMinutesAsHours(20)).toBe("0.33");
    expect(formatMinutesAsHours(25)).toBe("0.42");
    expect(formatMinutesAsHours(50)).toBe("0.83");
  });
});

// -------------------------------------------------------------------
// THE WEEK MATHS, which is the reason this file does its calendar
// arithmetic on integers instead of on Date.
//
// Every expected value below was derived independently before the assertion
// was written, and each case is one a Date-based implementation gets wrong:
// a month boundary, a year boundary, a leap day, and a pre-epoch date where
// JavaScript's `%` returns a negative.
// -------------------------------------------------------------------

describe("isCalendarDate", () => {
  it("accepts a real date", () => {
    expect(isCalendarDate("2026-09-08")).toBe(true);
    expect(isCalendarDate("2026-12-31")).toBe(true);
  });

  it("refuses a day that does not exist in that month", () => {
    // The dangerous inputs are the ones that look fine. `new Date` rolls
    // 2026-02-31 into March and 2026-04-31 into May, so a week built from
    // either would be seven correct-looking dates for the wrong week.
    expect(isCalendarDate("2026-02-31")).toBe(false);
    expect(isCalendarDate("2026-04-31")).toBe(false);
    expect(isCalendarDate("2026-04-30")).toBe(true);
  });

  it("refuses a month outside 1-12 and a day of zero", () => {
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-00-10")).toBe(false);
    expect(isCalendarDate("2026-06-00")).toBe(false);
  });

  it("applies all three leap-year rules, not just the divisible-by-four one", () => {
    // 2024 is a leap year; 2100 is not, because centuries are skipped; 2000
    // is, because every four hundredth is skipped back. A `% 4` check alone
    // passes the first two tests in this block and accepts 2100-02-29.
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2100-02-29")).toBe(false);
    expect(isCalendarDate("2000-02-29")).toBe(true);
  });

  it("insists on the exact 'YYYY-MM-DD' shape", () => {
    // These are compared lexicographically everywhere in the app, which is
    // only valid while every value is zero-padded and the same length.
    expect(isCalendarDate("2026-6-01")).toBe(false);
    expect(isCalendarDate("2026-06-1")).toBe(false);
    expect(isCalendarDate("20260601")).toBe(false);
    expect(isCalendarDate("2026-06-01T00:00:00Z")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});

describe("addCalendarDays", () => {
  it("crosses a month boundary in both directions", () => {
    expect(addCalendarDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addCalendarDays("2026-09-01", -1)).toBe("2026-08-31");
    expect(addCalendarDays("2026-06-30", 1)).toBe("2026-07-01");
  });

  it("crosses a year boundary in both directions", () => {
    expect(addCalendarDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addCalendarDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("lands on 29 February in a leap year and steps over it otherwise", () => {
    expect(addCalendarDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addCalendarDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addCalendarDays("2026-02-28", 1)).toBe("2026-03-01");
    // The two century rules again, this time through the arithmetic rather
    // than through the validator.
    expect(addCalendarDays("2100-02-28", 1)).toBe("2100-03-01");
    expect(addCalendarDays("2000-02-28", 1)).toBe("2000-02-29");
  });

  it("adds a whole year and a whole leap year", () => {
    expect(addCalendarDays("2026-09-08", 365)).toBe("2027-09-08");
    // 2024 contains a 29th of February, so 365 days from March lands a day
    // early rather than on the anniversary.
    expect(addCalendarDays("2023-09-08", 365)).toBe("2024-09-07");
  });

  it("returns the date unchanged for a zero offset", () => {
    expect(addCalendarDays("2026-09-08", 0)).toBe("2026-09-08");
  });

  it("works before the epoch, where a day number is negative", () => {
    expect(addCalendarDays("1970-01-01", -1)).toBe("1969-12-31");
    expect(addCalendarDays("1969-12-31", 1)).toBe("1970-01-01");
  });

  it("pads a month and a day back to two digits", () => {
    // The whole app compares these strings, so "2026-1-5" would sort before
    // "2026-01-06" and a week query would return nothing.
    expect(addCalendarDays("2026-01-31", 5)).toBe("2026-02-05");
    expect(addCalendarDays("2026-12-31", 5)).toBe("2027-01-05");
  });

  it("throws on a malformed date instead of returning something plausible", () => {
    // DELIBERATE, and the opposite of what `daily-series.ts` does. A chart
    // with a missing bar is visible; a grid handed a fallback date renders
    // seven plausible columns under the wrong headings and looks fine.
    expect(() => addCalendarDays("2026-02-31", 1)).toThrow(/Not a calendar date/);
    expect(() => addCalendarDays("not a date", 1)).toThrow(/Not a calendar date/);
    expect(() => addCalendarDays("", 1)).toThrow(/Not a calendar date/);
  });
});

describe("weekDayOf", () => {
  it("numbers the days from Sunday", () => {
    expect(weekDayOf("2026-09-06")).toBe(WEEK_DAY_NUMBERS.SUNDAY);
    expect(weekDayOf("2026-09-07")).toBe(WEEK_DAY_NUMBERS.MONDAY);
    expect(weekDayOf("2026-09-08")).toBe(WEEK_DAY_NUMBERS.TUESDAY);
    expect(weekDayOf("2026-09-12")).toBe(WEEK_DAY_NUMBERS.SATURDAY);
  });

  it("knows the epoch was a Thursday", () => {
    // The offset in the modulo is anchored on this one fact. Off by one here
    // moves every column heading in the timesheet by a day.
    expect(weekDayOf("1970-01-01")).toBe(WEEK_DAY_NUMBERS.THURSDAY);
  });

  it("answers a real day for a date before the epoch", () => {
    // 1969-12-25 was a Thursday, and its day number is -7. A plain
    // `(dayNumber + 4) % 7` returns -3 here, which is not a day of the week
    // at all and would index past the end of any array built from it.
    expect(weekDayOf("1969-12-25")).toBe(WEEK_DAY_NUMBERS.THURSDAY);
    expect(weekDayOf("1969-12-28")).toBe(WEEK_DAY_NUMBERS.SUNDAY);
  });

  it("throws on a malformed date", () => {
    expect(() => weekDayOf("2026-13-01")).toThrow(/Not a calendar date/);
  });
});

describe("startOfWeek", () => {
  it("defaults to Monday, matching the reporting engine", () => {
    expect(DEFAULT_WEEK_START).toBe(WEEK_DAY_NUMBERS.MONDAY);
    expect(startOfWeek("2026-09-08")).toBe("2026-09-07");
  });

  it("returns the date itself when it IS the start of the week", () => {
    // The zero-offset boundary. `-((day - start + 7) % 7 || 7)` reads as a
    // reasonable way to write this and sends a Monday back to the Monday
    // before, losing a whole week of entries off the top of the grid.
    expect(startOfWeek("2026-09-07")).toBe("2026-09-07");
    expect(startOfWeek("2026-09-06", WEEK_DAY_NUMBERS.SUNDAY)).toBe("2026-09-06");
  });

  it("treats a Sunday as the END of the Monday week, not the start of the next", () => {
    // The off-by-one that matters most: with a Monday start, Sunday belongs
    // to the week that has just finished. Getting this wrong moves one day's
    // hours into the following week's invoice.
    expect(startOfWeek("2026-09-13")).toBe("2026-09-07");
    expect(startOfWeek("2026-09-14")).toBe("2026-09-14");
  });

  it("honours a Sunday-to-Saturday week", () => {
    expect(startOfWeek("2026-09-08", WEEK_DAY_NUMBERS.SUNDAY)).toBe("2026-09-06");
    expect(startOfWeek("2026-09-12", WEEK_DAY_NUMBERS.SUNDAY)).toBe("2026-09-06");
    expect(startOfWeek("2026-09-13", WEEK_DAY_NUMBERS.SUNDAY)).toBe("2026-09-13");
  });

  it("throws on a malformed date", () => {
    expect(() => startOfWeek("2026-02-30")).toThrow(/Not a calendar date/);
  });
});

describe("weekDates", () => {
  it("gives seven ascending dates starting on the week start", () => {
    const dates = weekDates("2026-09-08");

    expect(dates).toHaveLength(DAYS_IN_WEEK);
    expect(dates).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
  });

  it("spans a month boundary without repeating or skipping a day", () => {
    // Monday 31 August 2026 into September. An implementation that built the
    // week by holding the month and walking the day number would produce
    // 2026-08-32.
    expect(weekDates("2026-09-02")).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });

  it("spans a year boundary, and the year changes mid-week", () => {
    // 1 January 2026 was a Thursday, so the week it belongs to starts in
    // 2025. A grid keyed on the year of the week START would file three of
    // these days under the wrong year.
    expect(weekDates("2026-01-01")).toEqual([
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
  });

  it("includes 29 February in a leap week", () => {
    // 2024-02-29 was a Thursday. This is the case a month-arithmetic
    // implementation gets wrong in the direction that is hardest to see: it
    // produces seven valid-looking dates with 1 March where 29 February
    // should be, and only one year in four.
    expect(weekDates("2024-02-29")).toEqual([
      "2024-02-26",
      "2024-02-27",
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
      "2024-03-02",
      "2024-03-03",
    ]);
  });

  it("gives the SAME seven dates for every day of that week", () => {
    // The property the timesheet relies on: "the week containing this date"
    // must not depend on which day of it the person clicked. Any drift shows
    // up here as two different weeks for one week's dates.
    const expected = weekDates("2026-09-07");

    for (const date of expected) {
      expect(weekDates(date), date).toEqual(expected);
    }
  });

  it("gives the same seven dates for every day of a week that straddles a year", () => {
    const expected = weekDates("2025-12-29");

    for (const date of expected) {
      expect(weekDates(date), date).toEqual(expected);
    }
  });

  it("stays seven consecutive days for a Sunday-start week", () => {
    const dates = weekDates("2026-09-08", WEEK_DAY_NUMBERS.SUNDAY);

    expect(dates).toEqual([
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
    ]);
    expect(weekDayOf(dates[0])).toBe(WEEK_DAY_NUMBERS.SUNDAY);
  });

  it("is every weekday exactly once, whichever day the week starts on", () => {
    // Seven cells, seven distinct days. A duplicate would silently show one
    // day's hours twice and hide another day's entirely.
    for (const weekStartsOn of Object.values(WEEK_DAY_NUMBERS)) {
      const days = weekDates("2026-09-08", weekStartsOn).map(weekDayOf);

      expect(new Set(days).size, `start ${weekStartsOn}`).toBe(DAYS_IN_WEEK);
      expect(days[0], `start ${weekStartsOn}`).toBe(weekStartsOn);
    }
  });

  it("throws on a malformed date rather than returning seven wrong columns", () => {
    expect(() => weekDates("2026-02-31")).toThrow(/Not a calendar date/);
  });
});

describe("budgetProgress", () => {
  it("reports a budget that is part spent", () => {
    expect(budgetProgress(600, 300)).toEqual({
      budgetMinutes: 600,
      loggedMinutes: 300,
      remainingMinutes: 300,
      overMinutes: 0,
      percentUsed: 50,
      barPercent: 50,
      isOverBudget: false,
    });
  });

  it("does NOT call a budget spent to the minute an overrun", () => {
    // The boundary. `remaining <= 0` reads as the same rule and paints a
    // project that landed exactly on its estimate red, which is the one case
    // the plan got right.
    const onBudget = budgetProgress(600, 600);

    expect(onBudget.remainingMinutes).toBe(0);
    expect(onBudget.overMinutes).toBe(0);
    expect(onBudget.percentUsed).toBe(100);
    expect(onBudget.isOverBudget).toBe(false);
  });

  it("reports an overrun as a positive number, and fills the bar without overflowing it", () => {
    // `percentUsed` may exceed 100 because the label says 140%; `barPercent`
    // may not, because it is a width. Collapsing the two either clips the
    // truth or draws a bar out of its container.
    const over = budgetProgress(600, 840);

    expect(over.remainingMinutes).toBe(-240);
    expect(over.overMinutes).toBe(240);
    expect(over.percentUsed).toBe(140);
    expect(over.barPercent).toBe(100);
    expect(over.isOverBudget).toBe(true);
  });

  it("says nothing rather than everything when there is no budget", () => {
    // A budget of nought is a group nobody has planned yet, not a group that
    // has spent all of nothing. Dividing gives Infinity, and guarding that
    // to 100 gives a full red bar which blames the person who did the work
    // for the omission of the person who planned it.
    const unplanned = budgetProgress(0, 120);

    expect(unplanned.remainingMinutes).toBeNull();
    expect(unplanned.percentUsed).toBeNull();
    expect(unplanned.barPercent).toBe(0);
    expect(unplanned.overMinutes).toBe(0);
    expect(unplanned.isOverBudget).toBe(false);
    // The logged time is still reported. It is the one true figure there is.
    expect(unplanned.loggedMinutes).toBe(120);
  });

  it("shows an EMPTY bar for a zero budget, at every amount logged", () => {
    // Number.isFinite alone was not enough here, and the gap is worth
    // naming: the wrong implementation the test above warns about - guarding
    // the division by zero to 100 - returns a finite 100 and passed. So the
    // bar is pinned to 0 rather than merely to "a number".
    //
    // Which end it pins to is the whole point. A full red bar on an
    // unplanned project blames whoever did the work for the omission of
    // whoever planned it, and the figure is not even wrong-but-close: there
    // is no budget to be a percentage of.
    for (const logged of [0, 1, 100_000]) {
      const rollup = budgetProgress(0, logged);

      expect(rollup.barPercent, `${logged} logged`).toBe(0);
      expect(rollup.percentUsed, `${logged} logged`).toBeNull();
      expect(rollup.isOverBudget, `${logged} logged`).toBe(false);
      // Still reported, because it is the one true figure there is.
      expect(rollup.loggedMinutes, `${logged} logged`).toBe(logged);
    }
  });

  it("rounds the percentage to ONE decimal place, in one place", () => {
    // 1 minute of 7 is 14.285714...%, which renders as 14.285714285714286 in
    // one component and 14.3 in another unless it is rounded here. Rounding
    // to a whole number instead would make two groups that differ show the
    // same figure.
    expect(budgetProgress(7, 1).percentUsed).toBe(14.3);
    expect(budgetProgress(900, 600).percentUsed).toBe(66.7);
    expect(budgetProgress(3, 1).percentUsed).toBe(33.3);
  });

  it("treats negative minutes as none rather than as credit", () => {
    // Neither figure can be negative in the database. If one ever arrives
    // that way, a negative percentage and a negative bar width are worse
    // than a zero.
    expect(budgetProgress(600, -30).loggedMinutes).toBe(0);
    expect(budgetProgress(-600, 30).percentUsed).toBeNull();
  });

  it("rounds fractional minutes before doing anything with them", () => {
    expect(budgetProgress(600.4, 300.6).budgetMinutes).toBe(600);
    expect(budgetProgress(600.4, 300.6).loggedMinutes).toBe(301);
  });
});

describe("rateValueCents", () => {
  it("values an hour at the hourly rate", () => {
    expect(rateValueCents(60, 15_000)).toBe(15_000);
    expect(rateValueCents(90, 15_000)).toBe(22_500);
    expect(rateValueCents(20, 15_000)).toBe(5_000);
  });

  it("is nought for no time, not null", () => {
    // Nobody worked, so it is worth nothing - which is a known figure, unlike
    // an unknown rate.
    expect(rateValueCents(0, 15_000)).toBe(0);
  });

  it("rounds to the cent rather than truncating", () => {
    // 7 minutes at $123.50 an hour is 1440.83 cents. Truncation loses a cent
    // a line, which is the difference an invoice gets queried over.
    expect(rateValueCents(7, 12_350)).toBe(1_441);
    expect(rateValueCents(1, 10_000)).toBe(167);
  });

  it("answers NULL for a null rate, never nought", () => {
    // THE ONE WRONG ANSWER THAT LOOKS LIKE GOOD NEWS. A cost of nought makes
    // the margin 100%, so an unmodelled cost rate has to stay unknown all
    // the way to the screen.
    expect(rateValueCents(600, null)).toBeNull();
    expect(rateValueCents(0, null)).toBeNull();
  });

  it("values each line separately, which is what an invoice adds up", () => {
    // Three 1-minute entries at $100 an hour are 167 cents each, 501 in
    // total, where valuing the 3 minutes together gives 500. The per-line
    // figure is the one shown, so the total has to be the sum of the lines
    // or the invoice does not add up on the page.
    const lines = [1, 1, 1].map((minutes) => rateValueCents(minutes, 10_000));

    expect(lines).toEqual([167, 167, 167]);
    expect(lines.reduce<number>((total, line) => total + (line ?? 0), 0)).toBe(501);
    expect(rateValueCents(3, 10_000)).toBe(500);
  });
});

describe("marginCents", () => {
  it("is revenue less cost", () => {
    expect(marginCents(15_000, 9_000)).toBe(6_000);
  });

  it("keeps a negative margin negative", () => {
    // A job sold below cost is the figure most worth seeing. Clamping it at
    // nought would hide exactly the projects the report exists for.
    expect(marginCents(9_000, 15_000)).toBe(-6_000);
  });

  it("is null when either side is unknown", () => {
    expect(marginCents(15_000, null)).toBeNull();
    expect(marginCents(null, 9_000)).toBeNull();
    expect(marginCents(null, null)).toBeNull();
  });

  it("stays unknown all the way through when a cost rate is not recorded", () => {
    // The two functions composed, which is how the report actually uses
    // them: no cost rate means an unvalued cost, and an unvalued cost means
    // an unknown margin - NOT a margin equal to the whole charge.
    const charge = rateValueCents(600, 15_000);
    const cost = rateValueCents(600, null);

    expect(cost).toBeNull();
    expect(marginCents(charge, cost)).toBeNull();
    expect(marginCents(charge, cost)).not.toBe(charge);
  });
});

describe("rate fields refuse null rather than reading it as nought", () => {
  const base = { userId: "u".repeat(32), band: RATE_BANDS.STANDARD, effectiveFrom: "2026-07-01" };

  // THIS WAS A LIVE BUG, found by rendering the rates screen against the
  // schema. z.coerce.number() runs Number(), and Number(null) is 0 - so a
  // caller sending null to mean "no cost recorded", which is the obvious
  // spelling for anybody writing JSON rather than filling in a form, stored
  // the cost as $0.00 and reported 100% margin on every hour that person
  // worked. On the charge side it recorded the work as free.
  //
  // Neither reads as broken. Both are plausible figures sitting beside
  // correct ones, which is the failure this whole module is written around.

  it("refuses a null cost rate", () => {
    expect(SetUserRateSchema.safeParse({ ...base, chargeRate: 150, costRate: null }).success).toBe(false);
  });

  it("refuses a null charge rate", () => {
    expect(SetUserRateSchema.safeParse({ ...base, chargeRate: null, costRate: "" }).success).toBe(false);
  });

  it('still reads "" as not recorded, which is what an empty box sends', () => {
    const parsed = SetUserRateSchema.safeParse({ ...base, chargeRate: 150, costRate: "" });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.costRate).toBeNull();
  });

  it("still accepts a REAL zero, which means the work genuinely costs nothing", () => {
    // The point is to tell absence from nought, not to ban nought. An
    // unpaid intern has a cost rate of 0 and that is a fact about them.
    const parsed = SetUserRateSchema.safeParse({ ...base, chargeRate: 150, costRate: 0 });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.costRate).toBe(0);
  });

  it("converts dollars to cents, so nothing downstream multiplies", () => {
    const parsed = SetUserRateSchema.safeParse({ ...base, chargeRate: "12.50", costRate: "" });

    expect(parsed.success && parsed.data.chargeRate).toBe(1250);
  });
});

// -------------------------------------------------------------------
// ===================================================================
// THE PATCH SCHEMAS
// ===================================================================
//
// THE SILENT-FAILURE CLASS THIS FILE IS ABOUT, in its purest form. A schema
// that turns an ABSENT field into NULL deletes what somebody wrote and
// reports success: the request was valid, the write happened, the toast said
// saved, and the note is gone. Nobody re-reads a description or an invoice
// narrative until they need it, so the gap between losing it and finding out
// is weeks.
//
// So each block below asserts the SAME THREE PROPERTIES, and they only mean
// anything together:
//
//   1. an absent field is ABSENT from the parsed output, not null,
//   2. an empty string survives as a CLEAR, which is null,
//   3. a real value passes through.
//
// EACH WAS CHECKED AGAINST THE WRONG IMPLEMENTATION - the required field
// these schemas used to have, which parses `{ id }` into `{ id, notes: null
// }`. Only (1) catches it. A test asserting `toBeNull()` on the cleared case
// passes against the bug it is meant to catch, and so does a test asserting
// that the parse merely succeeds - which is why every absent case below
// tests the KEY with `Object.hasOwn` rather than the value.
//
// The distinction is load-bearing the whole way down: Kysely drops an
// `undefined` out of a `set()` object, so an absent key never reaches the
// SQL, while a null is written.
// -------------------------------------------------------------------

const TASK_ID = "t".repeat(32);
const USER_ID = "u".repeat(32);
const CLIENT_ID = "c".repeat(32);
const ENTRY_ID = "e".repeat(32);

describe("UpdateTaskSchema is a patch", () => {
  it("leaves out every field the payload left out", () => {
    // THE TEST THE OLD SCHEMA FAILS. It required `title` and `description`,
    // so this payload did not parse at all - and the shape that made it
    // parse, a description posted from a form that never had one, is the
    // bug: a board card carries no description on purpose.
    const parsed = UpdateTaskSchema.parse({ taskId: TASK_ID });

    expect(parsed).toEqual({ taskId: TASK_ID });
    expect(Object.hasOwn(parsed, "title")).toBe(false);
    expect(Object.hasOwn(parsed, "description")).toBe(false);
    expect(Object.hasOwn(parsed, "assigneeId")).toBe(false);
  });

  it("tells an absent description from a cleared one", () => {
    // The pair side by side, because neither half proves anything alone.
    const untouched = UpdateTaskSchema.parse({ taskId: TASK_ID });
    const cleared = UpdateTaskSchema.parse({ taskId: TASK_ID, description: "" });

    expect(Object.hasOwn(untouched, "description")).toBe(false);
    expect(Object.hasOwn(cleared, "description")).toBe(true);
    expect(cleared.description).toBeNull();
  });

  it("clears on whitespace too, because a box holding a space is empty", () => {
    expect(UpdateTaskSchema.parse({ taskId: TASK_ID, description: "   " }).description).toBeNull();
  });

  it("passes a real description through, trimmed", () => {
    const parsed = UpdateTaskSchema.parse({ taskId: TASK_ID, description: "  Rewrite the import  " });

    expect(parsed.description).toBe("Rewrite the import");
  });

  it("refuses null for a description, so a caller with none omits the field", () => {
    // null is the spelling a caller reaches for when it has no value to
    // send, and reading it as "delete what is stored" is the bug. Refused
    // here so the validator says so as loudly as the compiler does.
    expect(UpdateTaskSchema.safeParse({ taskId: TASK_ID, description: null }).success).toBe(false);
  });

  it("still refuses an empty title, because a title that is present is being changed", () => {
    // Optional is not permissive: not sending a title keeps it, sending a
    // blank one is somebody emptying a field that cannot be empty.
    expect(UpdateTaskSchema.safeParse({ taskId: TASK_ID, title: "   " }).success).toBe(false);
    expect(UpdateTaskSchema.parse({ taskId: TASK_ID, title: " Import  " }).title).toBe("Import");
  });

  it("keeps null on assigneeId, because unassigning is a real edit", () => {
    // The one field where null is a VALUE rather than a refusal - there is
    // no empty-string spelling of "nobody" - so all three states are live.
    const unassigned = UpdateTaskSchema.parse({ taskId: TASK_ID, assigneeId: null });
    const assigned = UpdateTaskSchema.parse({ taskId: TASK_ID, assigneeId: USER_ID });

    expect(Object.hasOwn(unassigned, "assigneeId")).toBe(true);
    expect(unassigned.assigneeId).toBeNull();
    expect(assigned.assigneeId).toBe(USER_ID);
  });

  it("carries no estimate, however the payload spells one", () => {
    // `estimate_changes` is append-only, so every estimate change goes
    // through AdjustTaskEstimateSchema. An estimate arriving on the ordinary
    // edit would leave the number right and the record of how it moved
    // missing, which is the case the log exists for.
    const parsed = UpdateTaskSchema.parse({ taskId: TASK_ID, estimateHours: 8, estimateMinutes: 480 });

    expect(Object.hasOwn(parsed, "estimateHours")).toBe(false);
    expect(Object.hasOwn(parsed, "estimateMinutes")).toBe(false);
  });

  it("types an edit that changes one field and says nothing about the rest", () => {
    // A compile-time assertion as much as a runtime one: if any editable
    // field goes back to being required, this stops building.
    const patch: UpdateTaskRequestDTO = { taskId: TASK_ID, description: null };

    expect(patch.description).toBeNull();
  });
});

describe("UpdateTimeEntrySchema is a patch", () => {
  it("leaves out every field the payload left out", () => {
    // A timesheet cell shows a TOTAL and holds no note. Under the old
    // schema, correcting an hour from one posted an empty note box and
    // deleted the narrative a client's invoice is written from.
    const parsed = UpdateTimeEntrySchema.parse({ timeEntryId: ENTRY_ID });

    expect(parsed).toEqual({ timeEntryId: ENTRY_ID });
    expect(Object.hasOwn(parsed, "notes")).toBe(false);
    expect(Object.hasOwn(parsed, "hours")).toBe(false);
    expect(Object.hasOwn(parsed, "workDate")).toBe(false);
  });

  it("tells an absent note from a cleared one", () => {
    const untouched = UpdateTimeEntrySchema.parse({ timeEntryId: ENTRY_ID, hours: 1 });
    const cleared = UpdateTimeEntrySchema.parse({ timeEntryId: ENTRY_ID, hours: 1, notes: "" });

    expect(Object.hasOwn(untouched, "notes")).toBe(false);
    expect(Object.hasOwn(cleared, "notes")).toBe(true);
    expect(cleared.notes).toBeNull();
  });

  it("passes a real note through, trimmed", () => {
    const parsed = UpdateTimeEntrySchema.parse({ timeEntryId: ENTRY_ID, notes: "  Onsite workshop  " });

    expect(parsed.notes).toBe("Onsite workshop");
  });

  it("refuses null for a note", () => {
    expect(UpdateTimeEntrySchema.safeParse({ timeEntryId: ENTRY_ID, notes: null }).success).toBe(false);
  });

  it("leaves the work date out when nobody moved the day", () => {
    // The service re-resolves the captured rate snapshot ONLY when the day
    // moves. An edit that never mentions the day cannot restate an hour at
    // today's rate, which is what a required workDate risked every time
    // somebody fixed a typo in a note.
    const parsed = UpdateTimeEntrySchema.parse({ timeEntryId: ENTRY_ID, notes: "Fixed the spelling" });

    expect(Object.hasOwn(parsed, "workDate")).toBe(false);
  });

  it("still converts hours to minutes, and still bounds them, when they are sent", () => {
    // Optional does not mean unchecked: the conversion still happens once,
    // at the boundary, and every bound still applies.
    expect(UpdateTimeEntrySchema.parse({ timeEntryId: ENTRY_ID, hours: 1.5 }).hours).toBe(90);
    // 0.004 hours rounds to nought minutes, which violates minutes > 0.
    expect(UpdateTimeEntrySchema.safeParse({ timeEntryId: ENTRY_ID, hours: 0.004 }).success).toBe(false);
    expect(UpdateTimeEntrySchema.safeParse({ timeEntryId: ENTRY_ID, workDate: "2026-02-31" }).success).toBe(false);
  });

  it("types an edit that moves the day and says nothing about the note", () => {
    const patch: UpdateTimeEntryRequestDTO = { timeEntryId: ENTRY_ID, workDate: "2026-06-15" };

    expect(patch.workDate).toBe("2026-06-15");
  });
});

describe("UpdateClientSchema is a patch", () => {
  it("restores a client without touching its name or its notes", () => {
    // THE BUG THIS CLOSES. ClientSummaryDTO - what the client LIST holds -
    // carries no notes, so restoring from that list used to post
    // `notes: null` beside the name and wrote NULL over whatever was stored.
    const parsed = UpdateClientSchema.parse({ clientId: CLIENT_ID, isActive: true });

    expect(parsed).toEqual({ clientId: CLIENT_ID, isActive: true });
    expect(Object.hasOwn(parsed, "notes")).toBe(false);
    expect(Object.hasOwn(parsed, "name")).toBe(false);
  });

  it("renames a client without touching its status or its notes", () => {
    const parsed = UpdateClientSchema.parse({ clientId: CLIENT_ID, name: "  Perks  " });

    expect(parsed).toEqual({ clientId: CLIENT_ID, name: "Perks" });
    expect(Object.hasOwn(parsed, "isActive")).toBe(false);
    expect(Object.hasOwn(parsed, "notes")).toBe(false);
  });

  it("tells an absent note from a cleared one", () => {
    const untouched = UpdateClientSchema.parse({ clientId: CLIENT_ID, name: "Perks" });
    const cleared = UpdateClientSchema.parse({ clientId: CLIENT_ID, name: "Perks", notes: "" });

    expect(Object.hasOwn(untouched, "notes")).toBe(false);
    expect(Object.hasOwn(cleared, "notes")).toBe(true);
    expect(cleared.notes).toBeNull();
  });

  it("passes a real note through, and refuses null", () => {
    expect(UpdateClientSchema.parse({ clientId: CLIENT_ID, notes: " Pays on 30 days " }).notes).toBe(
      "Pays on 30 days",
    );
    expect(UpdateClientSchema.safeParse({ clientId: CLIENT_ID, notes: null }).success).toBe(false);
  });

  it("still refuses an empty name", () => {
    expect(UpdateClientSchema.safeParse({ clientId: CLIENT_ID, name: "  " }).success).toBe(false);
  });

  it("types the restore, which is the narrowest edit on that screen", () => {
    const patch: UpdateClientRequestDTO = { clientId: CLIENT_ID, isActive: true };

    expect(patch.isActive).toBe(true);
  });
});

describe("a create still takes null for a text field it has no box for", () => {
  it("accepts a null note on a create, where there is nothing to overwrite", () => {
    // Every action is typed on its Request (output) DTO, so a component
    // holds `string | null` and posts back what it is holding. This was
    // refused as "expected string, received null" - a validation failure on
    // a form with no note field to report it against.
    const parsed = CreateClientSchema.parse({ name: "Perks", notes: null });

    expect(parsed.notes).toBeNull();
  });

  it("still reads an omitted note and an empty one as the same absence", () => {
    // On a CREATE all three spellings mean one thing, because there is no
    // stored value for them to differ about. That is exactly why the patch
    // builder cannot reuse this one.
    expect(CreateClientSchema.parse({ name: "Perks" }).notes).toBeNull();
    expect(CreateClientSchema.parse({ name: "Perks", notes: "  " }).notes).toBeNull();
  });
});

describe("TimesheetCellDTO carries enough to edit an entry", () => {
  it("holds each entry's id, minutes and note", () => {
    // A compile-time assertion first: a cell that carried only ids could not
    // fill an edit form in, which is why the dialog behind it could offer
    // nothing but "clear the day and type it again".
    const cell: TimesheetCellDTO = {
      date: "2026-06-15",
      minutes: 90,
      entries: [
        { id: "entry-1", minutes: 60, notes: "Drafted the report" },
        { id: "entry-2", minutes: 30, notes: null },
      ],
    };

    // The ids are still one per entry, so nothing needs a parallel array of
    // them - two lists that have to agree is how they stop agreeing.
    expect(cell.entries.map((entry) => entry.id)).toEqual(["entry-1", "entry-2"]);
    expect(cell.entries.reduce((total, entry) => total + entry.minutes, 0)).toBe(cell.minutes);
    // An entry with no note is null and never "", which is the single
    // spelling of absence the schemas above write.
    expect(cell.entries[1].notes).toBeNull();
  });

  it("never carries money", () => {
    // ENFORCED BY THE COMPILER rather than by review: a client's rate card
    // must not reach everybody who can open a timesheet, which is the line
    // TimeEntryDTO holds. If a rate is ever added to this DTO, the directive
    // below stops suppressing anything and the build fails here.
    // @ts-expect-error - a cell entry must never carry a rate or a value.
    const withRate: TimesheetCellEntryDTO = { id: "entry-1", minutes: 60, notes: null, chargeRateCents: 15_000 };

    expect(withRate.id).toBe("entry-1");
  });
});

// -------------------------------------------------------------------
// THE FOURTH AND LAST OF THE UPDATE SCHEMAS TO STOP REPLACING.
//
// It was the only one still requiring every field, and that had two
// consequences worth separating.
//
// The obvious one: nothing could edit a project. updateProjectAction existed
// with no caller anywhere in the app, so a title, description and billable
// flag were whatever the create form was given, permanently.
//
// The less obvious one: it forced ArchiveProjectSchema into existence. That
// schema's own note said archiving through a whole-row update meant "posting
// a whole form back, and a stale one quietly reverts somebody else's edit" -
// which was true, and was a property of THIS shape rather than of archiving.
// A patch cannot revert a field it does not mention.
//
// Every absent case asserts the KEY with Object.hasOwn rather than the
// value, because a toBeNull() assertion on the cleared case passes against
// the very bug it is meant to catch: undefined and null both read as
// "nothing there" to an equality check, and only one of them stops the
// column reaching the UPDATE.
// -------------------------------------------------------------------
describe("UpdateProjectSchema is a patch", () => {
  const PROJECT_ID = "p".repeat(32);

  it("leaves out every field the payload left out", () => {
    const parsed = UpdateProjectSchema.parse({ projectId: PROJECT_ID });

    expect(parsed).toEqual({ projectId: PROJECT_ID });
    expect(Object.hasOwn(parsed, "title")).toBe(false);
    expect(Object.hasOwn(parsed, "description")).toBe(false);
    expect(Object.hasOwn(parsed, "isBillable")).toBe(false);
    expect(Object.hasOwn(parsed, "status")).toBe(false);
  });

  it("tells an absent description from a cleared one", () => {
    // The pair side by side, because neither half proves anything alone.
    // Absent must not reach the UPDATE at all; cleared must reach it as
    // NULL. One assertion on either would pass with both behaving the same.
    const untouched = UpdateProjectSchema.parse({ projectId: PROJECT_ID, title: "Data platform" });
    const cleared = UpdateProjectSchema.parse({
      projectId: PROJECT_ID,
      title: "Data platform",
      description: "",
    });

    expect(Object.hasOwn(untouched, "description")).toBe(false);
    expect(Object.hasOwn(cleared, "description")).toBe(true);
    expect(cleared.description).toBeNull();
  });

  it("takes a status on its own, which is what un-archiving is", () => {
    // Restoring an archived project is an edit rather than an act of its
    // own, and this is the payload the edit dialog sends for it: one field,
    // so nothing else about the project can be reverted on the way.
    const parsed = UpdateProjectSchema.parse({ projectId: PROJECT_ID, status: "active" });

    expect(parsed.status).toBe("active");
    expect(Object.hasOwn(parsed, "title")).toBe(false);
    expect(Object.hasOwn(parsed, "isBillable")).toBe(false);
  });

  it("takes the billable flag on its own, false included", () => {
    // `false` is the value most likely to be lost by a careless truthiness
    // check somewhere between here and the repository.
    const parsed = UpdateProjectSchema.parse({ projectId: PROJECT_ID, isBillable: false });

    expect(parsed.isBillable).toBe(false);
    expect(Object.hasOwn(parsed, "status")).toBe(false);
  });

  it("still refuses an empty title when one IS sent", () => {
    // Optional means "may be absent", never "may be blank". A project with
    // no title is unusable in every picker it appears in.
    expect(UpdateProjectSchema.safeParse({ projectId: PROJECT_ID, title: "   " }).success).toBe(false);
  });

  it("refuses a status it does not recognise", () => {
    expect(UpdateProjectSchema.safeParse({ projectId: PROJECT_ID, status: "paused" }).success).toBe(false);
  });
});

// -------------------------------------------------------------------
// ALL THREE BANDS, ONE DATE.
//
// The schema behind the rates form that replaced three passes over one
// decision. Two properties carry the whole design and both are asserted on
// the KEY rather than the value, because an absent band and a band priced at
// nothing are the difference between leaving a rate alone and destroying it.
// -------------------------------------------------------------------
describe("SetUserRatesSchema", () => {
  const USER_ID = "u".repeat(32);

  it("leaves out a band the payload did not mention", () => {
    // What makes the form usable as an EDIT: raising the standard rate must
    // not blank the two bands nobody opened.
    const parsed = SetUserRatesSchema.parse({
      userId: USER_ID,
      effectiveFrom: "2026-07-01",
      bands: { standard: { chargeRate: "110", costRate: "60" } },
    });

    expect(Object.hasOwn(parsed.bands, "standard")).toBe(true);
    expect(Object.hasOwn(parsed.bands, "discounted")).toBe(false);
    expect(Object.hasOwn(parsed.bands, "high")).toBe(false);
  });

  it("converts dollars to integer cents, per band", () => {
    const parsed = SetUserRatesSchema.parse({
      userId: USER_ID,
      effectiveFrom: "2026-07-01",
      bands: {
        discounted: { chargeRate: "90.50", costRate: "50" },
        high: { chargeRate: "150", costRate: "" },
      },
    });

    expect(parsed.bands.discounted?.chargeRate).toBe(9050);
    expect(parsed.bands.discounted?.costRate).toBe(5000);
    expect(parsed.bands.high?.chargeRate).toBe(15000);
  });

  it("reads an empty cost box as NULL, never nought", () => {
    // Nought says the work was free and reports 100% margin. Null says
    // nobody has recorded a cost. Both assertions, because toBeNull() alone
    // passes against undefined too.
    const parsed = SetUserRatesSchema.parse({
      userId: USER_ID,
      effectiveFrom: "2026-07-01",
      bands: { high: { chargeRate: "150", costRate: "" } },
    });

    expect(parsed.bands.high?.costRate).toBeNull();
    expect(parsed.bands.high?.costRate).not.toBe(0);
  });

  it("refuses a band with a cost and no charge, rather than dropping it", () => {
    // The form deliberately SENDS this case instead of tidying it away,
    // because omitting it would discard an amount somebody typed and report
    // success. The refusal has to land on the charge box.
    const result = SetUserRatesSchema.safeParse({
      userId: USER_ID,
      effectiveFrom: "2026-07-01",
      bands: { standard: { chargeRate: "", costRate: "60" } },
    });

    expect(result.success).toBe(false);
  });

  it("refuses a payload with no bands at all", () => {
    // A person and a date and no rates is not an edit - it is a form
    // somebody saved without typing anything, and a silent success would
    // have them believe a rate was set.
    const result = SetUserRatesSchema.safeParse({
      userId: USER_ID,
      effectiveFrom: "2026-07-01",
      bands: {},
    });

    expect(result.success).toBe(false);
  });

  it("requires the date, which is the field three separate saves could not share", () => {
    const result = SetUserRatesSchema.safeParse({
      userId: USER_ID,
      bands: { standard: { chargeRate: "110", costRate: "60" } },
    });

    expect(result.success).toBe(false);
  });
});

// -------------------------------------------------------------------
// A CHARGE RATE OF NOUGHT SAYS THE WORK WAS FREE.
//
// This is the third spelling of "nothing" to reach `dollarsField` and be
// read as a number, after null and after the union branch that made
// optionalDollarsField look like it refused null when it did not. All three
// arrive by the same mechanism: z.coerce.number() runs Number(), and
// Number(null), Number("") and Number("  ") are every one of them 0.
//
// The danger is not a crash. It is a row that renders as a working rate, at
// $0.00, beside rates that are right - which is the failure this whole
// module is written around. Kept as its own block because it is about the
// FIELD rather than any one schema that uses it, and the next schema to use
// it inherits whatever this proves.
// -------------------------------------------------------------------
describe("a money field refuses every spelling of nothing", () => {
  const USER_ID = "u".repeat(32);

  const parseCharge = (chargeRate: unknown) =>
    SetUserRatesSchema.safeParse({
      userId: USER_ID,
      effectiveFrom: "2026-07-01",
      bands: { standard: { chargeRate, costRate: "" } },
    });

  it.each([
    ["an empty string", ""],
    ["whitespace", "   "],
    ["null", null],
    ["undefined", undefined],
  ])("refuses %s rather than storing $0.00", (_label, value) => {
    expect(parseCharge(value).success).toBe(false);
  });

  it("still accepts a genuine nought, because free work is a real answer", () => {
    // The point is not that nought is forbidden - somebody may genuinely be
    // charged nothing - it is that BLANK must not silently become nought.
    // Typing 0 is a decision; leaving the box empty is not.
    const result = parseCharge("0");

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.bands.standard?.chargeRate).toBe(0);
  });

  it("keeps the empty COST box meaning null, which is the opposite rule", () => {
    // optionalDollarsField is a union that tries z.literal("") first, so
    // empty means absent there and refused for a charge rate. If a change
    // to the shared field ever broke this, margin would start reading as
    // 100% instead of unknown.
    const result = SetUserRatesSchema.safeParse({
      userId: USER_ID,
      effectiveFrom: "2026-07-01",
      bands: { standard: { chargeRate: "110", costRate: "  " } },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bands.standard?.costRate).toBeNull();
      expect(result.data.bands.standard?.costRate).not.toBe(0);
    }
  });
});
