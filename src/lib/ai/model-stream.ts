// ===================================================================
// A MODEL CALL THAT IS ALLOWED TO NOT ANSWER, AND IS ASKED AGAIN.
//
// THE GAP THIS FILLS. Everything else in this app treats a model call as
// something that either succeeds, fails with a name, or is cancelled. There
// is a fourth outcome and it was the common one: Bedrock accepts the
// request, holds the connection, and sends nothing at all. No error, so
// nothing retries. The socket is not idle - an AWS event stream keeps the
// connection busy - so BEDROCK_SOCKET_IDLE_MS never fires. The SDK is not
// waiting on a retryable failure, it is waiting on a reply, so its own
// ladder never engages either.
//
// The only thing that ever noticed was the CALLER'S phase budget, seventy-
// five seconds later, and what it does is abort the turn. An abort is a
// cancellation, and the SDK never retries a cancellation. So one stalled
// request cost one dead turn, and the reader was told "the reply did not
// finish" after a minute and a quarter of nothing.
//
// That is the shape of the failure people described as "it works and then
// suddenly it does not work for anyone": when the endpoint is in that state
// EVERY turn stalls, every turn waits out its full budget, and every turn
// dies - because nothing anywhere was willing to simply ask again.
//
// SO THIS BOUNDS TIME-TO-FIRST-EVENT SEPARATELY FROM THE REST OF THE CALL,
// and that separation is the whole idea. The two are different quantities:
//
//   BEFORE the first event, silence is pathological. Time to first token is
//   a few seconds even on a large cached prompt, so thirty is already
//   generous, and there is nothing to lose by abandoning the attempt - no
//   partial answer exists.
//
//   AFTER it, silence is ordinary. The model is producing, gaps between
//   tokens are normal, and a total ceiling here would truncate exactly the
//   long answers worth waiting for. So this deadline is CANCELLED by the
//   first event and never applies again; from that moment the caller's own
//   idle budget is the only limit, which is what it is good at.
//
// -------------------------------------------------------------------
// WHY RE-ASKING IS SAFE, WHICH IS THE PART THAT HAD TO BE ARGUED.
//
// A retry is only correct where the work has no side effects and nothing has
// been shown to the reader. Both hold, but only under conditions this file
// enforces rather than assumes:
//
//   THE CALL IS A PURE GENERATION. Converse writes nothing, reserves
//   nothing, and holds no server-side turn state - the whole conversation is
//   sent on every request. A second attempt is a fresh answer to the same
//   question, not a repeat of a committed action.
//
//   NOTHING HAS BEEN YIELDED. `sawEvent` latches on the first event, and a
//   retry after that is refused outright. Without it a stream that died
//   halfway would restart and the reader would see the first half of the
//   answer twice.
//
//   ONLY OUR OWN DEADLINE IS RETRIED. `deadlineFired` is checked before
//   anything else. A ThrottlingException, a validation error, an expired
//   key - each of those has already been through the SDK's ladder and means
//   something, and asking again just pays twice to be told it again.
//
//   THE CALLER'S CANCELLATION ALWAYS WINS. If the turn's own signal has
//   aborted - the budget is spent, or the reader closed the tab - there is
//   nobody to answer and the error is rethrown untouched.
//
// IT IS NOT FREE, AND THAT IS THE TRADE. An abandoned attempt may still be
// billed for whatever the model did before we stopped listening. Two
// attempts of thirty seconds against one dead turn is a trade worth making;
// five would not be, which is why the count is small and lives here rather
// than being a number a caller passes in casually.
//
// -------------------------------------------------------------------
// THE ATTEMPTS MUST FIT INSIDE THE CALLER'S BUDGET.
//
// Retrying produces no events, so an idle budget above this sees the whole
// retry sequence as one unbroken silence. MODEL_FIRST_EVENT_MS * attempts
// therefore has to stay UNDER the phase budget that covers it, or the caller
// aborts mid-ladder and the retry never happens - which is the same trap
// bedrock-client.ts describes for the SDK's own ladder, one level up.
// model-stream.test.ts asserts the arithmetic against CHAT_PHASES.
//
// Pure apart from its timers and the callback it is given, so all of the
// above is testable without a model, a network or a database.
// ===================================================================

/**
 * How long one attempt may produce NOTHING before it is abandoned. Generous
 * against a few seconds of normal time-to-first-token; anything near this is
 * already a call that is not going to answer.
 */
export const MODEL_FIRST_EVENT_MS = 30_000;

/**
 * Attempts in total, not retries after the first. Two, because a stall is
 * either a blip that one more request clears or a state that more requests
 * will not - and the reader is waiting throughout.
 */
export const MODEL_FIRST_EVENT_ATTEMPTS = 2;

/** The worst case, which a covering phase budget must exceed. */
export const MODEL_FIRST_EVENT_WORST_CASE_MS = MODEL_FIRST_EVENT_MS * MODEL_FIRST_EVENT_ATTEMPTS;

// ===================================================================
// DID IT REACH BEDROCK AT ALL? THE TRACE COULD NOT SAY, AND NOW IT CAN.
//
// This deadline covers `await open(signal)` as well as the iteration after
// it, because both are ways for an attempt to produce nothing. That is the
// right POLICY - the reader is waiting either way - and it made two
// completely different failures indistinguishable in the log:
//
//   NEVER OPENED     no response headers ever came back, so this side never
//                    got an acknowledgement. The likeliest reading is that
//                    the request never left the host: a connection queued
//                    behind an exhausted pool has no socket, so no timeout in
//                    the SDK can see it, and Azure's outbound SNAT has the
//                    same shape. Look at our networking first.
//
//   OPENED, SILENT   headers came back, so Bedrock accepted the request and
//                    began a response, and then no event ever arrived. The
//                    model WAS asked. This is the one that can cost money
//                    and the one AWS can be asked about.
//
// The remedies are opposite - one is our networking, the other is theirs -
// and the old message asserted the second ("The model accepted the request
// but sent nothing") without being able to know it. A production silence
// could not be attributed without reading CloudWatch by hand.
//
// -------------------------------------------------------------------
// "NEVER OPENED" IS NOT THE SAME AS "NEVER ASKED", and the message must not
// say that it is.
//
// `send()` settling on the response headers is a sound one-way signal: it
// CANNOT settle for a request Bedrock never received, so `openedAfterMs`
// being a number does prove the model was asked. The converse does not
// follow. `send()` wraps the SDK's whole retry ladder, so it is also
// unsettled while the SDK is sleeping between attempts of its own - and an
// attempt that came back 429 or 500 reached Bedrock. Headers can be lost on
// the way back, too, for a request that arrived.
//
// So "no headers" means "unacknowledged", which is a strong hint and not a
// billing statement. Saying "nothing was billed" would be an assertion this
// code is not in a position to make, and the whole point of the split is to
// stop asserting things it cannot know.
// ===================================================================

/** What one abandoned attempt actually did, measured rather than assumed. */
export type SilentAttempt = {
  /** 1-based. */
  attempt: number;
  /**
   * Milliseconds from the attempt starting to the response headers arriving,
   * or NULL when they never did.
   *
   * Null is the whole point: nothing came back to acknowledge the request, so
   * the silence is most likely on this side of the connection. It is evidence
   * rather than proof - see the block above on why "unacknowledged" is not
   * the same as "never asked".
   */
  openedAfterMs: number | null;
  /** How long the attempt ran before it was abandoned. */
  elapsedMs: number;
};

export class ModelSilentError extends Error {
  /** Every abandoned attempt, in order, for a caller that records traces. */
  readonly attempts: SilentAttempt[];

  /**
   * True when at least one attempt got response headers back.
   *
   * The single fact worth knowing first, and it is only sound in one
   * direction: true PROVES the model was asked and said nothing, which is a
   * question for AWS. False means nothing acknowledged the request, which
   * points at our networking without ruling out an attempt that reached
   * Bedrock inside the SDK's own retry ladder.
   */
  readonly reachedModel: boolean;

  constructor(attempts: SilentAttempt[], perAttemptMs: number) {
    const reached = attempts.some((entry) => entry.openedAfterMs !== null);
    const count = attempts.length;
    const times = count === 1 ? "once" : `${count} times in a row`;
    const seconds = Math.round(perAttemptMs / 1000);

    super(
      reached
        ? `Bedrock accepted the request and then sent nothing for ${seconds}s, ${times}. ` +
          `Response headers came back after ${attempts
            .map((entry) => (entry.openedAfterMs === null ? "never" : `${entry.openedAfterMs}ms`))
            .join(" then ")}, so the model was asked and did not answer.`
        : `Nothing acknowledged the request: ${times}, ${seconds}s each, no response headers ever ` +
          `came back. That points at the connection pool and outbound networking rather than at ` +
          `the model - though the SDK may also have been retrying an attempt of its own, which ` +
          `would have reached Bedrock.`,
    );

    this.name = "ModelSilentError";
    this.attempts = attempts;
    this.reachedModel = reached;
  }
}

export type ModelStreamOptions = {
  /** The turn's own deadline or cancellation. Always wins over a retry. */
  signal?: AbortSignal;
  firstEventMs?: number;
  attempts?: number;
  /**
   * Told when an attempt is abandoned, so the caller can record it.
   *
   * Given the whole measurement rather than just the attempt number, so a
   * trace can say which side the silence was on without re-deriving it.
   */
  onSilentAttempt?: (detail: SilentAttempt) => void;
};

/**
 * Open a model stream, and ask again if it never starts.
 *
 * `open` is given the signal for ONE attempt and must return the event
 * stream. It is called once per attempt, so it must build a fresh request
 * rather than closing over one already sent.
 */
export async function* streamModelEvents<TEvent>(
  open: (signal: AbortSignal) => Promise<AsyncIterable<TEvent> | undefined>,
  options: ModelStreamOptions = {},
): AsyncGenerator<TEvent, void, undefined> {
  const firstEventMs = options.firstEventMs ?? MODEL_FIRST_EVENT_MS;
  const attempts = options.attempts ?? MODEL_FIRST_EVENT_ATTEMPTS;

  // Every abandoned attempt, so the error can describe the whole sequence
  // rather than only the last one - "never opened, then opened after 800ms
  // and stayed silent" is a different story from either on its own.
  const abandoned: SilentAttempt[] = [];

  for (let attempt = 1; ; attempt++) {
    // Its own controller rather than AbortSignal.timeout, because this
    // deadline has to be CANCELLABLE: once the first event lands it must
    // never fire, and a timeout signal cannot be called off.
    const deadline = new AbortController();
    let deadlineFired = false;

    const timer = setTimeout(() => {
      deadlineFired = true;
      deadline.abort(new Error(`No first event within ${Math.round(firstEventMs / 1000)}s.`));
    }, firstEventMs);

    // Combined so the caller's cancellation still reaches the request. The
    // caller's signal is checked FIRST in the catch, so a turn that ended
    // during an attempt is never mistaken for a stall.
    const signal = options.signal
      ? AbortSignal.any([options.signal, deadline.signal])
      : deadline.signal;

    let sawEvent = false;

    // Measured, not inferred. `startedAt` is per ATTEMPT rather than per call
    // so a second attempt's timings are its own; `openedAt` stays null until
    // the response headers arrive, which is the one fact that separates "the
    // model said nothing" from "the model was never asked".
    const startedAt = Date.now();
    let openedAt: number | null = null;

    try {
      const stream = await open(signal);

      // Set BEFORE the empty check below, because a response that came back
      // without a stream still reached Bedrock - that is a malformed answer,
      // not an unreachable one, and the two must not be confused.
      openedAt = Date.now();

      if (!stream) throw new Error("The model returned no stream");

      for await (const event of stream) {
        if (!sawEvent) {
          sawEvent = true;

          // The deadline is spent the moment anything arrives. From here the
          // caller's idle budget is the only limit, so a long answer runs as
          // long as it keeps talking.
          clearTimeout(timer);
        }

        yield event;
      }

      return;
    } catch (error) {
      clearTimeout(timer);

      // The turn is over - the budget above this is spent, or the reader has
      // gone. Nobody is waiting for a second attempt.
      if (options.signal?.aborted) throw error;

      // Something was already yielded, so asking again would repeat it.
      if (sawEvent) throw error;

      // Anything with a name of its own has been through the SDK's ladder
      // and means something. Only our own silence deadline is retried.
      if (!deadlineFired) throw error;

      const detail: SilentAttempt = {
        attempt,
        openedAfterMs: openedAt === null ? null : openedAt - startedAt,
        elapsedMs: Date.now() - startedAt,
      };

      abandoned.push(detail);

      if (attempt >= attempts) throw new ModelSilentError(abandoned, firstEventMs);

      options.onSilentAttempt?.(detail);
    } finally {
      // However this attempt ended. A timer left armed holds the event loop
      // open for the rest of its window.
      clearTimeout(timer);
    }
  }
}
