import { describe, expect, it } from "vitest";

import { CHAT_STALL_TIMEOUT_MS } from "@/features/ai-chat/ai-chat.types";

import { MAX_ATTEMPTS, READ_TIMEOUT_MS } from "./bedrock-client";

// -------------------------------------------------------------------
// The SDK's retry ladder must finish before the caller stops waiting.
//
// THIS EXISTS BECAUSE THE TWO NUMBERS WERE SET INDEPENDENTLY AND NOBODY
// MULTIPLIED THEM.
//
// The socket timeout was 120s with five attempts; chat bounds silence at
// 150s. One stalled attempt therefore consumed 120 of the 150 seconds
// inside the SDK, the stall guard fired 30 seconds into attempt two, and
// the ladder never completed - so its only effect was to turn a fast,
// nameable failure into 150 seconds of nothing. A production reply failed
// exactly that way at 149,946ms with every token count null.
//
// The failure mode is invisible until it happens: nothing is wrong while
// calls succeed, and the first stalled call stalls for the maximum. So the
// relationship gets a test rather than a comment, because a comment does
// not fail the build when somebody raises a timeout.
// -------------------------------------------------------------------

// The SDK backs off between attempts. Adaptive mode adds jitter and a
// client-side rate limiter, so the real gap is not knowable here - this is
// a deliberately pessimistic allowance, because being wrong in the generous
// direction is what keeps the assertion meaningful.
const ASSUMED_BACKOFF_MS = 5_000;

describe("the Bedrock retry budget", () => {
  it("gives up before the chat stall guard does", () => {
    // Every attempt can burn the full socket timeout, with a backoff
    // between each pair.
    const worstCase = MAX_ATTEMPTS * READ_TIMEOUT_MS + (MAX_ATTEMPTS - 1) * ASSUMED_BACKOFF_MS;

    // Strictly less, not "about the same": the point is that the SDK fails
    // FIRST, so the error carries a name - ThrottlingException, a timeout -
    // rather than the guard aborting anonymously.
    expect(worstCase).toBeLessThan(CHAT_STALL_TIMEOUT_MS);
  });

  it("leaves real headroom, not a few milliseconds", () => {
    const worstCase = MAX_ATTEMPTS * READ_TIMEOUT_MS + (MAX_ATTEMPTS - 1) * ASSUMED_BACKOFF_MS;

    // A margin this side of a third. Tight enough to notice, wide enough
    // that ordinary variance in backoff cannot close it.
    expect(CHAT_STALL_TIMEOUT_MS - worstCase).toBeGreaterThan(CHAT_STALL_TIMEOUT_MS / 4);
  });

  it("still retries once, so a transient blip is survivable", () => {
    // Dropping to a single attempt would trade one bad failure mode for
    // another: every momentary 5xx would reach the reader.
    expect(MAX_ATTEMPTS).toBeGreaterThanOrEqual(2);
  });

  it("keeps the socket timeout well under the whole budget on its own", () => {
    // The original bug in one line: a single attempt must never be able to
    // eat most of the patience by itself.
    expect(READ_TIMEOUT_MS).toBeLessThan(CHAT_STALL_TIMEOUT_MS / 2);
  });
});
