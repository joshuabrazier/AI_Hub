// ===================================================================
// PHASES, DEADLINES, AND A REASON THAT NAMES ONE
//
// This replaces a single flat "nothing has arrived for N seconds" clock, and
// the reason it exists is a real failure that took days to understand.
//
// THE OLD SHAPE. One timer covered a whole chat turn: armed in the route
// handler, expiring after twenty seconds of no output. What it actually
// covered was eight database round trips, a blob fetch for every attachment
// on the conversation, a complete non-streaming model call to compact the
// thread, and only then the request to the model whose first token it claimed
// to be timing. On a long conversation the compaction call alone outlasted
// the budget every single time - so chat did not fail intermittently, it
// failed deterministically on the threads people used most, and worked
// perfectly on new ones. From outside, that is indistinguishable from flaky.
//
// And the message it produced was "the model sent nothing for 20 seconds",
// which is not a reason. It is the observation that a timer expired, phrased
// as though it were a diagnosis. The model had not been asked yet.
//
// SO: EVERY STAGE OF A TURN IS A NAMED PHASE WITH ITS OWN BUDGET. A phase
// that overruns says which phase it was, what it was allowed, and what
// everything before it had already spent. That sentence goes to the reader,
// to the request log and to the console, so the same failure is legible from
// all three without anybody correlating timestamps by eye.
//
// TWO KINDS OF BUDGET, because two different things go wrong:
//
//   DURATION  the phase may take this long in total. Right for work that
//             either finishes or does not - a database read, a compaction
//             call. A stuck one produces no partial progress to protect.
//
//   IDLE      the phase may be SILENT this long, and every sign of life
//             resets it. Right for a streamed reply: a long answer is long
//             because it is saying a lot, and every token is evidence of
//             health. Bounding its total duration would truncate precisely
//             the answers worth waiting for, which is the mistake the flat
//             clock made in the other direction.
//
// WHY THE BUDGETS SIT WHERE THEY DO. A layered system should fail at the
// layer that knows most about the failure, because that layer can name it.
// The AWS SDK's socket idle timeout knows "the socket went quiet"; this knows
// "the phase called compaction overran". So the deadlines here are set ABOVE
// the SDK's ladder on purpose: the SDK gets to fire first and hand us a named
// TimeoutError, and these are the backstop for when it does not. When the
// backstop is tighter than the thing it backs up, the specific error is never
// reached and every failure arrives anonymous. That is what happened before.
//
// Pure and synchronous apart from its timers, so all of the above is testable
// without a model, a network or a database.
// ===================================================================

export type PhaseKind = "duration" | "idle";

export type PhaseRecord = {
  name: string;
  /** How long the phase ran. Still ticking for the phase that is open. */
  ms: number;
  budgetMs: number;
  kind: PhaseKind;
  /** True for the phase whose deadline fired. At most one is ever true. */
  timedOut: boolean;
};

export type TurnSnapshot = {
  totalMs: number;
  /** The phase that was open when things ended, whether or not it overran. */
  currentPhase: string | null;
  /** The phase whose deadline fired, or null if none did. */
  timedOutPhase: string | null;
  /** True when the reader went away rather than anything failing. */
  readerLeft: boolean;
  /**
   * True when the overall time-to-first-byte ceiling fired rather than one
   * phase's own budget. Told apart because the remedies differ: a phase
   * overrun points at that phase, and a ceiling hit means the phases were
   * each within budget and there were simply too many of them.
   */
  ceilingHit: boolean;
  phases: PhaseRecord[];
  /** Facts worth having beside the timings. Never anything private. */
  notes: Record<string, string | number | boolean>;
};

export type TurnGuard = {
  /** Hand to whatever is doing the work. Aborts on an overrun or a disconnect. */
  readonly signal: AbortSignal;
  /**
   * Close the current phase and open a new one. Sequential by design: a turn
   * is a sequence of stages, and overlapping budgets would make "which one
   * overran" unanswerable, which is the entire point of this.
   */
  phase(name: string, budgetMs: number, kind?: PhaseKind): void;
  /** A sign of life. Resets the clock on an idle phase; ignored on a duration one. */
  progress(): void;
  /** A fact to record beside the timings. */
  note(key: string, value: string | number | boolean): void;
  /**
   * The reader has been sent something. Cancels the overall ceiling, because
   * from here on the platform's own idle clock is reset by every byte and
   * there is no longer any reason to bound the total.
   */
  firstByteReached(): void;
  /** One sentence naming the phase, the timeline and the underlying cause. */
  describe(error: unknown): string;
  /** The structured form, for the log column and the console. */
  snapshot(): TurnSnapshot;
  /** Always call when the turn ends, however it ends. */
  dispose(): void;
};

// A phase name is written into a message shown to a reader, so it stays
// short, lower case and hyphenated. Enforced nowhere - this is a note to
// whoever adds the next one.
export function createTurnGuard(
  linked?: AbortSignal,
  // -----------------------------------------------------------------
  // TWO NESTED DEADLINES, AND EACH DOES A JOB THE OTHER CANNOT.
  //
  // The per-phase budgets exist for DIAGNOSIS. They name which stage
  // overran, which is the whole reason this module exists, and they can
  // therefore afford to be generous: a budget that never fires costs
  // nothing, and one set tightly enough to be a real limit is one that
  // eventually kills healthy work.
  //
  // This ceiling exists for CORRECTNESS. Azure App Service severs a
  // connection idle for 230 seconds, and if the platform wins the race the
  // stream is cut mid-flight and the app never learns it happened - no log
  // row, no error, nothing to investigate. So the sum of the phases has to
  // be bounded independently of any one of them, and generous phase budgets
  // are only safe because this is here.
  //
  // It covers the period BEFORE the reader is sent anything, and no longer,
  // because the platform's clock measures idleness too: once bytes are
  // flowing it is reset by every one of them, and a long answer can then run
  // as long as it likes. firstByteReached() is what ends it.
  // -----------------------------------------------------------------
  options: { firstByteCeilingMs?: number } = {},
): TurnGuard {
  const controller = new AbortController();
  const startedAt = Date.now();

  const completed: PhaseRecord[] = [];
  const notes: Record<string, string | number | boolean> = {};

  let open: { name: string; budgetMs: number; kind: PhaseKind; startedAt: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finished = false;
  let timedOutPhase: string | null = null;
  let readerLeft = false;
  let ceilingHit = false;
  let ceilingTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const clearCeiling = () => {
    if (ceilingTimer !== null) clearTimeout(ceilingTimer);
    ceilingTimer = null;
  };

  if (options.firstByteCeilingMs !== undefined && options.firstByteCeilingMs > 0) {
    const ceilingMs = options.firstByteCeilingMs;

    ceilingTimer = setTimeout(() => {
      ceilingTimer = null;
      ceilingHit = true;
      // Attributed to whatever was open, so the message still points
      // somewhere even though no single phase is at fault.
      timedOutPhase = open?.name ?? null;
      clearTimer();

      controller.abort(
        new Error(
          `Nothing reached the reader within ${formatSeconds(ceilingMs)}` +
            (open === null ? "." : `, still in "${open.name}".`),
        ),
      );
    }, ceilingMs);
  }

  const arm = () => {
    clearTimer();

    // Once the turn is over, a late progress() must not start a timer that
    // then fires into a finished request and holds the event loop open for
    // its whole window.
    if (finished || open === null || controller.signal.aborted) return;

    const phase = open;
    const budgetMs = phase.budgetMs;

    timer = setTimeout(() => {
      timer = null;
      timedOutPhase = phase.name;

      // The message says what was being waited for, not that a timer
      // expired. "No data arrived while streaming the reply for 60s" is
      // actionable; "nothing happened for 60s" is the thing this replaces.
      controller.abort(
        new Error(
          phase.kind === "idle"
            ? `Nothing arrived during "${phase.name}" for ${formatSeconds(budgetMs)}.`
            : `"${phase.name}" did not finish within ${formatSeconds(budgetMs)}.`,
        ),
      );
    }, budgetMs);
  };

  const closeOpenPhase = () => {
    if (open === null) return;

    completed.push({
      name: open.name,
      ms: Date.now() - open.startedAt,
      budgetMs: open.budgetMs,
      kind: open.kind,
      timedOut: timedOutPhase === open.name,
    });

    open = null;
  };

  if (linked) {
    const onReaderGone = () => {
      readerLeft = true;
      clearTimer();
      controller.abort(linked.reason);
    };

    // Already gone before we began - the tab closed while the request was
    // still being validated. Worth distinguishing, because it is not a fault
    // and chasing it as one is the afternoon this flag exists to save.
    if (linked.aborted) onReaderGone();
    else linked.addEventListener("abort", onReaderGone, { once: true });
  }

  return {
    signal: controller.signal,

    phase(name, budgetMs, kind = "duration") {
      if (finished) return;

      closeOpenPhase();

      open = { name, budgetMs, kind, startedAt: Date.now() };

      arm();
    },

    progress() {
      // Only an idle budget is reset by activity. Re-arming a duration phase
      // on progress would silently turn it into an idle one, and a phase
      // whose meaning depends on who called what is a phase nobody can
      // reason about.
      if (open?.kind === "idle") arm();
    },

    note(key, value) {
      notes[key] = value;
    },

    snapshot() {
      const phases = [...completed];

      // The open phase is reported too, still ticking. It is usually the
      // interesting one: whatever was happening when this ended.
      if (open !== null) {
        phases.push({
          name: open.name,
          ms: Date.now() - open.startedAt,
          budgetMs: open.budgetMs,
          kind: open.kind,
          timedOut: timedOutPhase === open.name,
        });
      }

      return {
        totalMs: Date.now() - startedAt,
        currentPhase: open?.name ?? null,
        timedOutPhase,
        readerLeft,
        ceilingHit,
        phases,
        notes: { ...notes },
      };
    },

    describe(error) {
      return describeTurnFailure(error, this.snapshot());
    },

    firstByteReached() {
      clearCeiling();
    },

    dispose() {
      finished = true;
      clearTimer();
      clearCeiling();
      closeOpenPhase();
    },
  };
}

// -------------------------------------------------------------------
// The sentence.
//
// Assembled in one place because it is shown in three - a toast, the request
// log and the server console - and three versions of it would drift until the
// screen and the log disagreed about the same failure.
//
// THE ORDER IS DELIBERATE: what went wrong, then where the time went, then
// the underlying error. Somebody reading a toast stops after the first
// clause; somebody reading the log wants all three.
// -------------------------------------------------------------------
export function describeTurnFailure(error: unknown, snapshot: TurnSnapshot): string {
  const cause = describeCause(error);
  const timeline = formatTimeline(snapshot);

  // A reader who closed the tab. Not a failure, and saying so stops the next
  // person investigating a bug that is not there.
  if (snapshot.readerLeft) {
    return `The reader disconnected before the reply finished. ${timeline}`;
  }

  // The ceiling, which is a different finding from a phase overrun: every
  // phase was within its own budget and there were too many of them. Saying
  // "compaction ran past its budget" here would be false and would send
  // somebody to tune the wrong number.
  if (snapshot.ceilingHit) {
    const where = snapshot.timedOutPhase !== null ? ` It was in "${snapshot.timedOutPhase}".` : "";

    return (
      `The turn did not reach the reader before its overall ceiling.${where} ` +
      `${timeline} Cause: ${cause}`
    );
  }

  if (snapshot.timedOutPhase !== null) {
    const phase = snapshot.phases.find((entry) => entry.name === snapshot.timedOutPhase);

    const overran =
      phase?.kind === "idle"
        ? `Nothing arrived while "${snapshot.timedOutPhase}" was running, for ${formatSeconds(phase.budgetMs)}.`
        : `"${snapshot.timedOutPhase}" ran past its ${formatSeconds(phase?.budgetMs ?? 0)} budget.`;

    // The cause is still worth printing: the SDK's own abort error is
    // uninformative on its own, but a socket timeout or a throttle arriving
    // here alongside the phase name is the whole answer.
    return `${overran} ${timeline} Cause: ${cause}`;
  }

  return `${cause} ${timeline}`;
}

// -------------------------------------------------------------------
// What actually threw.
//
// AN ABORT KEEPS ITS REASON. The AWS SDK catches whatever abort signal it
// was given and throws its own "AbortError: Request aborted", discarding the
// reason - so a request that had been dead for two minutes and a reader who
// navigated away arrived in the log as the same four useless words. The
// reason lives on the signal, so it is read from there.
//
// Everything else is left exactly as it was. A ThrottlingException or a
// TimeoutError has a name, and that name IS the remedy - wrapping it would
// hide the one useful word in the message.
// -------------------------------------------------------------------
function describeCause(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const name = error.name || "Error";
  const message = tidyMessage(error.message) || "no message";

  // Bedrock puts the actionable part of a failure in these, and losing them
  // is how "AccessDeniedException" gets investigated as a network problem.
  const status = extractHttpStatus(error);

  return status !== null ? `${name}: ${message} (HTTP ${status})` : `${name}: ${message}`;
}

// The SDK stamps its own package name onto the front of its timeout
// messages, which tells a reader nothing they can act on - the meaning is
// entirely in "the request socket timed out after 25000 ms of inactivity".
// The error NAME is kept, because TimeoutError is the part that says which
// kind of problem this is.
//
// Only this one prefix is stripped, deliberately. A general cleanup pass over
// error text is how the one useful word in a message gets removed by a rule
// nobody remembers writing.
function tidyMessage(message: string): string {
  return message.replace(/^@smithy[^\s]* - /, "").trim();
}

// The AWS SDK hangs metadata off the error rather than putting it in the
// message. Read defensively: this runs on a failure path and must never be
// the thing that throws.
function extractHttpStatus(error: Error): number | null {
  const metadata = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata;
  const code = metadata?.httpStatusCode;

  return typeof code === "number" ? code : null;
}

// -------------------------------------------------------------------
// Where the time went, as one clause.
//
// EVERY PHASE IS LISTED, not just the slow one, because the useful reading is
// comparative: "compaction 19.6s" means nothing until you can see that
// history took 0.3s. This is the line that answers "why did nothing happen
// for twenty seconds" - something was happening, and this says what.
// -------------------------------------------------------------------
function formatTimeline(snapshot: TurnSnapshot): string {
  if (snapshot.phases.length === 0) {
    return `Turn: ${formatSeconds(snapshot.totalMs)}, no phases recorded.`;
  }

  const parts = snapshot.phases.map((phase) => `${phase.name} ${formatSeconds(phase.ms)}`);

  return `Turn: ${formatSeconds(snapshot.totalMs)} total (${parts.join(", ")}).`;
}

// Seconds to one decimal place, which is the precision a person can act on.
// Milliseconds are noise in a sentence and are kept in the structured
// snapshot for anybody querying the log.
function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
