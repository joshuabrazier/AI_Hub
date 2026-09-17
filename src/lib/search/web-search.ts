import "server-only";

import { envServer } from "@/lib/env-server";

// ===================================================================
// WEB SEARCH, AND WHY IT IS A CLIENT-SIDE TOOL
//
// Anthropic has a server-side web_search tool. It is NOT reachable here:
// this app talks to Claude through Bedrock's Converse API, and web search is
// unsupported on Bedrock - the same wall `compactIfNeeded` exists to work
// around for compaction. Converse's toolConfig carries toolSpecs we
// implement and nothing else. So the search happens in our own process,
// against a search API we hold a key for, and the results go back to the
// model as an ordinary tool result.
//
// IT ONLY EVER SEARCHES. It does not open a page. A result is a title, a URL
// and the snippet the search engine already wrote - never the contents of
// anything, because fetching a URL the MODEL chose points our server at
// whatever it was talked into naming, from inside the network the server
// sits in. Everything below is bounded by that: no redirect to follow, no
// HTML to parse, no second hop.
//
// WHAT COMES BACK IS WRITTEN BY STRANGERS. Snippets are attacker-authored in
// a way a Jira job title is not - anybody can publish a page and wait to be
// found. Three things already in this app limit what that can do, and all
// three are load-bearing rather than incidental:
//
//   - the results travel FENCED and named as material, the same shape as
//     BEGIN FACTS / END FACTS, and the system prompt says content there is
//     data and never instruction;
//   - nothing the model returns drives control flow - the only thing it can
//     do with a URL is print it, and it prints through ModelMarkdown, which
//     emits React elements and renders images as LINKS rather than fetching
//     them, so a snippet cannot exfiltrate the conversation through an
//     image src;
//   - `safeUrl` refuses anything that is not http(s), so a `javascript:`
//     link in a result renders as plain text.
//
// A change that fetches page bodies, or that follows a link, needs that
// argument rebuilt rather than extended.
//
// COST. Google's free tier is 100 queries a day and stops at that - without
// a billing account attached the 101st is refused rather than charged, which
// is why the quota path below is an ordinary answer and not an alarm.
// ===================================================================

const ENDPOINT = "https://www.googleapis.com/customsearch/v1";

// Google caps `num` at 10 and answers 400 above it. Ten is also about as many
// snippets as are worth spending context on - past that the model is reading
// page two of a search nobody scrolled.
const MAX_RESULTS = 10;
const DEFAULT_RESULTS = 6;

// -------------------------------------------------------------------
// A SEARCH IS BOUNDED, BECAUSE THE PHASE AROUND IT IS.
//
// CHAT_PHASES.tool is a DURATION budget covering every tool call in a round,
// and a hung fetch offers no idle signal to notice - `fetch` waits as long as
// the socket stays open. Left unbounded, one slow search spends the phase and
// the failure is reported as the phase overrunning rather than as the search
// that caused it. Ten seconds is generous for a query API that normally
// answers in well under one.
// -------------------------------------------------------------------
const SEARCH_TIMEOUT_MS = 10_000;

export type WebSearchResult = {
  title: string;
  url: string;
  /** The search engine's own snippet. Never a fetched page body. */
  snippet: string;
  /** The host, so the model can say where something came from without parsing the URL. */
  source: string;
};

export type WebSearchOutcome =
  | { ok: true; query: string; results: WebSearchResult[] }
  | { ok: false; error: string };

/** Whether this deployment can search at all. Unset keys mean the tool is never offered. */
export function isWebSearchConfigured(): boolean {
  return Boolean(envServer.GOOGLE_SEARCH_API_KEY && envServer.GOOGLE_SEARCH_ENGINE_ID);
}

// A snippet arrives with newlines, ellipses and the odd HTML entity in it.
// Collapsing that is not cosmetic: a snippet spread over four lines reads as
// four fragments, and the entities are what the engine escaped for a web page
// rather than anything worth quoting back to a person.
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

export function tidySnippet(text: string): string {
  return text
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (match) => ENTITIES[match] ?? match)
    // Control characters, which a snippet has no legitimate use for and which
    // would otherwise travel inside the JSON the tool result carries.
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Turn Google's payload into results. Exported so the parsing can be tested
 * without a network or a key - which is the half that actually goes wrong.
 */
export function readSearchPayload(payload: unknown, query: string): WebSearchOutcome {
  // Google omits `items` entirely for a query that matched nothing. That is
  // not a failure, it is an answer, and the model should say so rather than
  // search four more times for the same nothing.
  const items = (payload as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) {
    return { ok: true, query, results: [] };
  }

  const results: WebSearchResult[] = [];

  for (const item of items) {
    const row = item as { title?: unknown; link?: unknown; snippet?: unknown };
    const link = typeof row.link === "string" ? row.link : "";

    // Only http(s) is admitted, matching safeUrl. A search engine should never
    // return anything else, and a result nobody can open is worth less than
    // one fewer result.
    if (!/^https?:\/\//i.test(link)) continue;

    results.push({
      title: tidySnippet(typeof row.title === "string" ? row.title : ""),
      url: link,
      snippet: tidySnippet(typeof row.snippet === "string" ? row.snippet : ""),
      source: hostOf(link),
    });
  }

  return { ok: true, query, results };
}

// -------------------------------------------------------------------
// Run one search.
//
// NEVER THROWS. Its caller is a tool handler whose contract is to answer with
// something JSON-serialisable even for a failure - a thrown error there
// abandons a reply that is already half streamed, where a result saying what
// went wrong lets the model tell the person in a sentence.
//
// The key travels as a URL parameter because that is the only thing Google's
// JSON API accepts, which makes the request URL a credential. Nothing below
// logs it: the failure paths record a status and never the URL.
// -------------------------------------------------------------------
export async function searchWeb(query: string, count?: number): Promise<WebSearchOutcome> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { ok: false, error: "No search terms were given." };
  }

  if (!isWebSearchConfigured()) {
    return { ok: false, error: "Web search is not configured on this deployment." };
  }

  const asked = Math.trunc(Number(count ?? DEFAULT_RESULTS));
  const wanted = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_RESULTS) : DEFAULT_RESULTS;

  const url = new URL(ENDPOINT);
  url.searchParams.set("key", String(envServer.GOOGLE_SEARCH_API_KEY));
  url.searchParams.set("cx", String(envServer.GOOGLE_SEARCH_ENGINE_ID));
  url.searchParams.set("q", trimmed);
  url.searchParams.set("num", String(wanted));
  url.searchParams.set("safe", "active");

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
      // A search result is worth nothing cached across users and a stale one
      // is worse than none, so this opts out of Next's fetch cache rather
      // than relying on what its default happens to be.
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    console.error("searchWeb: request failed", { timedOut, name: (error as Error)?.name });

    return {
      ok: false,
      error: timedOut ? "The search took too long to answer." : "The search service could not be reached.",
    };
  }

  if (!response.ok) {
    // 403 and 429 are nearly always the daily quota rather than a bad key, and
    // saying so saves somebody rotating a credential that was fine.
    const reason =
      response.status === 403 || response.status === 429
        ? "The daily search quota has run out. It resets tomorrow."
        : `The search service answered ${response.status}.`;

    console.error("searchWeb: search rejected", { status: response.status });

    return { ok: false, error: reason };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: "The search service sent something unreadable." };
  }

  return readSearchPayload(payload, trimmed);
}
