import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { CHAT_FIRST_BYTE_CEILING_MS, CHAT_PHASES, CHAT_PLATFORM_IDLE_CEILING_MS } from "@/features/ai-chat/ai-chat.types";
import { MAX_TOOL_ROUNDS } from "@/features/ai-chat/ai-chat-tools";

import {
  AZURE_OUTBOUND_IDLE_MS,
  BEDROCK_KEEP_ALIVE_MS,
  BEDROCK_LADDER_WORST_CASE_MS,
  BEDROCK_MAX_FREE_SOCKETS,
  BEDROCK_MAX_SOCKETS,
  BEDROCK_SOCKET_IDLE_MS,
  MAX_ATTEMPTS,
  SMITHY_DEFAULT_MAX_SOCKETS,
} from "./bedrock-client";
import { converseCeilingFor } from "./converse";

// ===================================================================
// THE FOUR LAYERS THAT CAN GIVE UP ON A REPLY, AND THE ORDER THEY MUST DO
// IT IN
//
// A layered system should fail at the layer that knows most about the
// failure, because that layer is the only one that can name it:
//
//   1. the socket, which knows it went quiet and for how long
//   2. the SDK's retry ladder, which knows it already tried again
//   3. our per-phase budget, which knows which stage overran
//   4. Azure's load balancer, which knows nothing and tells us nothing
//
// Innermost first. Every time that order has been broken in this codebase,
// the same thing happened: the outer layer fired, the specific error was
// never thrown, and the failure arrived as a bare AbortError with no cause.
//
// THIS FILE EXISTS BECAUSE IT WAS BROKEN TWICE, in different ways, and
// neither was visible until a call actually stalled:
//
//   The first time, the numbers were multiplied by nobody. The socket
//   timeout was 120s with five attempts while chat bounded silence at 150s -
//   so one stalled attempt ate 120 of the 150 seconds inside the SDK, our
//   guard fired 30 seconds into attempt two, and the ladder could never
//   finish. Its only effect was to turn a fast nameable failure into 150
//   seconds of nothing. A production reply failed exactly that way at
//   149,946ms with every token count null.
//
//   The second time, the option being set was the wrong option. `requestTimeout`
//   only emits a WARNING unless throwOnRequestTimeout is also passed, so
//   there was no inactivity timeout on Bedrock at all: layers 1 and 2 never
//   fired, and layer 3 was the only thing that ever stopped anything. The
//   file's own comments confidently described the opposite. See
//   bedrock-client.ts.
//
// So the relationships get a test rather than a comment, because a comment
// does not fail the build when somebody adjusts a number.
// ===================================================================

// Every budget that waits on a model call. These are the ones that must sit
// above the SDK's ladder; a database read has no ladder underneath it.
const MODEL_PHASES = [CHAT_PHASES.compaction, CHAT_PHASES.model];

describe("the Bedrock retry ladder", () => {
  it("still retries once, so a transient blip is survivable", () => {
    // Dropping to a single attempt trades one bad failure mode for another:
    // every momentary 5xx would reach the reader.
    expect(MAX_ATTEMPTS).toBeGreaterThanOrEqual(2);
  });

  it("treats silence as pathological rather than as slowness", () => {
    // Time to first token is a few seconds even on a large cached prompt,
    // and mid-stream gaps are smaller still. This is a backstop, not a
    // service level.
    expect(BEDROCK_SOCKET_IDLE_MS).toBeGreaterThanOrEqual(15_000);
    expect(BEDROCK_SOCKET_IDLE_MS).toBeLessThanOrEqual(45_000);
  });

  it("computes its own worst case from its own parts", () => {
    // Stated rather than assumed, because the first version of this
    // assertion hardcoded a backoff allowance and then drifted from the
    // client it was describing.
    expect(BEDROCK_LADDER_WORST_CASE_MS).toBeGreaterThan(BEDROCK_SOCKET_IDLE_MS * MAX_ATTEMPTS);
  });
});

describe("phase budgets against the ladder below them", () => {
  it.each(MODEL_PHASES)("lets the SDK name the failure first: $name", (phase) => {
    // THE RULE. Strictly greater, not "about the same": the point is that
    // the SDK fails FIRST, so the error carries a name - a TimeoutError
    // saying how long the socket was quiet, a ThrottlingException - instead
    // of our guard aborting with only a phase name to offer.
    expect(phase.budgetMs).toBeGreaterThan(BEDROCK_LADDER_WORST_CASE_MS);
  });

  it.each(MODEL_PHASES)("leaves real headroom, not milliseconds: $name", (phase) => {
    // Wide enough that ordinary variance in the SDK's backoff cannot close
    // it, since the real sleep is jittered and not knowable from here.
    // (This said "adaptive backoff" when the client used retryMode
    // "adaptive". It does not any more, and the reason is worth the trip:
    // adaptive adds a client-side rate limiter that arms permanently on the
    // first throttle and paces every user through one shared bucket. See the
    // block on retryMode in bedrock-client.ts.)
    expect(phase.budgetMs - BEDROCK_LADDER_WORST_CASE_MS).toBeGreaterThanOrEqual(5_000);
  });

  it("measures a model phase on silence, never on total duration", () => {
    // The regression a duration budget causes. A full-length reply from this
    // model streams for minutes; capping its total truncates precisely the
    // answers worth waiting for.
    for (const phase of MODEL_PHASES) {
      expect(phase.kind).toBe("idle");
    }
  });
});

describe("the ceiling against the platform", () => {
  it("gives up before Azure severs the connection", () => {
    // Both are idle measures, which is the only reason they are comparable.
    // Whoever gives up first decides what the reader sees: if the load
    // balancer wins, the stream is cut and the app never learns it happened.
    expect(CHAT_FIRST_BYTE_CEILING_MS).toBeLessThan(CHAT_PLATFORM_IDLE_CEILING_MS);
  });

  it("leaves room to close the stream and record the failure", () => {
    expect(CHAT_PLATFORM_IDLE_CEILING_MS - CHAT_FIRST_BYTE_CEILING_MS).toBeGreaterThanOrEqual(20_000);
  });

  it("bounds the phases it is there to bound", () => {
    // The ceiling only earns its keep if it is reachable before the phases
    // that precede the first byte have all expired in turn. If the sum were
    // smaller, each phase would fire on its own and the ceiling would be
    // decoration.
    const beforeFirstByte =
      CHAT_PHASES.session.budgetMs +
      CHAT_PHASES.question.budgetMs +
      CHAT_PHASES.history.budgetMs +
      CHAT_PHASES.attachments.budgetMs +
      CHAT_PHASES.compaction.budgetMs +
      CHAT_PHASES.model.budgetMs;

    expect(beforeFirstByte).toBeGreaterThan(CHAT_FIRST_BYTE_CEILING_MS);
  });
});

describe("the quiet gaps that are not stalls", () => {
  it("covers a tool round without calling a healthy turn dead", () => {
    // Nothing is streamed while a tool runs between passes, and the model
    // phase's clock is reset by every stream EVENT rather than by text - but
    // the tool call itself is a separate phase and needs its own room.
    expect(CHAT_PHASES.tool.budgetMs).toBeGreaterThanOrEqual(20_000);
  });

  it("does not let the tool rounds alone exhaust the ceiling", () => {
    // MAX_TOOL_ROUNDS lookups, each allowed its full budget, all happening
    // before a single word has reached the reader. That is the worst case
    // for a question that needs figures before it can be answered.
    expect(CHAT_PHASES.tool.budgetMs * MAX_TOOL_ROUNDS).toBeLessThan(CHAT_FIRST_BYTE_CEILING_MS);
  });
});

// ===================================================================
// A ONE-SHOT CALL'S OWN CEILING
//
// These are the calls with no reader watching a cursor: a folder
// suggestion, a timesheet question, a compaction summary. They get a TOTAL
// ceiling rather than relying on the idle timeout, and production is the
// reason: a stalled Bedrock call runs to that ceiling every time while
// socketTimeout never fires, because an AWS event stream carries periodic
// frames and the socket is therefore never idle. An idle timeout cannot see
// the common failure.
// ===================================================================
describe("a one-shot call's ceiling", () => {
  it("is derived from what was asked for, not shared", () => {
    // The bug this fixes. Every converseText call sat on one 120s default,
    // so a 300-token folder suggestion was given the same budget as a long
    // report - and a stalled one spent all of it, four times over, because
    // each filing retry pays the ceiling again.
    expect(converseCeilingFor(300)).toBeLessThan(converseCeilingFor(4_000));
  });

  it("scales with the token cap, so raising one raises the other", () => {
    expect(converseCeilingFor(600) - converseCeilingFor(300)).toBeGreaterThan(0);
  });

  it("allows for prefill, because the prompt is the slow part here", () => {
    // A filing prompt carries up to MAX_FOLDER_OPTIONS paths. Generating 300
    // tokens takes seconds; reading that prompt is most of the wait, so a
    // ceiling derived from output alone would abort healthy calls.
    expect(converseCeilingFor(0)).toBeGreaterThanOrEqual(20_000);
  });

  it("is DELIBERATELY tighter than the SDK ladder, unlike a chat phase", () => {
    // ===============================================================
    // THIS CONTRADICTS THE RULE ABOVE ON PURPOSE, and the difference is
    // worth stating rather than discovering.
    //
    // A chat phase budget sits ABOVE the ladder so the SDK gets to fire
    // first and name the failure. That trade is worth 70 seconds when
    // somebody is watching a cursor and the name is the remedy.
    //
    // It is not worth it here. The failure these calls actually hit is a
    // stream that heartbeats and delivers nothing, which the SDK cannot
    // name at all - so waiting for a naming that will never come just
    // spends the budget. Our own message for it is specific enough:
    // "produced nothing for the full 40s allowed".
    // ===============================================================
    expect(converseCeilingFor(300)).toBeLessThan(BEDROCK_LADDER_WORST_CASE_MS);
  });

  it("still leaves room for ONE attempt to time out and name itself", () => {
    // The part of the naming that is worth keeping. A genuinely dead socket
    // fails at BEDROCK_SOCKET_IDLE_MS on the first attempt, and the ceiling
    // has to be past that or even the honest case never gets its name.
    expect(converseCeilingFor(300)).toBeGreaterThan(BEDROCK_SOCKET_IDLE_MS);
  });
});

// ===================================================================
// THE RETRY MODE
//
// A test on one string, because that one string was a production fault and
// the next person to read "adaptive" will think it sounds like the clever
// option.
//
// Adaptive mode adds a client-side rate limiter that SLEEPS BEFORE THE
// REQUEST IS SENT, latches on at the first throttling response and never
// off, and lives on a process-wide client shared by every AI feature. A
// call can spend its whole ceiling in that sleep having never reached AWS -
// with no socket open, so nothing at the transport layer can see it, and
// $metadata reporting a retry delay of under a hundred milliseconds because
// the limiter's wait is not retry delay.
//
// See the block in bedrock-client.ts for the SDK source this is quoting.
// ===================================================================
describe("the retry mode", () => {
  it("is standard, so a throttle arrives fast and named", async () => {
    // Read from the built client rather than from a constant, because the
    // constant is not what would drift - somebody editing the client is.
    const source = await readFile(
      new URL("./bedrock-client.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('retryMode: "standard"');
    expect(source).not.toContain('retryMode: "adaptive"');
  });
});

// ===================================================================
// THE CONNECTION POOL.
//
// The one failure in this file that only ever happened in production, and
// the asymmetry is the evidence: the same key, region and model served a
// working dev portal while production was dead for everybody at the same
// moment. A model-side problem cannot do that; a per-process resource can.
//
// The SDK caps concurrent connections at 50 per agent, the agent belongs to
// the client, the client is a module singleton and the deploy is a single
// App Service instance - so 50 was the whole application's simultaneous
// Bedrock capacity. Exhausting it does not fail: Node's Agent QUEUES the
// next request with no deadline, and a queued request has no socket, so
// neither connectionTimeout nor socketTimeout can see it. It just waits,
// which is indistinguishable from a model that answered nothing.
//
// These assertions exist because the fix is a set of numbers that look
// arbitrary and are not. Reverting any of them reintroduces a hang that
// takes days to attribute.
// ===================================================================
describe("the Bedrock connection pool", () => {
  it("raises the cap above the SDK default that was the whole app's capacity", () => {
    expect(BEDROCK_MAX_SOCKETS).toBeGreaterThan(SMITHY_DEFAULT_MAX_SOCKETS);
  });

  it("does NOT go unlimited, which trades a hidden queue for a hidden SNAT pool", () => {
    // Azure gives an instance a small pool of outbound ports. Unlimited
    // sockets would let Bedrock consume it and take Graph, blob storage and
    // email down with it - a worse failure than the one being fixed, and
    // harder to attribute because it lands somewhere else.
    expect(Number.isFinite(BEDROCK_MAX_SOCKETS)).toBe(true);
    expect(BEDROCK_MAX_SOCKETS).toBeLessThanOrEqual(256);
  });

  it("keeps only a few connections warm, because an idle one still holds a port", () => {
    expect(BEDROCK_MAX_FREE_SOCKETS).toBeGreaterThan(0);
    expect(BEDROCK_MAX_FREE_SOCKETS).toBeLessThan(BEDROCK_MAX_SOCKETS);
  });

  it("releases a kept-alive connection well before Azure severs it", () => {
    // If the platform tears the connection down first, the teardown arrives
    // as a socket hang-up in the middle of somebody's reply rather than as a
    // connection we chose to drop.
    expect(BEDROCK_KEEP_ALIVE_MS).toBeLessThan(AZURE_OUTBOUND_IDLE_MS / 2);
  });

  it("leaves the pool bigger than any one turn can hold on its own", () => {
    // A streaming reply holds its socket for the whole answer, so the cap is
    // really a limit on concurrent REPLIES, not on requests per second. It
    // has to be comfortably above the number of people who might be waiting
    // on one at the same time.
    expect(BEDROCK_MAX_SOCKETS).toBeGreaterThanOrEqual(64);
  });
});
