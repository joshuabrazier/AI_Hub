import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTurnGuard } from "@/lib/ai/turn-guard";
import { AI_CHAT_ROLES, USER_ROLES } from "@/lib/data/kysely-database-types";

// ===================================================================
// ONE CHAT TURN, WITH BEDROCK AND THE DATABASE MOCKED
//
// The unit tests either side of this one are sound and were not enough. The
// turn guard is tested on its own, the stream protocol is tested on its own,
// and the failure this all exists for lived in the SEAM: a clock created in
// one file, armed before work that happened in another, describing a phase
// that had not started yet.
//
// So these assert the wiring, and each one is a regression that reached
// production:
//
//   - a failure names the PHASE it happened in, not the last thing anybody
//     happened to be waiting for
//   - a slow compaction is attributed to compaction, and does not report
//     that the model sent nothing before the model was asked
//   - a failure BEFORE the model writes a request-log row at all, which the
//     old shape did not, so the admin log showed nothing
//   - durationMs covers the whole turn, not the part after the slow bit
//   - the reader is told what is happening while there is nothing to show
//   - a partial reply is kept when the stream dies halfway
// ===================================================================

vi.mock("server-only", () => ({}));

// handleError calls unstable_rethrow on every catch, so a missing mock makes
// every failure throw from the error handler instead of from the thing under
// test.
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  redirect: vi.fn(),
  unstable_rethrow: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("better-auth", () => ({ generateId: () => "generated-id" }));

vi.mock("@/lib/auth/session-auth-server", () => ({ requireUser: vi.fn() }));

vi.mock("@/lib/ai/bedrock-client", () => ({
  BEDROCK_MODEL_ID: "test-model",
  BEDROCK_REGION: "ap-southeast-2",
  getBedrockClient: vi.fn(),
  isBedrockConfigured: () => true,
}));

vi.mock("@/lib/ai/house-voice", () => ({ buildHouseVoiceBlock: () => ({ text: "house voice" }) }));

vi.mock("@/lib/storage/attachment-storage", () => ({
  attachmentStorageKey: vi.fn(),
  deleteAttachment: vi.fn(),
  deleteAttachmentsForSubject: vi.fn(),
  getAttachment: vi.fn(),
  isAttachmentStorageConfigured: () => true,
  putAttachment: vi.fn(),
}));

vi.mock("./ai-chat-app-knowledge", () => ({ appKnowledgePrompt: () => "app knowledge" }));

vi.mock("./ai-chat-tools", () => ({
  CHAT_TOOL_CONFIG: { tools: [] },
  MAX_TOOL_ROUNDS: 4,
  runChatTool: vi.fn(),
}));

vi.mock("@/lib/data/repositories/ai-chat-attachments.repository", () => ({
  addAiChatAttachmentRepo: vi.fn(),
  claimStagedAiChatAttachmentsRepo: vi.fn(async () => 0),
  deleteStagedAiChatAttachmentRepo: vi.fn(),
  getAiChatAttachmentBytesForSubjectRepo: vi.fn(async () => []),
  getAiChatAttachmentsForSubjectRepo: vi.fn(async () => []),
  getStagedAiChatAttachmentsRepo: vi.fn(async () => []),
}));

vi.mock("@/lib/data/repositories/ai-chat-messages.repository", () => ({
  addAiChatMessageRepo: vi.fn(),
  getAiChatMessagesBySubjectRepo: vi.fn(),
}));

vi.mock("@/lib/data/repositories/ai-chat-request-logs.repository", () => ({
  addAiChatRequestLogRepo: vi.fn(),
  boundPayload: (value: string) => ({ value, truncated: false }),
}));

vi.mock("@/lib/data/repositories/ai-chat-subjects.repository", () => ({
  createAiChatSubjectRepo: vi.fn(),
  deleteAiChatSubjectForUserRepo: vi.fn(),
  getAiChatSubjectForUserRepo: vi.fn(),
  getAiChatSubjectsForUserRepo: vi.fn(),
  touchAiChatSubjectRepo: vi.fn(),
  updateAiChatSubjectForUserRepo: vi.fn(),
}));

const { requireUser } = await import("@/lib/auth/session-auth-server");
const { getBedrockClient } = await import("@/lib/ai/bedrock-client");
const { addAiChatMessageRepo, getAiChatMessagesBySubjectRepo } = await import(
  "@/lib/data/repositories/ai-chat-messages.repository"
);
const { addAiChatRequestLogRepo } = await import(
  "@/lib/data/repositories/ai-chat-request-logs.repository"
);
const { getAiChatSubjectForUserRepo } = await import(
  "@/lib/data/repositories/ai-chat-subjects.repository"
);

const { streamAiChatReplyService } = await import("./ai-chat.service");
const { CHAT_PHASES, COMPACT_AT_INPUT_TOKENS } = await import("./ai-chat.types");

// -------------------------------------------------------------------
// A fake Converse stream. Yields whatever events the test wants, or throws
// where the test wants a failure, so a stall and a mid-stream death are both
// expressible without a network.
// -------------------------------------------------------------------
type FakeEvent = Record<string, unknown>;

function textStream(chunks: string[], options: { throwAfter?: number } = {}) {
  return {
    stream: (async function* () {
      for (const [index, chunk] of chunks.entries()) {
        if (options.throwAfter !== undefined && index === options.throwAfter) {
          const error = new Error("the request socket timed out after 25000 ms of inactivity");
          error.name = "TimeoutError";
          throw error;
        }

        yield { contentBlockDelta: { delta: { text: chunk } } } as FakeEvent;
      }

      yield { messageStop: { stopReason: "end_turn" } } as FakeEvent;
      yield { metadata: { usage: { inputTokens: 10, outputTokens: 5 } } } as FakeEvent;
    })(),
  };
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    subjectId: "s1",
    role: AI_CHAT_ROLES.USER,
    content: "hello",
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    createdAt: new Date("2026-09-09T00:00:00Z"),
    ...overrides,
  };
}

function lastLog() {
  const calls = vi.mocked(addAiChatRequestLogRepo).mock.calls;
  return calls.at(-1)?.[0] as Record<string, unknown> | undefined;
}

// The turn's log row, told apart from the compaction row that may precede it.
function chatLog() {
  const calls = vi.mocked(addAiChatRequestLogRepo).mock.calls;
  return calls.map((call) => call[0] as Record<string, unknown>).find((row) => row.kind === "chat");
}

async function drain(generator: AsyncGenerator<{ t: string; v: string }, void, undefined>) {
  const events: { t: string; v: string }[] = [];

  for await (const event of generator) events.push(event);

  return events;
}

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(requireUser).mockResolvedValue({
    id: "u1",
    name: "Louis",
    role: USER_ROLES.ADMIN,
  } as Awaited<ReturnType<typeof requireUser>>);

  vi.mocked(getAiChatSubjectForUserRepo).mockResolvedValue({
    id: "s1",
    userId: "u1",
    title: "A conversation",
    summary: null,
    summaryThroughMessageId: null,
  } as Awaited<ReturnType<typeof getAiChatSubjectForUserRepo>>);

  vi.mocked(addAiChatMessageRepo).mockImplementation(async (row) => message(row) as never);
  vi.mocked(getAiChatMessagesBySubjectRepo).mockResolvedValue([message()] as never);
});

describe("a healthy turn", () => {
  it("tells the reader what it is doing before there is anything to show", () => {
    // The cheapest half of the reliability fix. A wait nobody can see the
    // reason for reads as a broken page, and most of what was reported as
    // "the AI keeps failing" was exactly that.
    expect(CHAT_PHASES.compaction.status).toContain("Summarising");
    expect(CHAT_PHASES.model.status).toBe("Thinking");
  });

  it("streams status events, then the reply", async () => {
    vi.mocked(getBedrockClient).mockReturnValue({
      send: vi.fn(async () => textStream(["Hello", " there"])),
    } as unknown as ReturnType<typeof getBedrockClient>);

    const guard = createTurnGuard();
    const events = await drain(streamAiChatReplyService({ subjectId: "s1", content: "hi" }, guard));

    const text = events.filter((event) => event.t === "text").map((event) => event.v);
    const statuses = events.filter((event) => event.t === "status").map((event) => event.v);

    expect(text).toEqual(["Hello", " there"]);

    // Every phase before the model announced itself, in order.
    expect(statuses).toEqual([
      CHAT_PHASES.question.status,
      CHAT_PHASES.history.status,
      CHAT_PHASES.attachments.status,
      CHAT_PHASES.compaction.status,
      CHAT_PHASES.model.status,
    ]);

    // Status comes first, so nothing is ever waiting with a blank screen.
    expect(events[0].t).toBe("status");
  });

  it("records the whole turn's timeline, and no failure", async () => {
    vi.mocked(getBedrockClient).mockReturnValue({
      send: vi.fn(async () => textStream(["Hi"])),
    } as unknown as ReturnType<typeof getBedrockClient>);

    const guard = createTurnGuard();
    await drain(streamAiChatReplyService({ subjectId: "s1", content: "hi" }, guard));

    const log = chatLog();

    expect(log?.error).toBeNull();

    const phases = JSON.parse(String(log?.phases)) as { phases: { name: string }[] };

    // The phases the turn actually went through, which is the thing the log
    // could not say before. `persist-reply` is last because the row is
    // written from the finally that persists the answer.
    expect(phases.phases.map((phase) => phase.name)).toEqual([
      CHAT_PHASES.session.name,
      CHAT_PHASES.question.name,
      CHAT_PHASES.history.name,
      CHAT_PHASES.attachments.name,
      CHAT_PHASES.compaction.name,
      CHAT_PHASES.model.name,
      CHAT_PHASES.persist.name,
    ]);
  });

  it("times the WHOLE turn, including everything before the model", async () => {
    // The old code set startedAt after compaction, so the slowest phase of a
    // turn sat outside the number describing the turn. That is why the log
    // could not answer "where did those twenty seconds go" for the failures
    // it was recording.
    vi.mocked(getBedrockClient).mockReturnValue({
      send: vi.fn(async () => textStream(["Hi"])),
    } as unknown as ReturnType<typeof getBedrockClient>);

    const guard = createTurnGuard();
    await drain(streamAiChatReplyService({ subjectId: "s1", content: "hi" }, guard));

    const log = chatLog();
    const phases = JSON.parse(String(log?.phases)) as { totalMs: number };

    // The recorded duration covers at least as much as the phase timeline
    // does, which is only true if it starts before the first phase.
    expect(Number(log?.durationMs)).toBeGreaterThanOrEqual(phases.totalMs - 5);
  });

  it("saves the reply", async () => {
    vi.mocked(getBedrockClient).mockReturnValue({
      send: vi.fn(async () => textStream(["Hello", " there"])),
    } as unknown as ReturnType<typeof getBedrockClient>);

    await drain(streamAiChatReplyService({ subjectId: "s1", content: "hi" }, createTurnGuard()));

    const written = vi
      .mocked(addAiChatMessageRepo)
      .mock.calls.map((call) => call[0])
      .find((row) => row.role === AI_CHAT_ROLES.ASSISTANT);

    expect(written?.content).toBe("Hello there");
  });
});

describe("a failure names its phase", () => {
  it("attributes a slow compaction to compaction, not to the model", async () => {
    // ===============================================================
    // THE HEADLINE REGRESSION, and the whole reason for the rewrite.
    //
    // A thread past COMPACT_AT_INPUT_TOKENS runs a full model call to
    // summarise itself BEFORE the reply is requested. Under the old single
    // clock - armed in the route, twenty seconds, named after the model's
    // first token - that call outlasted the budget every time, and the
    // failure read "the model sent nothing for 20 seconds" when the model
    // had not been asked anything at all.
    //
    // Compaction needs a real thread to trigger: more than
    // KEEP_RECENT_MESSAGES turns, and a last assistant turn expensive enough
    // to be worth folding. Twelve of them, which is an ordinary week of one
    // conversation.
    // ===============================================================
    const thread = Array.from({ length: 12 }, (_, index) =>
      message({
        id: `m${index}`,
        role: index % 2 === 0 ? AI_CHAT_ROLES.USER : AI_CHAT_ROLES.ASSISTANT,
        inputTokens: index % 2 === 0 ? null : COMPACT_AT_INPUT_TOKENS + 1,
      }),
    );

    vi.mocked(getAiChatMessagesBySubjectRepo).mockResolvedValue(thread as never);

    const guard = createTurnGuard();

    // The compaction call is the FIRST send of the turn. It stalls, and the
    // phase deadline fires while it is in flight - which is exactly the
    // sequence that produced the misattributed message in production. The
    // budget is forced short here; the real 75s is asserted in
    // bedrock-retry-budget.test.ts.
    let sends = 0;

    vi.mocked(getBedrockClient).mockReturnValue({
      send: vi.fn(async () => {
        sends += 1;

        if (sends === 1) {
          guard.phase(CHAT_PHASES.compaction.name, 1, "duration");
          await new Promise((resolve) => setTimeout(resolve, 15));
          throw guard.signal.reason;
        }

        return textStream(["this reply should never be requested"]);
      }),
    } as unknown as ReturnType<typeof getBedrockClient>);

    await expect(
      drain(streamAiChatReplyService({ subjectId: "s1", content: "hi" }, guard)),
    ).rejects.toThrow();

    // Compaction was reached and the reply never was, which is the shape of
    // the real failure.
    expect(sends).toBe(1);

    const log = chatLog();

    // The phase, by name. NOT a claim about the model, which was never asked.
    expect(String(log?.error)).toContain(`"${CHAT_PHASES.compaction.name}"`);
    expect(String(log?.error)).not.toContain("model sent nothing");

    // And the timeline beside it, so somebody can see what the earlier
    // phases cost rather than guessing.
    expect(String(log?.error)).toContain("Turn:");
    expect(String(log?.error)).toContain(CHAT_PHASES.history.name);
  });

  it("keeps a partial reply when the stream dies halfway, and says why", async () => {
    // A reply that failed two thirds through used to render as a short
    // answer with nothing to say otherwise, because the route closed the
    // stream and a browser cannot tell that from a finished one.
    vi.mocked(getBedrockClient).mockReturnValue({
      send: vi.fn(async () => textStream(["Half an ", "answer ", "and then"], { throwAfter: 2 })),
    } as unknown as ReturnType<typeof getBedrockClient>);

    const guard = createTurnGuard();
    const generator = streamAiChatReplyService({ subjectId: "s1", content: "hi" }, guard);

    await expect(drain(generator)).rejects.toThrow();

    // The paid-for text is stored rather than discarded.
    const written = vi
      .mocked(addAiChatMessageRepo)
      .mock.calls.map((call) => call[0])
      .find((row) => row.role === AI_CHAT_ROLES.ASSISTANT);

    expect(written?.content).toBe("Half an answer ");

    // And the socket's own named error survives to the log, because that
    // name is the remedy.
    expect(String(chatLog()?.error)).toContain("TimeoutError");
    expect(String(chatLog()?.error)).toContain("socket timed out after 25000 ms");
  });

  it("writes a log row when the failure happens BEFORE the model", async () => {
    // The old try block began at the model call, so a database or blob
    // failure produced no log row at all - the admin log showed nothing, and
    // the only trace of the turn was an orphaned user message.
    vi.mocked(getAiChatMessagesBySubjectRepo).mockRejectedValue(new Error("the database went away"));

    const guard = createTurnGuard();

    await expect(
      drain(streamAiChatReplyService({ subjectId: "s1", content: "hi" }, guard)),
    ).rejects.toThrow();

    const log = chatLog();

    expect(log).toBeDefined();
    expect(String(log?.error)).toContain("the database went away");
    // Named as the phase it was in, so "the model failed" is never the
    // reported cause of a database problem.
    expect(String(log?.error)).toContain(CHAT_PHASES.history.name);
  });

  it("says a reader left rather than reporting a fault", async () => {
    const reader = new AbortController();
    const guard = createTurnGuard(reader.signal);

    vi.mocked(getBedrockClient).mockReturnValue({
      send: vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            // Checked as well as listened for: a signal that is already
            // aborted never fires the event, and the promise would hang.
            if (guard.signal.aborted) {
              reject(guard.signal.reason);
              return;
            }

            guard.signal.addEventListener("abort", () => reject(guard.signal.reason), { once: true });
          }),
      ),
    } as unknown as ReturnType<typeof getBedrockClient>);

    const generator = streamAiChatReplyService({ subjectId: "s1", content: "hi" }, guard);

    const pump = drain(generator);
    // Let the turn reach the model, then close the tab.
    await new Promise((resolve) => setTimeout(resolve, 20));
    reader.abort();

    await expect(pump).rejects.toThrow();

    expect(String(chatLog()?.error)).toContain("The reader disconnected");
  });
});

describe("without a guard", () => {
  it("still runs, and still reports something", async () => {
    // The service stays callable without a guard so nothing is forced to
    // construct one, and the reporting path must not depend on it either -
    // "no guard" must not mean "no reason".
    vi.mocked(getBedrockClient).mockReturnValue({
      send: vi.fn(async () => {
        throw new Error("Bedrock said no");
      }),
    } as unknown as ReturnType<typeof getBedrockClient>);

    await expect(
      drain(streamAiChatReplyService({ subjectId: "s1", content: "hi" })),
    ).rejects.toThrow();

    expect(String(lastLog()?.error)).toContain("Bedrock said no");
  });
});
