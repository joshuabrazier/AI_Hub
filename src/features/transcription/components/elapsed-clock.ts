// -------------------------------------------------------------------
// How long a recording has been running.
//
// WHY THIS IS NOT A COUNTER. The obvious implementation increments a number
// once a second from a setInterval, and it is wrong in a way that only
// shows up on the device this feature exists for. A background tab has its
// timers throttled to roughly once a minute, so a phone put down on a table
// reported an hour-long meeting as a couple of minutes - and that figure is
// what gets stored as the recording's duration and shown next to it forever
// afterwards. A number that is quietly wrong is worse than a spinner.
//
// So elapsed time is DERIVED from a clock reading rather than accumulated.
// A throttled tick renders late; it cannot count short.
//
// `now` is a parameter rather than read inside, for two reasons. It makes
// every function here pure and testable without faking timers, and it lets
// the caller choose the clock - which matters, because the right one is
// `performance.now()` rather than `Date.now()`. performance.now is
// monotonic: it keeps advancing while the page is backgrounded, and it does
// not jump when the system clock is corrected or the device crosses a
// timezone. Date.now does both, and either would make a meeting appear to
// change length while it was being recorded.
// -------------------------------------------------------------------

export type ElapsedClock = {
  /** Running time already completed, before the current span. */
  readonly bankedMs: number;
  /** When the current running span began. Meaningless while paused. */
  readonly startedAt: number;
  readonly running: boolean;
};

export const IDLE_CLOCK: ElapsedClock = { bankedMs: 0, startedAt: 0, running: false };

export function startClock(now: number): ElapsedClock {
  return { bankedMs: 0, startedAt: now, running: true };
}

// -------------------------------------------------------------------
// Pause: bank what the current span was worth, then stop counting.
//
// Banking BEFORE clearing the span is the whole of it. Forgetting that step
// is the classic version of this bug: the paused time is not lost visibly,
// it is lost silently, and the recording reports only whatever was recorded
// after the last resume.
//
// Pausing an already-paused clock returns it untouched rather than
// re-banking, so a repeated call cannot double-count.
// -------------------------------------------------------------------
export function pauseClock(clock: ElapsedClock, now: number): ElapsedClock {
  if (!clock.running) return clock;

  return { bankedMs: elapsedMs(clock, now), startedAt: 0, running: false };
}

// Resume: start a new span, keeping everything banked so far. Resuming an
// already-running clock is a no-op, so it cannot silently discard the span
// in progress by restarting it.
export function resumeClock(clock: ElapsedClock, now: number): ElapsedClock {
  if (clock.running) return clock;

  return { ...clock, startedAt: now, running: true };
}

// -------------------------------------------------------------------
// The elapsed total.
//
// The span is floored at zero. performance.now() is monotonic so it should
// never go backwards - but this value becomes a stored duration, and a
// negative span would silently shorten a real meeting rather than failing
// where somebody could see it.
// -------------------------------------------------------------------
export function elapsedMs(clock: ElapsedClock, now: number): number {
  const span = clock.running ? Math.max(0, now - clock.startedAt) : 0;

  return clock.bankedMs + span;
}

/** Floored, for a display that counts up rather than rounding to and fro. */
export function elapsedSeconds(clock: ElapsedClock, now: number): number {
  return Math.floor(elapsedMs(clock, now) / 1000);
}

/** Rounded, for the duration stored against the finished recording. */
export function durationSecondsOf(clock: ElapsedClock, now: number): number {
  return Math.round(elapsedMs(clock, now) / 1000);
}
