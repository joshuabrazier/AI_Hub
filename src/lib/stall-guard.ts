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
//
// THE FIRST BYTE GETS ITS OWN, SHORTER DEADLINE, and that is a separate
// judgement from the one above rather than a tightening of it.
//
// Silence BEFORE anything has arrived means nothing yet: no connection was
// proven, no tokens were counted, no work is at risk. Silence AFTER a reply
// has started is different - there is a partial answer worth protecting and
// the model has demonstrated it is alive.
//
// Measured in production: Bedrock accepted a five-character prompt, returned
// 200, and sent nothing for the full window. Every token count null. The AWS
// SDK cannot catch that on its own - NodeHttpHandler clears its requestTimeout
// the moment the response headers arrive, so a stream that opens and then
// goes quiet is covered by nothing but this - which is why the wait was two
// and a half minutes for an answer that was never coming.
// -------------------------------------------------------------------

export type StallGuard = {
  /** Pass to whatever is doing the work. Aborts on a stall, or on `linked`. */
  readonly signal: AbortSignal;
  /** Something arrived. Restarts the clock. */
  progress(): void;
  /** Always call this when the work ends, however it ends. */
  dispose(): void;
};

export function createStallGuard(
  timeoutMs: number,
  linked?: AbortSignal,
  // How long to wait for the FIRST sign of life. Defaults to the same window,
  // so an existing caller behaves exactly as it did.
  firstByteTimeoutMs: number = timeoutMs,
): StallGuard {
  const controller = new AbortController();

  let timer: ReturnType<typeof setTimeout> | null = null;
  let finished = false;

  // Widens to the full window as soon as anything arrives.
  let current = firstByteTimeoutMs;
  let started = false;

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

    const window = current;

    timer = setTimeout(() => {
      timer = null;
      controller.abort(
        new Error(
          started
            ? `Nothing was received for ${Math.round(window / 1000)} seconds, so the request was stopped.`
            : `The model sent nothing for ${Math.round(window / 1000)} seconds, so the request was stopped.`,
        ),
      );
    }, window);
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

  // The first call widens the window, because from here on there is a partial
  // reply worth protecting and the model has proved it is alive.
  const progress = () => {
    started = true;
    current = timeoutMs;
    arm();
  };

  return { signal: controller.signal, progress, dispose };
}
