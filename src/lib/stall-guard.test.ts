import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStallGuard } from "./stall-guard";

// -------------------------------------------------------------------
// The behaviour that matters is about TIME, so the clock is faked. Every
// test here is a case that either did happen in production or would have
// been caused by the obvious fix for the one that did.
// -------------------------------------------------------------------

describe("createStallGuard", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("aborts when nothing arrives at all", () => {
    // The failure this exists for: a request accepted by the model that then
    // sends nothing. Five of those in a row, retried with backoff, is how one
    // reply reached twenty-four minutes.
    const guard = createStallGuard(1_000);

    expect(guard.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect(guard.signal.aborted).toBe(true);
  });

  it("does NOT abort a slow but productive stream, however long it runs", () => {
    // The regression a wall-clock deadline causes, and the reason this is
    // measured on silence instead. A full-length reply from this model runs
    // for minutes; capping total duration truncates it mid-sentence.
    const guard = createStallGuard(1_000);

    for (let elapsed = 0; elapsed < 60_000; elapsed += 900) {
      vi.advanceTimersByTime(900);
      guard.progress();
    }

    expect(guard.signal.aborted).toBe(false);
  });

  it("starts the clock immediately rather than on the first chunk", () => {
    // The longest silence in a model call is usually the wait before it says
    // anything. A guard armed by the first chunk would never cover it - which
    // is the exact window that was failing.
    const guard = createStallGuard(1_000);

    vi.advanceTimersByTime(1_001);

    expect(guard.signal.aborted).toBe(true);
  });

  it("aborts once the gap after the last chunk is long enough", () => {
    const guard = createStallGuard(1_000);

    vi.advanceTimersByTime(500);
    guard.progress();
    vi.advanceTimersByTime(500);

    expect(guard.signal.aborted).toBe(false);

    vi.advanceTimersByTime(501);

    expect(guard.signal.aborted).toBe(true);
  });

  it("stops when the reader goes away", () => {
    // A closed tab, a navigation, or the load balancer cutting an idle
    // connection. Continuing to call the model for somebody who has gone is
    // how a failed reply kept billing for twenty minutes.
    const reader = new AbortController();
    const guard = createStallGuard(60_000, reader.signal);

    reader.abort(new Error("client went away"));

    expect(guard.signal.aborted).toBe(true);
  });

  it("is already aborted when the reader left before it started", () => {
    const reader = new AbortController();
    reader.abort(new Error("gone"));

    expect(createStallGuard(60_000, reader.signal).signal.aborted).toBe(true);
  });

  it("does not abort after dispose, however long nothing arrives", () => {
    // Disposal happens in a finally, so this is the normal end of every
    // successful reply. A timer left armed would fire into a finished
    // request and, in Node, hold the event loop open for its full window.
    const guard = createStallGuard(1_000);

    guard.dispose();
    vi.advanceTimersByTime(60_000);

    expect(guard.signal.aborted).toBe(false);
  });

  it("ignores a late chunk arriving after dispose", () => {
    // A generator can yield once more as it unwinds. That must not re-arm a
    // timer nothing will ever clear.
    const guard = createStallGuard(1_000);

    guard.dispose();
    guard.progress();
    vi.advanceTimersByTime(60_000);

    expect(guard.signal.aborted).toBe(false);
  });

  it("carries a reason a human can read", () => {
    const guard = createStallGuard(150_000);

    vi.advanceTimersByTime(150_001);

    expect(String((guard.signal.reason as Error).message)).toContain("150 seconds");
  });
});
