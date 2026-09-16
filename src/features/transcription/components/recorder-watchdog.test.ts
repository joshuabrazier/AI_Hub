import { describe, expect, it } from "vitest";

import { shouldStopStalledRecorder } from "./recorder-watchdog";

// -------------------------------------------------------------------
// The one decision in the recorder that can be tested without a browser,
// and the one most worth testing: it ENDS RECORDINGS.
//
// Both directions cost a meeting. Firing when it should not cuts one short
// at the moment its owner returns to the tab; not firing when it should
// lets a dead recorder run silently to the end of an hour.
// -------------------------------------------------------------------

const CHUNK = 5_000;

// An hour into the page's life, so that subtracting a long silence still
// leaves a POSITIVE timestamp. performance.now() counts from page load and
// a recording cannot have been silent for longer than the page has existed
// - but a fixture that ignores that produces negative timestamps, which
// trip the "no chunk yet" guard and make a test pass for the wrong reason.
const NOW = 3_600_000;

const judge = (options: { silentFor: number; visibleFor: number }) =>
  shouldStopStalledRecorder({
    now: NOW,
    lastChunkAt: NOW - options.silentFor,
    lastVisibleAt: NOW - options.visibleFor,
    chunkIntervalMs: CHUNK,
  });

describe("shouldStopStalledRecorder", () => {
  it("leaves a recorder producing chunks alone", () => {
    expect(judge({ silentFor: CHUNK, visibleFor: 60_000 })).toBe(false);
  });

  it("tolerates one late chunk on a busy device", () => {
    // Two intervals is a slow moment, not a death. Reacting here would end
    // meetings on any laptop under load.
    expect(judge({ silentFor: CHUNK * 2, visibleFor: 60_000 })).toBe(false);
  });

  it("stops a recorder that has said nothing for three intervals", () => {
    expect(judge({ silentFor: CHUNK * 3 + 1, visibleFor: 60_000 })).toBe(true);
  });

  it("does NOT fire on the first tick after returning from another app", () => {
    // THE BUG THIS EXISTS FOR. A backgrounded tab freezes the recorder and
    // the timer watching it together, so the gap on return is as long as
    // the person was away - twenty minutes here. Judging on that alone ends
    // a perfectly healthy recording at the exact moment its owner comes
    // back to it.
    expect(judge({ silentFor: 20 * 60_000, visibleFor: 200 })).toBe(false);
  });

  it("gives a resuming recorder a grace period, then judges it", () => {
    // Back for a moment: not yet. Back for longer than the threshold with
    // still no chunk: the recorder really did not survive being frozen.
    expect(judge({ silentFor: 20 * 60_000, visibleFor: CHUNK * 2 })).toBe(false);
    expect(judge({ silentFor: 20 * 60_000, visibleFor: CHUNK * 3 + 1 })).toBe(true);
  });

  it("says nothing about a recorder that has not sent a first chunk yet", () => {
    // Zero is "none has arrived", not "one arrived at time zero" - and a
    // recorder that never produces one is caught by the empty-file check on
    // upload, not by a watchdog that would fire three intervals into every
    // recording that started slowly.
    expect(
      shouldStopStalledRecorder({
        now: 1_000_000,
        lastChunkAt: 0,
        lastVisibleAt: 0,
        chunkIntervalMs: CHUNK,
      }),
    ).toBe(false);
  });

  it("scales with the chunk interval rather than a hardcoded number", () => {
    const silentFor = 31_000;

    expect(shouldStopStalledRecorder({ now: 100_000, lastChunkAt: 100_000 - silentFor, lastVisibleAt: 0, chunkIntervalMs: 10_000 })).toBe(
      true,
    );
    expect(shouldStopStalledRecorder({ now: 100_000, lastChunkAt: 100_000 - silentFor, lastVisibleAt: 0, chunkIntervalMs: 30_000 })).toBe(
      false,
    );
  });
});
