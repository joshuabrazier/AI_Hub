import { differenceInMinutes } from "date-fns";
import { describe, expect, it } from "vitest";

import { sessionStartsAt } from "./timezone";

// These assertions are deliberately independent of the machine timezone: that
// independence is the whole point of the fix. The old code used parseISO with
// no zone, so a session's instant depended on the server clock (UTC on Azure),
// which pushed the 12-hour make-up window ~9.5h off.
describe("sessionStartsAt", () => {
  it("resolves an Adelaide winter (ACST, UTC+9:30) wall-clock to the right UTC instant", () => {
    // 5:00 PM Adelaide in July = 07:30 UTC.
    expect(sessionStartsAt("2026-07-29", "17:00").toISOString()).toBe("2026-07-29T07:30:00.000Z");
  });

  it("handles daylight saving (ACDT, UTC+10:30)", () => {
    // 5:00 PM Adelaide in January = 06:30 UTC.
    expect(sessionStartsAt("2026-01-15", "17:00").toISOString()).toBe("2026-01-15T06:30:00.000Z");
  });

  it("accepts HH:MM:SS the same as HH:MM", () => {
    expect(sessionStartsAt("2026-07-29", "17:00:00").toISOString()).toBe(
      sessionStartsAt("2026-07-29", "17:00").toISOString(),
    );
  });
});

describe("12-hour make-up window uses the true instant", () => {
  // A session at 5:00 PM Adelaide (= 07:30 UTC in winter).
  const start = sessionStartsAt("2026-07-29", "17:00");

  it("is under 12h when cancelling 11h before the real start (no credit)", () => {
    const elevenHoursBefore = new Date("2026-07-28T20:30:00Z");
    expect(differenceInMinutes(start, elevenHoursBefore)).toBe(11 * 60);
    expect(differenceInMinutes(start, elevenHoursBefore) >= 12 * 60).toBe(false);
  });

  it("is 12h+ when cancelling 13h before the real start (earns a credit)", () => {
    const thirteenHoursBefore = new Date("2026-07-28T18:30:00Z");
    expect(differenceInMinutes(start, thirteenHoursBefore)).toBe(13 * 60);
    expect(differenceInMinutes(start, thirteenHoursBefore) >= 12 * 60).toBe(true);
  });
});
