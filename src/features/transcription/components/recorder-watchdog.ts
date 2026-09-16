// -------------------------------------------------------------------
// ===================================================================
// HAS THE RECORDER DIED, OR IS IT JUST QUIET?
// ===================================================================
//
// A MediaRecorder that has been frozen fires no error. An iOS tab put to
// sleep, or an audio pipeline that went with the Bluetooth headset carrying
// it, simply stops producing chunks - while the elapsed clock keeps
// counting and the caption keeps promising that the meeting is being
// recorded. Nothing noticed, and the rest of the meeting was not captured.
//
// SO THE CLOCK IS THE WATCHDOG, and this is the judgement it makes.
// Extracted as a pure function because it is the one piece of the recorder
// that can be tested at all - the rest is MediaRecorder, wake locks and
// IndexedDB - and because getting it wrong is expensive in BOTH directions:
//
//   too eager   ends a meeting that was recording perfectly well
//   too slow    lets a dead recorder run to the end of the meeting
//
// THE SECOND CONDITION IS THE SUBTLE ONE, and it was missing at first. A
// backgrounded tab freezes the recorder AND the timer that watches it, so
// the first tick after somebody returns from another app sees a silence as
// long as they were away. Judging on that alone ends a healthy recording at
// the exact moment its owner comes back to it - which is the harm this
// whole mechanism exists to prevent, arriving by a different route.
//
// Silence only counts while the page was there to witness it.
// -------------------------------------------------------------------

/** How long a recorder may say nothing before it is presumed dead, in chunk intervals. */
const SILENT_INTERVALS = 3;

export function shouldStopStalledRecorder(options: {
  /** performance.now() at the moment of judging. */
  now: number;
  /** When the last chunk arrived. Zero means none has yet, which is not evidence of anything. */
  lastChunkAt: number;
  /** When the page last became visible - see the note above on why this matters. */
  lastVisibleAt: number;
  /** How often the recorder was asked to emit a chunk. */
  chunkIntervalMs: number;
}): boolean {
  const { now, lastChunkAt, lastVisibleAt, chunkIntervalMs } = options;

  // Nothing has arrived yet, so there is no gap to measure. A recorder that
  // never produces a first chunk is caught by the upload's own empty-file
  // check rather than here.
  if (lastChunkAt <= 0) return false;

  const threshold = chunkIntervalMs * SILENT_INTERVALS;

  // Silence long enough to mean something, AND observed by a page that was
  // actually watching for it.
  return now - lastChunkAt > threshold && now - lastVisibleAt > threshold;
}
