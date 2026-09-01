import { describe, expect, it } from "vitest";

import { MAX_TOOL_ROUNDS } from "./ai-chat-tools";
import { CHAT_PLATFORM_CEILING_MS, CHAT_TURN_TIMEOUT_MS } from "./ai-chat.types";

// -------------------------------------------------------------------
// How long one chat reply may take.
//
// THIS FILE EXISTS BECAUSE A TURN HAD NO CEILING AND NOBODY COULD SEE IT.
// Two failed replies in the request log ran for 1,081 and 1,441 seconds -
// eighteen and twenty-four minutes - and every individual number involved
// looked reasonable on its own. They multiplied: five passes over the
// model, five SDK attempts each, two minutes per attempt.
//
// The Bedrock client's own settings are not asserted here, deliberately.
// They are shared with the transcription summariser and the one-shot
// converseText path, which want a different envelope from an interactive
// chat. What must hold is that SOMETHING bounds the whole turn, and that
// the thing bounding it gives up before the platform does.
// -------------------------------------------------------------------

describe("chat turn budget", () => {
  it("gives up before the platform severs the connection", () => {
    // Whoever gives up first decides what the reader sees. If Azure's load
    // balancer wins, the stream is cut mid-flight and the app never learns
    // it happened - which is precisely how a reply carried on being
    // retried for twenty minutes after its reader had gone.
    expect(CHAT_TURN_TIMEOUT_MS).toBeLessThan(CHAT_PLATFORM_CEILING_MS);
  });

  it("leaves enough margin to close the stream and record the failure", () => {
    // Not just "less than". Ending cleanly means writing to the stream and
    // a row to the request log, and a second under the wire is not room to
    // do either.
    expect(CHAT_PLATFORM_CEILING_MS - CHAT_TURN_TIMEOUT_MS).toBeGreaterThanOrEqual(20_000);
  });

  it("allows a real answer rather than only the overhead", () => {
    // A deadline tight enough to kill ordinary replies would be its own
    // bug. A tool-using turn needs several passes and each has to be worth
    // making, so the budget has to be meaningfully more than the number of
    // passes it permits.
    const passes = MAX_TOOL_ROUNDS + 1;

    expect(CHAT_TURN_TIMEOUT_MS / passes).toBeGreaterThanOrEqual(30_000);
  });

  it("is stated in the platform's terms, not a round number", () => {
    // 230s is Azure App Service's documented request limit. If this ever
    // stops matching the platform the app is deployed to, both numbers move
    // together - which is only possible because the ceiling is written down
    // rather than folded into the timeout.
    expect(CHAT_PLATFORM_CEILING_MS).toBe(230_000);
  });
});
