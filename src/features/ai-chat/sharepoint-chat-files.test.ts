import { beforeEach, describe, expect, it, vi } from "vitest";

// ===================================================================
// THE SHAREPOINT TOOLS
//
// What is asserted here is the set of things that would fail QUIETLY and
// look like a working feature:
//
//   the token is minted for somebody else   - the whole access boundary is
//                                             the delegated token, so an id
//                                             from anywhere but the session
//                                             is a privilege escalation
//                                             with no visible symptom
//   the budget never counts                 - a model asked to read a folder
//                                             keeps adding documents until
//                                             the SEND is refused, which
//                                             arrives as a dead reply
//   the file arrives unlabelled             - the request log keeps only the
//                                             text parts of a tool result,
//                                             so a document with no text
//                                             beside it is a file read that
//                                             the log cannot show
//   a refused format is downloaded anyway   - or worse, sent, and Bedrock
//                                             refuses the whole turn
// ===================================================================

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }));

const requireUser = vi.fn(async () => ({ id: "session-user", role: "member" }));
// The token is DERIVED from the id rather than constant, so a token minted
// for the wrong person shows up as the wrong token further down instead of
// being indistinguishable from the right one.
const getDelegatedGraphToken = vi.fn(async (userId: string) => `token-for-${userId}`);
const searchSharepointFiles = vi.fn();
const downloadSharepointFile = vi.fn();

vi.mock("@/lib/auth/session-auth-server", () => ({ requireUser: () => requireUser() }));

vi.mock("@/lib/sharepoint/graph-token", () => ({
  getDelegatedGraphToken: (id: string) => getDelegatedGraphToken(id),
}));

vi.mock("@/lib/sharepoint/file-search", () => ({
  searchSharepointFiles: (...args: unknown[]) => searchSharepointFiles(...args),
  downloadSharepointFile: (...args: unknown[]) => downloadSharepointFile(...args),
}));

const {
  createSharepointTurnBudget,
  findSharepointFilesService,
  readSharepointFileService,
  MAX_FILES_PER_TURN,
} = await import("./sharepoint-chat-files.service");

// A real PDF header, because inspectAttachment reads the BYTES and would
// refuse a buffer of zeroes however it was named.
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x20)]);

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "session-user", role: "member" });
  searchSharepointFiles.mockResolvedValue([]);
  downloadSharepointFile.mockResolvedValue(PDF);
});

describe("whose files these are", () => {
  it("mints the token for the SESSION user, on both paths", async () => {
    // This is the entire access-control story. Graph decides what comes back
    // against this id, so an id from anywhere else - a tool argument, a URL,
    // a remembered value - would be somebody reading another person's
    // documents with nothing in the app to stop it.
    await findSharepointFilesService("proposal");
    await readSharepointFileService("d1", "i1", "a.pdf", createSharepointTurnBudget());

    expect(getDelegatedGraphToken).toHaveBeenCalledTimes(2);
    expect(getDelegatedGraphToken).toHaveBeenNthCalledWith(1, "session-user");
    expect(getDelegatedGraphToken).toHaveBeenNthCalledWith(2, "session-user");
  });

  it("re-resolves the session on every call rather than caching a token", async () => {
    // Two calls in one turn are two separate authorizations. Holding a token
    // across them would be the beginning of holding one across turns.
    await findSharepointFilesService("a");
    await findSharepointFilesService("b");

    expect(requireUser).toHaveBeenCalledTimes(2);
  });

  it("asks Graph and never the inventory", async () => {
    // The crawl runs as ONE admin, so sharepoint_item describes that
    // person's reach and records nothing about anybody else's. Searching it
    // would list the NAMES of restricted folders - which the migration says
    // in as many words are disclosive on their own - to whoever asked.
    await findSharepointFilesService("redundancy");

    expect(searchSharepointFiles).toHaveBeenCalledWith("token-for-session-user", "redundancy", undefined);
  });
});

describe("a Graph failure", () => {
  it("names re-consent as the remedy rather than reporting a fault", async () => {
    // The commonest failure by far: the SharePoint scopes were added after
    // people had signed in, and a refresh token keeps the scopes it was
    // issued with. "Something went wrong" sends somebody to a developer for
    // a problem only they can fix.
    searchSharepointFiles.mockRejectedValue(
      Object.assign(new Error("refused"), { outcome: "needs_reauth" }),
    );

    await expect(findSharepointFilesService("x")).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/sign(ing)? (out and back in|in) with Microsoft/i),
    });
  });

  it("is answered, never thrown", async () => {
    // A throw here abandons a reply that is already half streamed.
    downloadSharepointFile.mockRejectedValue(new Error("socket hang up"));

    await expect(
      readSharepointFileService("d", "i", "a.pdf", createSharepointTurnBudget()),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe("the per-turn budget", () => {
  it("allows the files it promises and refuses the next", async () => {
    const budget = createSharepointTurnBudget();

    for (let opened = 0; opened < MAX_FILES_PER_TURN; opened++) {
      await expect(
        readSharepointFileService("d", `i${opened}`, "a.pdf", budget),
      ).resolves.toMatchObject({ ok: true });
    }

    await expect(readSharepointFileService("d", "extra", "a.pdf", budget)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("per message"),
    });
  });

  it("refuses the third WITHOUT downloading it", async () => {
    // Checked before the call, not after. Spending a Graph round trip on a
    // file that cannot be handed over is the difference between a budget and
    // a filter.
    const budget = createSharepointTurnBudget();

    for (let opened = 0; opened < MAX_FILES_PER_TURN; opened++) {
      await readSharepointFileService("d", `i${opened}`, "a.pdf", budget);
    }

    downloadSharepointFile.mockClear();
    await readSharepointFileService("d", "extra", "a.pdf", budget);

    expect(downloadSharepointFile).not.toHaveBeenCalled();
  });

  it("does not charge the budget for a file it refused", async () => {
    // A rejected format must not consume somebody's allowance - otherwise
    // one unreadable file in a folder costs them the question.
    const budget = createSharepointTurnBudget();
    downloadSharepointFile.mockResolvedValue(Buffer.from("PK\u0003\u0004 not an office file"));

    await expect(readSharepointFileService("d", "i", "thing.zip", budget)).resolves.toMatchObject({
      ok: false,
    });

    expect(budget.filesRead).toBe(0);
  });

  it("is per turn, so a fresh one starts clean", async () => {
    const first = createSharepointTurnBudget();
    await readSharepointFileService("d", "i", "a.pdf", first);

    const second = createSharepointTurnBudget();

    await expect(readSharepointFileService("d", "i", "a.pdf", second)).resolves.toMatchObject({
      ok: true,
    });
  });
});

describe("what may be opened", () => {
  it("decides from the BYTES, not the name", async () => {
    // A .docx that is really something else is a real thing, and the failure
    // it causes inside Bedrock says nothing useful.
    downloadSharepointFile.mockResolvedValue(Buffer.from("just some words"));

    const outcome = await readSharepointFileService("d", "i", "report.docx", createSharepointTurnBudget());

    expect(outcome.ok).toBe(false);
  });

  it("refuses an empty file by saying so", async () => {
    downloadSharepointFile.mockResolvedValue(Buffer.alloc(0));

    await expect(
      readSharepointFileService("d", "i", "a.pdf", createSharepointTurnBudget()),
    ).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/empty/i) });
  });

  it("needs both ids, and does not go to Graph without them", async () => {
    await expect(
      readSharepointFileService("", "i", "a.pdf", createSharepointTurnBudget()),
    ).resolves.toMatchObject({ ok: false });

    expect(downloadSharepointFile).not.toHaveBeenCalled();
  });

  it("reports the format it proved rather than the extension it was given", async () => {
    const outcome = await readSharepointFileService(
      "d",
      "i",
      "minutes.pdf",
      createSharepointTurnBudget(),
    );

    expect(outcome).toMatchObject({ ok: true, file: { format: "pdf", kind: "document" } });
  });
});

// ===================================================================
// WHAT A FAILURE IS ALLOWED TO CLAIM
//
// The generic branch used to answer every unclassified failure with
// "SharePoint could not be reached just now." It cost somebody four
// exchanges: the model read it, concluded there was an outage, and said so
// with growing confidence while offering to keep retrying. The search in
// the same conversation had just SUCCEEDED on the same token through the
// same client, so the claim was not merely unproven - the previous tool
// call contradicted it.
//
// A guess dressed as a diagnosis is worse than no diagnosis, so these
// assert the one thing that matters: an answer from Microsoft is never
// reported as a failure to reach Microsoft.
// ===================================================================
describe("what a failure says", () => {
  const graphError = (fields: Record<string, unknown>) =>
    Object.assign(new Error("graph said no"), fields);

  it("reports the status rather than claiming a connection problem", async () => {
    downloadSharepointFile.mockRejectedValue(graphError({ status: 404 }));

    const outcome = await readSharepointFileService("d", "i", "a.pdf", createSharepointTurnBudget());

    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("404") });
    expect((outcome as { error: string }).error).not.toMatch(/could not be reached|down|outage/i);
  });

  it("carries the innerError code when Graph sent one", async () => {
    // The code is the difference between two failures that look identical.
    downloadSharepointFile.mockRejectedValue(
      graphError({ status: 400, innerErrorCode: "invalidRequest" }),
    );

    await expect(
      readSharepointFileService("d", "i", "a.pdf", createSharepointTurnBudget()),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining("invalidRequest") });
  });

  it("tells the model not to retry a refusal", async () => {
    // Retrying a 403 is how four exchanges get spent on a request that was
    // never going to start working.
    downloadSharepointFile.mockRejectedValue(graphError({ status: 404 }));

    const outcome = await readSharepointFileService("d", "i", "a.pdf", createSharepointTurnBudget());

    expect((outcome as { error: string }).error).toMatch(/report the status rather than retrying/i);
  });

  it("only invites a retry when nothing answered at all", async () => {
    // No status means no response - the one case where trying again can
    // genuinely produce a different outcome.
    downloadSharepointFile.mockRejectedValue(new Error("socket hang up"));

    const outcome = await readSharepointFileService("d", "i", "a.pdf", createSharepointTurnBudget());

    expect((outcome as { error: string }).error).toMatch(/retrying/i);
    expect((outcome as { error: string }).error).not.toMatch(/HTTP/);
  });

  it("still names re-consent for a 403, rather than reading it as a refusal to explain", async () => {
    // The classified cases must survive the new branch: this one has a
    // remedy the person can act on, and a bare "HTTP 403" does not.
    searchSharepointFiles.mockRejectedValue(graphError({ outcome: "needs_reauth", status: 403 }));

    await expect(findSharepointFilesService("x")).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/sign/i),
    });
  });
});
