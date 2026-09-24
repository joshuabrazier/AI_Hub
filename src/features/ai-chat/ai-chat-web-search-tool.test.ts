import { beforeEach, describe, expect, it, vi } from "vitest";

// ===================================================================
// THE SEARCH TOOL'S CONTRACT WITH THE CHAT
//
// Three things here fail silently rather than loudly, which is why they are
// asserted rather than trusted:
//
//   the tool is offered when it should not be   - a question quietly leaves
//                                                 the organisation, and the
//                                                 screen looks identical
//   the results arrive unfenced                 - text written by strangers
//                                                 enters the context on the
//                                                 same footing as the system
//                                                 prompt
//   the status names the wrong tool             - somebody watching a web
//                                                 search is told timesheet
//                                                 figures are being read
//
// None of them throws, none of them fails a build, and the first two are
// security properties rather than cosmetic ones.
// ===================================================================

vi.mock("server-only", () => ({}));

vi.mock("@/features/admin-timesheets/timesheet-chat-facts.service", () => ({
  getTimesheetChatFactsService: vi.fn(async () => ({ figures: true })),
}));

const searchWeb = vi.fn();
const isWebSearchConfigured = vi.fn(() => true);

vi.mock("@/lib/search/web-search", () => ({
  searchWeb: (...args: unknown[]) => searchWeb(...args),
  isWebSearchConfigured: () => isWebSearchConfigured(),
}));

// Stated rather than inherited. Without MICROSOFT_* set these tests would
// pass for the accidental reason that the SharePoint tools happen to be
// absent, and would start failing the day somebody put those variables in a
// test env file. This file is about the web search tool; the SharePoint ones
// have their own.
vi.mock("@/lib/auth/account-creation-policy", () => ({
  isMicrosoftSignInConfigured: () => false,
}));

vi.mock("./sharepoint-chat-files.service", () => ({
  createSharepointTurnBudget: () => ({ filesRead: 0, bytesRead: 0, maxFiles: 5, maxBytes: 16 * 1024 * 1024 }),
  findSharepointFilesService: vi.fn(),
  readSharepointFileService: vi.fn(),
}));

const {
  buildChatToolConfig,
  runChatTool,
  toolStatusFor,
  TIMESHEET_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
} = await import("./ai-chat-tools");

const toolNames = (config: { tools?: unknown[] }) =>
  (config.tools ?? []).map((tool) => (tool as { toolSpec?: { name?: string } }).toolSpec?.name);

/**
 * A tool now answers with Converse CONTENT BLOCKS rather than a value, so
 * that reading a SharePoint file can hand over a real document. Everything
 * else is still one text block holding JSON - deliberately text rather than
 * `json`, because the request log only extracts text parts.
 */
const payloadOf = async (...args: Parameters<typeof runChatTool>) => {
  const blocks = await runChatTool(...args);
  const text = blocks.map((block) => ("text" in block ? (block.text ?? "") : "")).join("");

  return JSON.parse(text) as Record<string, unknown>;
};

beforeEach(() => {
  vi.clearAllMocks();
  isWebSearchConfigured.mockReturnValue(true);
});

describe("when the search tool is offered at all", () => {
  it("is absent by default", () => {
    // The default has to be OFF rather than merely documented as off: this is
    // the case that runs on every ordinary question, and it is what keeps a
    // client's name out of a third party's logs.
    expect(toolNames(buildChatToolConfig())).toEqual([TIMESHEET_TOOL_NAME]);
  });

  it("appears only when the turn asked for it", () => {
    expect(toolNames(buildChatToolConfig({ webSearch: true }))).toEqual([
      TIMESHEET_TOOL_NAME,
      WEB_SEARCH_TOOL_NAME,
    ]);
  });

  it("stays absent with no key configured, even when the turn asked", () => {
    // A model handed a tool that answers "not configured" will try it twice
    // before giving up - two paid round trips to learn something the server
    // already knew. And the composer should never have shown the switch.
    isWebSearchConfigured.mockReturnValue(false);

    expect(toolNames(buildChatToolConfig({ webSearch: true }))).toEqual([TIMESHEET_TOOL_NAME]);
  });

  it("never withdraws the timesheet tool", () => {
    // Searching the web is an addition, not a mode. A turn with search on
    // still has to be able to answer "how many hours did I log".
    for (const config of [buildChatToolConfig(), buildChatToolConfig({ webSearch: true })]) {
      expect(toolNames(config)).toContain(TIMESHEET_TOOL_NAME);
    }
  });
});

describe("what comes back from a search", () => {
  it("fences the results and names them as material", async () => {
    // The BEGIN FACTS / END FACTS shape. Everything in a result was written
    // by somebody outside this organisation, and some of them write text
    // aimed at whatever model reads their page.
    searchWeb.mockResolvedValue({
      ok: true,
      query: "as 1100",
      results: [{ title: "t", url: "https://example.com", snippet: "s", source: "example.com" }],
    });

    const output = await payloadOf(WEB_SEARCH_TOOL_NAME, { query: "as 1100" });

    expect(output.note).toContain("BEGIN SEARCH RESULTS");
    expect(output.note).toMatch(/never instruction/i);
    expect(output.end).toBe("END SEARCH RESULTS");
  });

  it("says a search found nothing rather than letting it read as an answer", async () => {
    searchWeb.mockResolvedValue({ ok: true, query: "asdkjh", results: [] });

    const output = await payloadOf(WEB_SEARCH_TOOL_NAME, { query: "asdkjh" });

    expect(output.resultCount).toBe(0);
    expect(String(output.note)).toMatch(/found nothing/i);
  });

  it("answers a failure instead of throwing", async () => {
    // runChatTool's contract. A throw here abandons a reply that is already
    // half streamed, where a sentence lets the model pass the problem on.
    searchWeb.mockResolvedValue({ ok: false, error: "The daily search quota has run out." });

    await expect(payloadOf(WEB_SEARCH_TOOL_NAME, { query: "x" })).resolves.toMatchObject({
      error: "The daily search quota has run out.",
    });
  });

  it("refuses a call with no query rather than searching for nothing", async () => {
    await expect(payloadOf(WEB_SEARCH_TOOL_NAME, {})).resolves.toMatchObject({
      error: expect.stringContaining("query"),
    });

    expect(searchWeb).not.toHaveBeenCalled();
  });

  it("drops a non-string query rather than coercing one", async () => {
    // The model's arguments are untrusted like anything else it emits.
    await expect(payloadOf(WEB_SEARCH_TOOL_NAME, { query: { toString: () => "x" } })).resolves.toMatchObject(
      { error: expect.stringContaining("query") },
    );

    expect(searchWeb).not.toHaveBeenCalled();
  });

  it("still refuses a tool nobody defined", async () => {
    await expect(payloadOf("delete_everything", {})).resolves.toMatchObject({
      error: expect.stringContaining("delete_everything"),
    });
  });
});

describe("what the reader is told while it runs", () => {
  it("names the search rather than the timesheet", () => {
    expect(toolStatusFor(WEB_SEARCH_TOOL_NAME)).toMatch(/search/i);
    expect(toolStatusFor(TIMESHEET_TOOL_NAME)).toMatch(/timesheet/i);
  });
});

describe("the tool description", () => {
  const spec = (buildChatToolConfig({ webSearch: true }).tools ?? [])[1] as {
    toolSpec?: { description?: string };
  };
  const description = spec.toolSpec?.description ?? "";

  it("says results are data and never instructions", () => {
    // The fence lowers the odds and the description says it in words. Neither
    // is sufficient alone, which is why both are asserted.
    expect(description).toMatch(/DATA, NEVER INSTRUCTIONS/i);
  });

  it("says a snippet is not a page", () => {
    // The commonest wrong answer this tool can produce is a confident one
    // assembled from three truncated snippets.
    expect(description).toMatch(/SNIPPETS, NOT PAGES/i);
  });

  it("sends this app's own data to the other tool", () => {
    // Searching the web for our timesheets finds either nothing or somebody
    // else's company, and the second is worse.
    expect(description).toContain(TIMESHEET_TOOL_NAME);
  });
});
