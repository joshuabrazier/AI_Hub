import { describe, expect, it } from "vitest";

import {
  IDLE_CLOCK,
  durationSecondsOf,
  elapsedMs,
  elapsedSeconds,
  pauseClock,
  resumeClock,
  startClock,
} from "./elapsed-clock";

// -------------------------------------------------------------------
// The arithmetic behind the number stored as a recording's duration.
//
// Pure and parameterised on `now` precisely so this can be tested without
// faking timers - which is what makes the throttling case, the one that
// caused the bug, expressible at all.
// -------------------------------------------------------------------

describe("elapsed clock", () => {
  it("measures from the clock, not from how often it was asked", () => {
    // THE BUG THIS EXISTS FOR. A background tab's interval is throttled to
    // roughly once a minute, so a counter incremented per tick reported an
    // hour-long meeting as a handful of minutes. Reading the clock gives the
    // real answer no matter how rarely it is read.
    const clock = startClock(0);

    // One single reading, an hour later, having been asked nothing in between.
    expect(elapsedSeconds(clock, 3_600_000)).toBe(3600);
  });

  it("banks the running span when paused", () => {
    const paused = pauseClock(startClock(0), 5_000);

    expect(elapsedMs(paused, 5_000)).toBe(5_000);
  });

  it("does not advance while paused, however long it sits there", () => {
    const paused = pauseClock(startClock(0), 5_000);

    expect(elapsedMs(paused, 900_000)).toBe(5_000);
  });

  it("keeps the banked time across a resume", () => {
    // Five seconds, a two-minute pause, then three more seconds. The pause
    // must not count and the first five seconds must not be lost.
    const started = startClock(0);
    const paused = pauseClock(started, 5_000);
    const resumed = resumeClock(paused, 125_000);

    expect(elapsedMs(resumed, 128_000)).toBe(8_000);
  });

  it("survives several pause and resume cycles", () => {
    let clock = startClock(0);
    clock = pauseClock(clock, 10_000); // 10s recorded
    clock = resumeClock(clock, 40_000); // 30s paused, not counted
    clock = pauseClock(clock, 50_000); // 10s more recorded
    clock = resumeClock(clock, 100_000); // 50s paused, not counted
    clock = pauseClock(clock, 105_000); // 5s more recorded

    expect(elapsedMs(clock, 999_999)).toBe(25_000);
  });

  it("ignores a second pause rather than double-counting", () => {
    const once = pauseClock(startClock(0), 5_000);
    const twice = pauseClock(once, 60_000);

    expect(elapsedMs(twice, 60_000)).toBe(5_000);
  });

  it("ignores a resume on a running clock rather than dropping the span", () => {
    // Restarting the span instead would silently discard everything recorded
    // since the last resume.
    const running = startClock(0);
    const resumedAgain = resumeClock(running, 30_000);

    expect(elapsedMs(resumedAgain, 30_000)).toBe(30_000);
  });

  it("never goes backwards if the clock does", () => {
    // performance.now() is monotonic so this should not arise - but the
    // result becomes a stored duration, and a negative span would quietly
    // shorten a real meeting rather than failing visibly.
    const clock = startClock(10_000);

    expect(elapsedMs(clock, 9_000)).toBe(0);
  });

  it("reads zero before anything has started", () => {
    expect(elapsedMs(IDLE_CLOCK, 500_000)).toBe(0);
    expect(elapsedSeconds(IDLE_CLOCK, 500_000)).toBe(0);
  });

  it("floors the display and rounds the stored duration", () => {
    // A counter that jumped to 1 at 500ms would read a second ahead of the
    // recording all the way through; a stored duration that floored would be
    // consistently short. They want different things, so they are different
    // functions.
    const clock = startClock(0);

    expect(elapsedSeconds(clock, 1_800)).toBe(1);
    expect(durationSecondsOf(clock, 1_800)).toBe(2);
  });
});
