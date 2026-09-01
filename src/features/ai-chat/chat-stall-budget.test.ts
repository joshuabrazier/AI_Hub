import { describe, expect, it } from "vitest";

import { MAX_TOOL_ROUNDS } from "./ai-chat-tools";
import { CHAT_PLATFORM_IDLE_CEILING_MS, CHAT_STALL_TIMEOUT_MS } from "./ai-chat.types";

// -------------------------------------------------------------------
// What bounds a chat reply.
//
// The first version of this file asserted a TOTAL duration, which was the
// wrong quantity and would have truncated any reply longer than about six
// thousand tokens. What actually failed in production was silence: the
// stored error reads "Stream timed out because of no activity for 120000
// ms", five times over, with the SDK's backoff between the attempts.
//
// So these assert the relationships that hold for a clock measuring
// silence, and there is deliberately no assertion about how long a reply
// may run. It may run as long as it keeps talking.
// -------------------------------------------------------------------

// One Bedrock attempt gives up after this much inactivity, then the SDK
// retries. Not imported - it is private to the client - so it is written
// here as the number the stall timeout is sized against, and named so a
// change to one prompts a look at the other.
const BEDROCK_ATTEMPT_TIMEOUT_MS = 120_000;

describe("chat stall budget", () => {
  it("gives up before the platform severs the connection", () => {
    // Both are idle measures, which is the only reason they are comparable.
    // Whoever gives up first decides what the reader sees: if the load
    // balancer wins, the stream is cut and the app never learns it happened.
    expect(CHAT_STALL_TIMEOUT_MS).toBeLessThan(CHAT_PLATFORM_IDLE_CEILING_MS);
  });

  it("leaves room to close the stream and record the failure", () => {
    expect(CHAT_PLATFORM_IDLE_CEILING_MS - CHAT_STALL_TIMEOUT_MS).toBeGreaterThanOrEqual(20_000);
  });

  it("survives one stalled attempt so a successful retry still lands", () => {
    // A stall timeout below one attempt would abandon requests the SDK was
    // about to rescue, which trades a rare failure for a common one.
    expect(CHAT_STALL_TIMEOUT_MS).toBeGreaterThan(BEDROCK_ATTEMPT_TIMEOUT_MS);
  });

  it("cuts the retry ladder rather than riding it to twenty-four minutes", () => {
    // The bug. Five attempts of two minutes, with adaptive backoff sleeping
    // between them, is how one reply reached 1,441 seconds. Giving up inside
    // two attempts is what stops that.
    expect(CHAT_STALL_TIMEOUT_MS).toBeLessThan(BEDROCK_ATTEMPT_TIMEOUT_MS * 2);
  });

  it("covers the quiet gaps that are not stalls", () => {
    // Nothing is streamed while the model reads the conversation, nor while
    // a tool runs between passes. Both are seconds; the budget has to have
    // room for several of them without calling a healthy turn dead.
    const quietGapsPerTurn = MAX_TOOL_ROUNDS + 1;

    expect(CHAT_STALL_TIMEOUT_MS / quietGapsPerTurn).toBeGreaterThanOrEqual(20_000);
  });
});
