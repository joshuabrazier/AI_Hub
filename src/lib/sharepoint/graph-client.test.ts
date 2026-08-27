import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyThrottle,
  DELTA_SELECT_FIELDS,
  deltaStartUrl,
  fetchDeltaPage,
  fetchDrivesForSite,
  fetchSite,
  GRAPH_OUTCOMES,
  GraphRequestError,
  graphRequest,
  parseRetryAfter,
  resetThrottleForTests,
  throttledUntil,
} from "./graph-client";
import { GraphContractError } from "./graph-types";

// -------------------------------------------------------------------
// The local-development door is PINNED here rather than left to whatever
// the developer happens to have in .env.
//
// This is not tidiness. Every URL assertion below is a statement about
// where a real request goes, and the fake redirects exactly that. Leaving
// it to the environment meant these tests passed on one machine and failed
// on another the moment somebody set DEV_FAKE_SHAREPOINT_URL - and worse,
// would have passed while asserting the wrong thing.
//
// Mutable rather than a fixed null so the redirect itself can be tested,
// which is the other half of the same behaviour. graphBaseUrl() resolves
// per call, so flipping this needs no module reloading.
// -------------------------------------------------------------------
let fakeBaseUrl: string | null = null;

vi.mock("./dev-fake", () => ({
  fakeSharepointBaseUrl: () => fakeBaseUrl,
  isFakeSharepointEnabled: () => fakeBaseUrl !== null,
  FAKE_GRAPH_TOKEN: "dev-fake-sharepoint-not-a-real-token",
}));

// -------------------------------------------------------------------
// The retry and the throttle gate.
//
// The gate is the reason this file is not just a copy of the Jira client.
// SharePoint throttles per application per tenant, so a 429 on one request
// is a statement about all of them - and continuing on the others is what
// turns a throttle into a block.
//
// Timers are faked so a test does not actually sit through a backoff, and
// the gate is reset between tests because it is module-level state that
// would otherwise leak from one test into every test after it.
// -------------------------------------------------------------------

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: { get: (name: string) => init.headers?.[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  resetThrottleForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  resetThrottleForTests();
  // Back to the real Graph, so one test opening the door cannot silently
  // redirect every test after it.
  fakeBaseUrl = null;
});

// A helper that runs a promise while letting fake timers drain, so a
// backoff resolves instantly instead of hanging the test.
async function runWithTimers<T>(work: Promise<T>): Promise<T> {
  const settled = work.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
  await vi.runAllTimersAsync();
  const result = await settled;
  if (result.ok) return result.value;
  throw result.error;
}

describe("parseRetryAfter", () => {
  it("reads the documented seconds form", () => {
    expect(parseRetryAfter("30")).toBe(30);
  });

  it("falls back to null for anything that is not a positive number", () => {
    // A date form is legal HTTP generally. Treating it as a number would
    // give NaN, and NaN milliseconds is a wait of zero - which is the one
    // outcome a throttle must not produce.
    expect(parseRetryAfter("Wed, 26 Aug 2026 09:00:00 GMT")).toBeNull();
    expect(parseRetryAfter("0")).toBeNull();
    expect(parseRetryAfter("-5")).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});

describe("the throttle gate", () => {
  it("closes for every caller, not just the one that met the 429", async () => {
    applyThrottle(30);

    // A completely unrelated request, with a fetch that would have
    // succeeded. It must not even be sent.
    const fetchImpl = vi.fn();

    await expect(runWithTimers(graphRequest("https://graph/x", "token", { fetchImpl }))).rejects.toMatchObject({
      outcome: GRAPH_OUTCOMES.THROTTLED,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never brings the gate forward", () => {
    const now = 1_000_000;

    applyThrottle(60, now);
    // A second, shorter throttle arriving while the first is in force must
    // not reopen the gate early.
    applyThrottle(5, now);

    expect(throttledUntil(now)?.getTime()).toBe(now + 60_000);
  });

  it("reopens once the wait has passed", () => {
    applyThrottle(1);
    expect(throttledUntil()).not.toBeNull();

    vi.advanceTimersByTime(1500);
    expect(throttledUntil()).toBeNull();
  });
});

describe("graphRequest", () => {
  it("returns the parsed body on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ value: [] }));

    await expect(runWithTimers(graphRequest("https://graph/x", "token", { fetchImpl }))).resolves.toEqual({
      value: [],
    });
  });

  it("sends the token as a bearer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ value: [] }));

    await runWithTimers(graphRequest("https://graph/x", "secret-token", { fetchImpl }));

    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer secret-token");
  });

  it("honours a short Retry-After and then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(jsonResponse({ value: [] }));

    await expect(runWithTimers(graphRequest("https://graph/x", "t", { fetchImpl }))).resolves.toEqual({
      value: [],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("parks rather than sitting through a long Retry-After", async () => {
    // Minutes is a normal thing for SharePoint to ask for. Blocking a
    // request handler for that is worse than parking the crawl and letting
    // the sweep pick it up.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, { status: 429, headers: { "retry-after": "600" } }));

    await expect(runWithTimers(graphRequest("https://graph/x", "t", { fetchImpl }))).rejects.toMatchObject({
      outcome: GRAPH_OUTCOMES.THROTTLED,
      retryAfterSeconds: 600,
    });

    // Sent once, not retried into the block.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(throttledUntil()).not.toBeNull();
  });

  it("closes the gate even when the 429 carried no Retry-After", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 429 }));

    await expect(runWithTimers(graphRequest("https://graph/x", "t", { fetchImpl }))).rejects.toMatchObject({
      outcome: GRAPH_OUTCOMES.THROTTLED,
    });

    expect(throttledUntil()).not.toBeNull();
  });

  it("does not retry a 401, because retrying cannot renew consent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 401 }));

    await expect(runWithTimers(graphRequest("https://graph/x", "t", { fetchImpl }))).rejects.toMatchObject({
      outcome: GRAPH_OUTCOMES.NEEDS_REAUTH,
      status: 401,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 403 either, and says the same thing", async () => {
    // A scope added after somebody consented shows up here, not as a 401.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 403 }));

    await expect(runWithTimers(graphRequest("https://graph/x", "t", { fetchImpl }))).rejects.toMatchObject({
      outcome: GRAPH_OUTCOMES.NEEDS_REAUTH,
      status: 403,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx and gives up by name", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 503 }));

    await expect(runWithTimers(graphRequest("https://graph/x", "t", { fetchImpl }))).rejects.toBeInstanceOf(
      GraphRequestError,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 400, because the request itself is wrong", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 400 }));

    await expect(runWithTimers(graphRequest("https://graph/x", "t", { fetchImpl }))).rejects.toBeInstanceOf(
      GraphRequestError,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a transport failure and then reports it by name", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("socket hang up"));

    await expect(runWithTimers(graphRequest("https://graph/x", "t", { fetchImpl }))).rejects.toBeInstanceOf(
      GraphRequestError,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("deltaStartUrl", () => {
  it("asks only for the fields phase 1 uses", () => {
    const url = deltaStartUrl("b!abc");

    // Every extra field is bytes across the wire on tens of thousands of
    // items, so the select list is a cost decision as much as a tidy one.
    for (const field of DELTA_SELECT_FIELDS) {
      expect(url).toContain(field);
    }

    expect(url).toContain("/drives/b!abc/root/delta");
  });

  it("encodes a drive id containing URL-significant characters", () => {
    // Graph drive ids routinely contain ! and can contain other characters
    // that would otherwise change the shape of the path.
    expect(deltaStartUrl("b!a/b")).toContain("b!a%2Fb");
  });
});

describe("fetchDeltaPage", () => {
  it("returns a checked page", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ value: [{ id: "01A", name: "a.docx" }], "@odata.deltaLink": "https://graph/delta" }),
    );

    const page = await runWithTimers(fetchDeltaPage("https://graph/x", "t", { fetchImpl }));

    expect(page.items).toHaveLength(1);
    expect(page.deltaLink).toBe("https://graph/delta");
  });

  it("throws a contract error rather than reporting an empty library", async () => {
    // The whole point. A 200 carrying something we do not understand must
    // never be read as "there is nothing here".
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ unexpected: true }));

    await expect(runWithTimers(fetchDeltaPage("https://graph/x", "t", { fetchImpl }))).rejects.toBeInstanceOf(
      GraphContractError,
    );
  });

  it("lets a throttle travel with its meaning intact", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, { status: 429, headers: { "retry-after": "300" } }));

    await expect(runWithTimers(fetchDeltaPage("https://graph/x", "t", { fetchImpl }))).rejects.toMatchObject({
      outcome: GRAPH_OUTCOMES.THROTTLED,
    });
  });
});

describe("fetchSite", () => {
  it("addresses a site with the documented colon form", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "site-1", displayName: "Finance" }));

    await runWithTimers(fetchSite("contoso.sharepoint.com", "/sites/Finance", "t", { fetchImpl }));

    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/Finance",
    );
  });

  it("addresses the tenant root site WITHOUT a colon", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "site-root" }));

    await runWithTimers(fetchSite("contoso.sharepoint.com", "", "t", { fetchImpl }));

    // A trailing colon with an empty path is a different request and does
    // not resolve, so the root site has to be spelled this way.
    expect(fetchImpl.mock.calls[0][0]).toBe("https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com");
  });

  it("encodes each path segment but keeps the slashes between them", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "site-1" }));

    await runWithTimers(fetchSite("contoso.sharepoint.com", "/sites/People and Culture", "t", { fetchImpl }));

    expect(fetchImpl.mock.calls[0][0]).toBe(
      "https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/People%20and%20Culture",
    );
  });
});

describe("fetchDrivesForSite", () => {
  it("asks for the libraries on the site", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ value: [{ id: "b!abc", name: "Documents" }] }));

    const drives = await runWithTimers(fetchDrivesForSite("site-1", "t", { fetchImpl }));

    expect(fetchImpl.mock.calls[0][0]).toBe("https://graph.microsoft.com/v1.0/sites/site-1/drives");
    expect(drives[0].driveId).toBe("b!abc");
  });

  it("lets a refused token travel as a re-auth rather than an empty site", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { status: 403 }));

    await expect(runWithTimers(fetchDrivesForSite("site-1", "t", { fetchImpl }))).rejects.toMatchObject({
      outcome: GRAPH_OUTCOMES.NEEDS_REAUTH,
    });
  });
});

describe("the local-development redirect", () => {
  it("sends every endpoint to the fake when the door is open", async () => {
    fakeBaseUrl = "http://localhost:4400";

    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "site-1", value: [] }));

    await runWithTimers(fetchSite("contoso.sharepoint.com", "/sites/Finance", "t", { fetchImpl }));
    await runWithTimers(fetchDrivesForSite("site-1", "t", { fetchImpl }));

    expect(fetchImpl.mock.calls[0][0]).toBe("http://localhost:4400/sites/contoso.sharepoint.com:/sites/Finance");
    expect(fetchImpl.mock.calls[1][0]).toBe("http://localhost:4400/sites/site-1/drives");
    expect(deltaStartUrl("b!abc")).toContain("http://localhost:4400/drives/b!abc/root/delta");
  });

  it("goes to the real Graph the moment the door is shut again", () => {
    // Resolved per call, not captured at import. A door opened by one
    // request must not outlive it.
    expect(deltaStartUrl("b!abc")).toContain("https://graph.microsoft.com/v1.0/");
  });
});
