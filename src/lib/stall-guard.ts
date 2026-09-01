// -------------------------------------------------------------------
// Give up when nothing is coming back, not when something is taking a
// while.
//
// THE DIFFERENCE IS THE WHOLE POINT, and getting it wrong the obvious way
// costs you the good case to protect against the bad one.
//
// A streamed model reply has no useful total duration. A long answer is
// long because it is saying a lot, and every token it sends is evidence it
// is healthy. Capping total duration therefore punishes exactly the replies
// worth waiting for: at the rate this model generates, a full-length answer
// runs for minutes, and a wall-clock deadline truncates it mid-sentence.
//
// What is never acceptable is SILENCE. A request that has sent nothing for
// two minutes is not slow, it is dead - and dead requests were the actual
// failure this exists for: the AWS SDK retries a stalled stream up to five
// times with adaptive backoff between them, and a chat reply was observed
// burning twenty-four minutes that way without producing a byte.
//
// So the clock here measures time since the last sign of life and is reset
// by every chunk. A productive stream can run as long as it likes; a silent
// one dies once, quickly, and takes the retry ladder with it.
//
// It also carries the caller's own signal, because a reader who has closed
// the tab is a second, independent reason to stop.
// -------------------------------------------------------------------

export type StallGuard = {
  /** Pass to whatever is doing the work. Aborts on a stall, or on `linked`. */
  readonly signal: AbortSignal;
  /** Something arrived. Restarts the clock. */
  progress(): void;
  /** Always call this when the work ends, however it ends. */
  dispose(): void;
};

export function createStallGuard(timeoutMs: number, linked?: AbortSignal): StallGuard {
  const controller = new AbortController();

  let timer: ReturnType<typeof setTimeout> | null = null;
  let finished = false;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const dispose = () => {
    finished = true;
    clear();
  };

  const arm = () => {
    // Once the work is over, a late chunk must not start a new timer that
    // then fires into an aborted controller and holds the event loop.
    if (finished) return;

    clear();

    timer = setTimeout(() => {
      timer = null;
      controller.abort(
        new Error(`Nothing was received for ${Math.round(timeoutMs / 1000)} seconds, so the request was stopped.`),
      );
    }, timeoutMs);
  };

  if (linked) {
    if (linked.aborted) {
      // Already gone before we started - the reader closed the tab while the
      // request was still being validated.
      dispose();
      controller.abort(linked.reason);
    } else {
      linked.addEventListener(
        "abort",
        () => {
          dispose();
          controller.abort(linked.reason);
        },
        { once: true },
      );
    }
  }

  // Armed immediately rather than on the first chunk: the longest silence in
  // a model call is usually the wait BEFORE it starts talking, which is
  // precisely the window that needs covering.
  if (!controller.signal.aborted) arm();

  return { signal: controller.signal, progress: arm, dispose };
}
