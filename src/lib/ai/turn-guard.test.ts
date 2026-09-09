import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTurnGuard, describeTurnFailure, type TurnSnapshot } from "./turn-guard";

// -------------------------------------------------------------------
// The behaviour here is entirely about TIME, so the clock is faked. Every
// case below either happened in production or is the regression that the
// obvious fix for one of those would have caused.
//
// The properties carried over from the flat stall guard this replaces are
// marked, because they are the ones a rewrite is most likely to lose: a
// productive stream must never be cut, and a silence before anything arrives
// must still be covered.
// -------------------------------------------------------------------

function abortError(): Error {
  const error = new Error("Request aborted");
  error.name = "AbortError";
  return error;
}

describe("createTurnGuard - deadlines", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does nothing until a phase is opened", () => {
    // A guard with no phase has nothing to bound. Arming on construction is
    // what put database reads and a whole compaction call on a budget named
    // after the model's first token.
    const guard = createTurnGuard();

    vi.advanceTimersByTime(600_000);

    expect(guard.signal.aborted).toBe(false);
  });

  it("aborts a duration phase that overruns", () => {
    const guard = createTurnGuard();
    guard.phase("compaction", 1_000);

    vi.advanceTimersByTime(1_001);

    expect(guard.signal.aborted).toBe(true);
    expect(guard.snapshot().timedOutPhase).toBe("compaction");
  });

  it("names the phase and its budget in the abort reason", () => {
    // The whole point. "nothing happened for 20 seconds" was the old
    // message, and the model had not been asked yet when it fired.
    const guard = createTurnGuard();
    guard.phase("compaction", 45_000);

    vi.advanceTimersByTime(45_001);

    expect((guard.signal.reason as Error).message).toBe('"compaction" did not finish within 45.0s.');
  });

  it("does NOT abort a productive idle phase, however long it runs", () => {
    // CARRIED OVER, and the regression a wall-clock deadline causes. A
    // full-length reply from this model streams for minutes; bounding its
    // total duration truncates exactly the answers worth waiting for.
    const guard = createTurnGuard();
    guard.phase("model-stream", 1_000, "idle");

    for (let elapsed = 0; elapsed < 60_000; elapsed += 900) {
      vi.advanceTimersByTime(900);
      guard.progress();
    }

    expect(guard.signal.aborted).toBe(false);
  });

  it("aborts an idle phase once the gap after the last sign of life is long enough", () => {
    // CARRIED OVER.
    const guard = createTurnGuard();
    guard.phase("model-stream", 1_000, "idle");

    vi.advanceTimersByTime(500);
    guard.progress();
    vi.advanceTimersByTime(500);

    expect(guard.signal.aborted).toBe(false);

    vi.advanceTimersByTime(501);

    expect(guard.signal.aborted).toBe(true);
  });

  it("covers the silence BEFORE anything arrives", () => {
    // CARRIED OVER. The longest silence in a model call is usually the wait
    // before it says anything, so a clock started by the first chunk would
    // never cover the window that actually fails.
    const guard = createTurnGuard();
    guard.phase("model-stream", 1_000, "idle");

    vi.advanceTimersByTime(1_001);

    expect(guard.signal.aborted).toBe(true);
  });

  it("does NOT let progress() extend a duration phase", () => {
    // A phase whose meaning depends on whether somebody happened to call
    // progress() is a phase nobody can reason about. Compaction gets a hard
    // ceiling; only a stream gets to earn more time by talking.
    const guard = createTurnGuard();
    guard.phase("compaction", 1_000);

    vi.advanceTimersByTime(900);
    guard.progress();
    vi.advanceTimersByTime(200);

    expect(guard.signal.aborted).toBe(true);
  });

  it("moves the deadline with the phase", () => {
    const guard = createTurnGuard();

    guard.phase("history", 1_000);
    vi.advanceTimersByTime(900);

    guard.phase("model-stream", 5_000, "idle");
    vi.advanceTimersByTime(4_000);

    // The history budget would have fired by now had it stayed armed.
    expect(guard.signal.aborted).toBe(false);

    vi.advanceTimersByTime(1_001);

    expect(guard.snapshot().timedOutPhase).toBe("model-stream");
  });

  it("stops timing once disposed", () => {
    // CARRIED OVER. A timer left armed fires into a finished request and
    // holds the event loop open for its whole window.
    const guard = createTurnGuard();
    guard.phase("model-stream", 1_000, "idle");

    guard.dispose();
    vi.advanceTimersByTime(10_000);

    expect(guard.signal.aborted).toBe(false);
  });

  it("ignores a phase opened after disposal", () => {
    const guard = createTurnGuard();
    guard.dispose();

    guard.phase("late", 1_000);
    vi.advanceTimersByTime(2_000);

    expect(guard.signal.aborted).toBe(false);
  });

  it("aborts when the reader goes away, and says it was the reader", () => {
    // CARRIED OVER. A closed tab is a second, independent reason to stop -
    // and it is not a fault.
    const reader = new AbortController();
    const guard = createTurnGuard(reader.signal);
    guard.phase("model-stream", 60_000, "idle");

    reader.abort();

    expect(guard.signal.aborted).toBe(true);
    expect(guard.snapshot().readerLeft).toBe(true);
    expect(guard.snapshot().timedOutPhase).toBeNull();
  });

  it("copes with a reader who left before the turn began", () => {
    // CARRIED OVER. The tab closed while the request was still being
    // validated, so the linked signal is already aborted on construction.
    const reader = new AbortController();
    reader.abort();

    const guard = createTurnGuard(reader.signal);

    expect(guard.signal.aborted).toBe(true);
    expect(guard.snapshot().readerLeft).toBe(true);
  });
});

describe("createTurnGuard - the timeline", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("records every phase that ran, in order", () => {
    const guard = createTurnGuard();

    guard.phase("session", 10_000);
    vi.advanceTimersByTime(100);
    guard.phase("history", 10_000);
    vi.advanceTimersByTime(300);
    guard.phase("compaction", 45_000);
    vi.advanceTimersByTime(19_600);

    const snapshot = guard.snapshot();

    expect(snapshot.phases.map((phase) => phase.name)).toEqual(["session", "history", "compaction"]);
    expect(snapshot.phases.map((phase) => phase.ms)).toEqual([100, 300, 19_600]);
  });

  it("reports the phase still open, because that is usually the interesting one", () => {
    const guard = createTurnGuard();
    guard.phase("model-stream", 60_000, "idle");
    vi.advanceTimersByTime(4_200);

    expect(guard.snapshot().currentPhase).toBe("model-stream");
    expect(guard.snapshot().phases.at(-1)?.ms).toBe(4_200);
  });

  it("carries notes alongside the timings", () => {
    const guard = createTurnGuard();
    guard.note("turns", 42);
    guard.note("compacted", true);

    expect(guard.snapshot().notes).toEqual({ turns: 42, compacted: true });
  });

  it("totals the whole turn, not just the phases", () => {
    const guard = createTurnGuard();

    vi.advanceTimersByTime(500);
    guard.phase("session", 10_000);
    vi.advanceTimersByTime(500);

    expect(guard.snapshot().totalMs).toBe(1_000);
  });
});

describe("describeTurnFailure", () => {
  function snapshot(overrides: Partial<TurnSnapshot> = {}): TurnSnapshot {
    return {
      totalMs: 21_000,
      currentPhase: "model-first-token",
      timedOutPhase: null,
      readerLeft: false,
      ceilingHit: false,
      phases: [
        { name: "session", ms: 120, budgetMs: 10_000, kind: "duration", timedOut: false },
        { name: "compaction", ms: 19_600, budgetMs: 45_000, kind: "duration", timedOut: false },
        { name: "model-first-token", ms: 1_280, budgetMs: 90_000, kind: "idle", timedOut: false },
      ],
      notes: {},
      ...overrides,
    };
  }

  it("answers the question the old message could not", () => {
    // "Nothing happened for 20 seconds" is an observation. This says what
    // WAS happening, which is the difference between a symptom and a cause.
    const described = describeTurnFailure(abortError(), snapshot({ timedOutPhase: "compaction" }));

    expect(described).toContain('"compaction" ran past its 45.0s budget');
    expect(described).toContain("compaction 19.6s");
    expect(described).toContain("session 0.1s");
  });

  it("names an idle phase as silence rather than as slowness", () => {
    const described = describeTurnFailure(abortError(), snapshot({ timedOutPhase: "model-first-token" }));

    expect(described).toContain('Nothing arrived while "model-first-token" was running, for 90.0s');
  });

  it("keeps the underlying cause, because the cause is the remedy", () => {
    // A socket timeout arriving alongside the phase name is the whole
    // answer; the phase alone says where, not what.
    const timeout = new Error(
      "@smithy/node-http-handler - the request socket timed out after 25000 ms of inactivity",
    );
    timeout.name = "TimeoutError";

    const described = describeTurnFailure(timeout, snapshot({ timedOutPhase: "model-first-token" }));

    // The package-name prefix is dropped: it tells a reader nothing they can
    // act on, and the whole meaning is in the rest of the sentence.
    expect(described).toContain(
      "Cause: TimeoutError: the request socket timed out after 25000 ms of inactivity",
    );
    expect(described).not.toContain("@smithy");
  });

  it("leaves a real model failure with its own name", () => {
    // A throttle keeps its name. That name is what tells somebody to wait
    // rather than to go looking for a bug.
    const throttle = new Error("Too many requests");
    throttle.name = "ThrottlingException";

    const described = describeTurnFailure(throttle, snapshot());

    expect(described).toContain("ThrottlingException: Too many requests");
  });

  it("reports an HTTP status when the SDK attached one", () => {
    // Bedrock hangs the actionable part off $metadata rather than the
    // message, and losing it is how AccessDenied gets chased as a network
    // problem.
    const denied = Object.assign(new Error("not authorised"), {
      name: "AccessDeniedException",
      $metadata: { httpStatusCode: 403 },
    });

    expect(describeTurnFailure(denied, snapshot())).toContain("(HTTP 403)");
  });

  it("says a reader left rather than reporting a failure", () => {
    const described = describeTurnFailure(abortError(), snapshot({ readerLeft: true }));

    expect(described).toContain("The reader disconnected before the reply finished.");
    expect(described).not.toContain("Cause:");
  });

  it("still gives a timeline when nothing timed out", () => {
    // A thrown error unrelated to time is still easier to place with the
    // timings beside it.
    expect(describeTurnFailure(new Error("Bedrock returned no stream"), snapshot())).toContain(
      "Turn: 21.0s total",
    );
  });

  it("copes with something thrown that is not an Error", () => {
    expect(describeTurnFailure("went wrong", snapshot())).toContain("went wrong");
  });

  it("copes with a snapshot that has no phases at all", () => {
    const described = describeTurnFailure(new Error("boom"), snapshot({ phases: [], totalMs: 12 }));

    expect(described).toContain("no phases recorded");
  });
});
