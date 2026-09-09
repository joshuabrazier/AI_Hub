import { describe, expect, it, vi } from "vitest";

import { CHAT_PHASES } from "@/features/ai-chat/ai-chat.types";

import {
  MODEL_FIRST_EVENT_ATTEMPTS,
  MODEL_FIRST_EVENT_MS,
  MODEL_FIRST_EVENT_WORST_CASE_MS,
  ModelSilentError,
  streamModelEvents,
} from "./model-stream";

// -------------------------------------------------------------------
// Real timers on tiny windows rather than fake ones.
//
// The thing under test is the RACE between a deadline and a stream, and
// faking the clock removes the only interesting part of it - a generator
// that is awaiting a stream does not advance because a mocked timer says so.
// Every deadline here is tens of milliseconds, so the file still runs fast.
// -------------------------------------------------------------------
const DEADLINE_MS = 60;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A stream that yields what it is given, pausing before each one. */
async function* paced<T>(items: T[], gapMs: number): AsyncGenerator<T> {
  for (const item of items) {
    await sleep(gapMs);
    yield item;
  }
}

/** A stream that never yields and never ends, until its signal fires. */
function silent(signal: AbortSignal): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () =>
          new Promise<IteratorResult<string>>((_resolve, reject) => {
            if (signal.aborted) {
              reject(signal.reason);
              return;
            }

            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      };
    },
  };
}

const collect = async (events: AsyncGenerator<string>) => {
  const seen: string[] = [];
  for await (const event of events) seen.push(event);
  return seen;
};

describe("streamModelEvents", () => {
  it("passes a healthy stream straight through, opening it once", async () => {
    const open = vi.fn(async () => paced(["a", "b", "c"], 1));

    await expect(collect(streamModelEvents(open, { firstEventMs: DEADLINE_MS }))).resolves.toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("ASKS AGAIN when the first attempt sends nothing, and returns the second answer", async () => {
    // The failure this module exists for: Bedrock accepts the request, holds
    // the connection and never answers. Nothing else in the app retries it,
    // because a stall is not an error.
    const open = vi
      .fn<(signal: AbortSignal) => Promise<AsyncIterable<string>>>()
      .mockImplementationOnce(async (signal) => silent(signal))
      .mockImplementationOnce(async () => paced(["recovered"], 1));

    const onSilentAttempt = vi.fn();

    await expect(
      collect(streamModelEvents(open, { firstEventMs: DEADLINE_MS, onSilentAttempt })),
    ).resolves.toEqual(["recovered"]);

    expect(open).toHaveBeenCalledTimes(2);
    // Reported, because a turn that answered on its second attempt looks
    // perfectly healthy from outside and the count is the only sign that the
    // endpoint is struggling.
    expect(onSilentAttempt).toHaveBeenCalledWith(1);
  });

  it("gives up with a NAMED error rather than a bare abort", async () => {
    // The whole complaint about the old behaviour: it arrived as
    // "AbortError: Request aborted", which says a timer fired and nothing
    // about what went wrong.
    const open = vi.fn(async (signal: AbortSignal) => silent(signal));

    await expect(
      collect(streamModelEvents(open, { firstEventMs: DEADLINE_MS, attempts: 2 })),
    ).rejects.toThrow(ModelSilentError);

    expect(open).toHaveBeenCalledTimes(2);
  });

  it("STOPS RETRYING once anything has been yielded, so no reader sees an answer twice", async () => {
    // The safety condition on the whole idea. A stream that dies halfway has
    // already shown the reader the first half; asking again would replay it.
    const open = vi.fn(async (signal: AbortSignal) => {
      async function* half(): AsyncGenerator<string> {
        yield "first half";
        // Now go quiet for longer than the deadline would have allowed.
        await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          setTimeout(() => reject(new Error("stream died")), DEADLINE_MS * 2);
        });
      }

      return half();
    });

    await expect(collect(streamModelEvents(open, { firstEventMs: DEADLINE_MS }))).rejects.toThrow(
      /stream died/,
    );

    expect(open).toHaveBeenCalledTimes(1);
  });

  it("does NOT re-arm the deadline after the first event, so a slow answer is left alone", async () => {
    // The reason the deadline is a cancellable controller rather than
    // AbortSignal.timeout. Before the first token, silence is pathological;
    // after it, a gap is just the model thinking, and bounding it would
    // truncate exactly the answers worth waiting for.
    const open = vi.fn(async () => paced(["one", "two"], DEADLINE_MS * 1.5));

    await expect(collect(streamModelEvents(open, { firstEventMs: DEADLINE_MS * 3 }))).resolves.toEqual([
      "one",
      "two",
    ]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry a failure that has a name of its own", async () => {
    // Throttling, a bad key, a malformed request: each has already been
    // through the SDK's ladder and means something. Asking again pays twice
    // to be told the same thing.
    const open = vi.fn(async () => {
      throw new Error("ThrottlingException: Too many requests");
    });

    await expect(collect(streamModelEvents(open, { firstEventMs: DEADLINE_MS }))).rejects.toThrow(
      /ThrottlingException/,
    );
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry once the CALLER has given up", async () => {
    // The turn's budget is spent or the reader closed the tab. There is
    // nobody waiting for a second attempt, and spending one is a paid call
    // whose answer is thrown away.
    const caller = new AbortController();

    const open = vi.fn(async (signal: AbortSignal) => {
      setTimeout(() => caller.abort(new Error("the turn ended")), 10);
      return silent(signal);
    });

    await expect(
      collect(streamModelEvents(open, { firstEventMs: DEADLINE_MS, signal: caller.signal })),
    ).rejects.toThrow();

    expect(open).toHaveBeenCalledTimes(1);
  });

  it("refuses a missing stream rather than iterating undefined", async () => {
    const open = vi.fn(async () => undefined);

    await expect(collect(streamModelEvents(open, { firstEventMs: DEADLINE_MS }))).rejects.toThrow(
      /no stream/,
    );
    // Not a stall, so not retried.
    expect(open).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------------------
// THE ARITHMETIC, WHICH IS THE PART THAT SILENTLY STOPS WORKING.
//
// Retrying produces no events, so the idle budget above this sees a whole
// retry sequence as one unbroken silence. If the attempts do not fit inside
// that budget the caller aborts mid-ladder and the retry never happens -
// which is the same trap bedrock-client.ts documents for the SDK's own
// ladder, one level up, and it fails by doing nothing rather than by
// breaking.
// -------------------------------------------------------------------
describe("the retry ladder fits inside the phase that covers it", () => {
  it("leaves the model phase room for every attempt", () => {
    expect(MODEL_FIRST_EVENT_WORST_CASE_MS).toBe(MODEL_FIRST_EVENT_MS * MODEL_FIRST_EVENT_ATTEMPTS);
    expect(MODEL_FIRST_EVENT_WORST_CASE_MS).toBeLessThan(CHAT_PHASES.model.budgetMs);
  });

  it("keeps enough headroom that the last attempt can actually answer", () => {
    // A ladder that ends on the same millisecond the budget does is one
    // where the final attempt has no time to produce anything, so the retry
    // buys nothing. Ten seconds is a whole time-to-first-token over.
    expect(CHAT_PHASES.model.budgetMs - MODEL_FIRST_EVENT_WORST_CASE_MS).toBeGreaterThanOrEqual(10_000);
  });

  it("fails fast enough to be worth doing", () => {
    // The point of the change: a stalled turn used to cost the reader the
    // full phase budget and then die. It must now cost meaningfully less
    // than that per attempt, or nothing has improved.
    expect(MODEL_FIRST_EVENT_MS).toBeLessThan(CHAT_PHASES.model.budgetMs / 2);
  });
});
