import { describe, expect, it, vi } from "vitest";

// ===================================================================
// READING WHAT A SEARCH ENGINE SENT BACK
//
// The network half of this is not worth mocking - a fetch that fails is
// answered with a sentence and there is nothing subtle about it. What IS
// worth asserting is the parsing, because every failure in it is silent:
// a result admitted that should not have been, a snippet carrying control
// characters into the JSON a tool result is serialised as, or an empty
// answer reported as a failure so the model searches again for the same
// nothing.
// ===================================================================

// `server-only` throws when imported outside a server component graph, and
// the module under test imports it. Vitest has no such graph.
vi.mock("server-only", () => ({}));

const { readSearchPayload, tidySnippet } = await import("./web-search");

describe("admitting a result", () => {
  it("keeps an ordinary https result and names its host", () => {
    const outcome = readSearchPayload(
      { items: [{ title: "Standards Australia", link: "https://www.standards.org.au/x", snippet: "AS 1100" }] },
      "as 1100",
    );

    expect(outcome).toMatchObject({ ok: true, results: [{ source: "standards.org.au" }] });
  });

  it("refuses anything that is not http(s)", () => {
    // safeUrl makes such a link render as text anyway, so this costs nothing
    // - but a result nobody can open is worth less than one fewer result,
    // and a javascript: URL in a list the model is about to quote is not
    // something to pass along and hope the renderer catches.
    const outcome = readSearchPayload(
      {
        items: [
          { title: "bad", link: "javascript:alert(1)", snippet: "" },
          { title: "also bad", link: "data:text/html,x", snippet: "" },
          { title: "fine", link: "http://example.com", snippet: "" },
        ],
      },
      "q",
    );

    expect(outcome.ok && outcome.results.map((result) => result.url)).toEqual(["http://example.com"]);
  });

  it("treats no matches as an ANSWER, not a failure", () => {
    // Google omits `items` entirely for a query that matched nothing. Reported
    // as an error, the model retries the identical search until its rounds run
    // out and then answers from memory as though it had looked.
    const outcome = readSearchPayload({ searchInformation: { totalResults: "0" } }, "asdkjhasd");

    expect(outcome).toEqual({ ok: true, query: "asdkjhasd", results: [] });
  });

  it("survives a payload that is not the shape it should be", () => {
    // The parser is pointed at somebody else's API by definition. Throwing
    // here would abandon a half-streamed reply.
    for (const payload of [null, undefined, {}, { items: "nope" }, { items: null }]) {
      expect(readSearchPayload(payload, "q")).toMatchObject({ ok: true, results: [] });
    }
  });
});

describe("tidying a snippet", () => {
  it("strips control characters", () => {
    // The snippet is serialised into the tool result as JSON and read by the
    // model as prose. A stray control byte is neither.
    const cleaned = tidySnippet(`before${String.fromCharCode(0, 7, 27)}after`);

    expect(cleaned).toBe("before after");
  });

  it("collapses the newlines a snippet arrives with", () => {
    // A snippet spread over four lines reads to the model as four fragments.
    expect(tidySnippet("one\n  two\n\n three ")).toBe("one two three");
  });

  it("decodes the entities the engine escaped for a web page", () => {
    expect(tidySnippet("Fish &amp; Chips &quot;best&quot; &#39;in&#39; town")).toBe(
      "Fish & Chips \"best\" 'in' town",
    );
  });

  it("leaves an entity it does not know alone rather than mangling it", () => {
    expect(tidySnippet("caf&eacute;")).toBe("caf&eacute;");
  });
});
