import "server-only";

import { handleError } from "../handle-errors";
import {
  GraphContractError,
  parseDeltaPage,
  parseDriveList,
  parseSite,
  type DeltaPage,
  type ParsedDrive,
  type ParsedSite,
} from "./graph-types";

// -------------------------------------------------------------------
// Microsoft Graph HTTP - retry, and the throttle gate
//
// Mirrors src/lib/timesheet/jira-client.ts: bounded retry, Retry-After
// honoured, every response shape-checked, and a wrong guess throws by name
// rather than reading as an empty result.
//
// ONE THING IS DIFFERENT, AND IT IS THE POINT OF THIS FILE.
//
// SharePoint throttles PER APPLICATION PER TENANT, not per request. So a
// 429 on one call is a statement about all of them, and carrying on with
// the others is what turns a throttle into a block - Microsoft escalates
// from slowing an app down to refusing it. The Jira client can back off
// just the request that failed; this one cannot.
//
// So a 429 closes a gate that every request waits on, not only the one that
// hit it.
//
// THE GATE IS PER PROCESS, and that limit is real: two App Service
// instances throttle independently and neither knows about the other. The
// durable half lives on sharepoint_crawl.throttled_until, which survives a
// restart and is what stops a resumed crawl walking straight back into a
// block. Neither half is sufficient alone - the in-process gate protects
// the requests in flight right now, the column protects the next run.
// -------------------------------------------------------------------

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

// -------------------------------------------------------------------
// The scopes a crawl needs, and why each one.
//
//   Sites.Read.All   read site metadata and enumerate document libraries
//   Files.Read.All   read driveItem metadata through the delta endpoint
//
// BOTH READ-ONLY. Phase 1 writes nothing to SharePoint and no scope here
// permits it to.
//
// DEFINED HERE rather than beside the token code because auth.ts has to
// request them and graph-token.ts imports auth.ts - putting them there
// would be a cycle. Two copies would be worse than either: a list that
// drifts from what was actually consented to fails as a 403 nobody can
// trace.
//
// See the note in auth.ts for the two operational consequences of changing
// this list: `.All` needs tenant admin consent, and adding a scope does not
// upgrade a refresh token that has already been issued.
// -------------------------------------------------------------------
export const GRAPH_SCOPES = ["Sites.Read.All", "Files.Read.All"] as const;

const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

// The longest we will honour a Retry-After before treating it as a signal
// to stop rather than to wait. SharePoint can ask for minutes; blocking a
// request handler for that is worse than parking the crawl and letting the
// sweep pick it up later.
export const MAX_HONOURED_RETRY_AFTER_SECONDS = 60;

// -------------------------------------------------------------------
// $select - only what phase 1 uses.
//
// Every extra field is bytes across the wire on tens of thousands of
// items, and delta returns the full item by default. Each one here earns
// its place:
//
//   id                    the key, with driveId
//   name                  near-duplicate detection, later classification
//   size                  size outliers, and the extraction cap in phase 3
//   webUrl                the only link back to the real file for a human
//   createdDateTime       age findings
//   lastModifiedDateTime  "not touched in three years"
//   parentReference       the tree: parent id and path, so depth and length
//   file                  its hashes.quickXorHash IS duplicate detection
//   folder                childCount gives empty and single-item folders
//   deleted               tombstones; without it a deleted file lingers
//   lastModifiedBy        "who owns this mess", the first question asked
//
// NOT selected: @microsoft.graph.downloadUrl (phase 3, and a short-lived
// credential we should not persist) and permissions (not returnable this
// way, and see has_unique_permissions in migration 012).
// -------------------------------------------------------------------
export const DELTA_SELECT_FIELDS = [
  "id",
  "name",
  "size",
  "webUrl",
  "createdDateTime",
  "lastModifiedDateTime",
  "parentReference",
  "file",
  "folder",
  "deleted",
  "lastModifiedBy",
] as const;

// -------------------------------------------------------------------
// The throttle gate.
//
// Module-level, so every caller in this process shares it. Exported only
// for the tests and for the crawl service, which needs to read it to park
// a run rather than sit in a loop waiting.
// -------------------------------------------------------------------
let throttledUntilMs = 0;

// `now` is injectable for the same reason applyThrottle's is: the two are
// read together, and a gate you can set at an arbitrary time but only read
// against the wall clock cannot be reasoned about or tested as one thing.
export function throttledUntil(now: number = Date.now()): Date | null {
  return throttledUntilMs > now ? new Date(throttledUntilMs) : null;
}

export function applyThrottle(seconds: number, now: number = Date.now()): void {
  const until = now + seconds * 1000;
  // Never brought forward. Two 429s in flight must not let the shorter one
  // reopen the gate the longer one closed.
  if (until > throttledUntilMs) throttledUntilMs = until;
}

// Test-only. A module-level gate outlives a single test, and one test
// throttling the process would fail every test after it.
export function resetThrottleForTests(): void {
  throttledUntilMs = 0;
}

// -------------------------------------------------------------------
// Why a request stopped, when it stopped for a reason the caller must act
// on differently.
//
// THROTTLED and NEEDS_REAUTH are not failures to retry. A throttle means
// park the crawl and come back; a re-auth means a named person has to sign
// in again and no amount of retrying will help. Reporting either as a
// generic error would send somebody looking for a bug that is not there.
// -------------------------------------------------------------------
export const GRAPH_OUTCOMES = {
  THROTTLED: "throttled",
  NEEDS_REAUTH: "needs_reauth",
} as const;

export type GraphOutcome = (typeof GRAPH_OUTCOMES)[keyof typeof GRAPH_OUTCOMES];

export class GraphRequestError extends Error {
  readonly outcome: GraphOutcome | null;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    options: { outcome?: GraphOutcome | null; status?: number | null; retryAfterSeconds?: number | null } = {},
  ) {
    super(message);
    this.name = "GraphRequestError";
    this.outcome = options.outcome ?? null;
    this.status = options.status ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

// Retry-After is documented as seconds. A date form is legal in HTTP
// generally, so a value that is not a positive number falls back to the
// backoff rather than becoming NaN and waiting zero.
export function parseRetryAfter(header: string | null): number | null {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// -------------------------------------------------------------------
// One request, with a timeout and a bounded retry.
//
// 429 and 5xx are retried, exactly as the Jira client does, because Graph
// rate-limits and occasionally sheds load. 401 and 403 are NOT: they mean
// the delegated token no longer carries what it needs, which retrying
// cannot change - the remedy is a person re-consenting.
//
// `fetchImpl` is injectable so the retry logic can be tested without a
// network. Nothing else passes it.
// -------------------------------------------------------------------
export async function graphRequest(
  url: string,
  accessToken: string,
  options: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<unknown> {
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());

  // The gate, checked BEFORE the request rather than after a failure. This
  // is what makes a throttle apply to every caller and not just the one
  // that met it.
  const gateUntil = throttledUntil(now());
  if (gateUntil) {
    throw new GraphRequestError("Graph is throttling this application, so the request was not sent", {
      outcome: GRAPH_OUTCOMES.THROTTLED,
      retryAfterSeconds: Math.ceil((gateUntil.getTime() - now()) / 1000),
    });
  }

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await doFetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        signal: controller.signal,
      });

      if (response.ok) {
        return await response.json();
      }

      // A token that no longer works. Terminal by design.
      if (response.status === 401 || response.status === 403) {
        throw new GraphRequestError(
          "Graph refused the delegated token, so somebody has to sign in again to renew consent",
          { outcome: GRAPH_OUTCOMES.NEEDS_REAUTH, status: response.status },
        );
      }

      const retryable = response.status === 429 || response.status >= 500;

      if (response.status === 429) {
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        const seconds = retryAfter ?? 2 ** attempt;

        // EVERY request stops, not just this one.
        applyThrottle(seconds, now());

        // A long Retry-After is not something to sit through inside a
        // request. The crawl is parked and the sweep picks it up.
        if (!retryAfter || retryAfter > MAX_HONOURED_RETRY_AFTER_SECONDS) {
          throw new GraphRequestError("Graph is throttling this application", {
            outcome: GRAPH_OUTCOMES.THROTTLED,
            status: 429,
            retryAfterSeconds: seconds,
          });
        }

        if (attempt === MAX_RETRIES - 1) {
          throw new GraphRequestError("Graph kept throttling after every retry", {
            outcome: GRAPH_OUTCOMES.THROTTLED,
            status: 429,
            retryAfterSeconds: seconds,
          });
        }

        await sleep(seconds * 1000);
        continue;
      }

      if (!retryable || attempt === MAX_RETRIES - 1) {
        throw new GraphRequestError(`Graph answered ${response.status}`, { status: response.status });
      }

      await sleep(2 ** attempt * 1000);
    } catch (error) {
      // A thrown GraphRequestError above is a decision, not a transport
      // fault, and must not be retried past it.
      if (error instanceof GraphRequestError) throw error;

      lastError = error;

      if (attempt === MAX_RETRIES - 1) {
        throw new GraphRequestError(
          `Graph could not be reached: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      await sleep(2 ** attempt * 1000);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new GraphRequestError(
    `Graph could not be reached: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

// -------------------------------------------------------------------
// Resolve a site from a host and a server-relative path.
//
// CONFIRMED addressing:
//   GET /sites/{hostname}:/{server-relative-path}
//   GET /sites/{hostname}                          the tenant root site
//   https://learn.microsoft.com/graph/api/site-getbypath
//
// THE COLON IS THE WHOLE SYNTAX and the root site is spelled without one.
// Sending "contoso.sharepoint.com:" with an empty path is not the same
// request and does not resolve, which is why the empty path from
// parseSharepointSiteUrl is branched on here rather than concatenated.
//
// The hostname is encoded even though a URL hostname cannot contain a
// slash, because it is being placed into a path segment and defending that
// should not depend on a property of the parser upstream.
// -------------------------------------------------------------------
export async function fetchSite(
  hostname: string,
  sitePath: string,
  accessToken: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<ParsedSite> {
  const host = encodeURIComponent(hostname);

  // Each segment encoded separately: a site called "People and Culture"
  // needs its spaces escaped, but the slashes between segments are
  // structure and must survive.
  const encodedPath = sitePath
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");

  const url = encodedPath
    ? `${GRAPH_BASE_URL}/sites/${host}:/${encodedPath}`
    : `${GRAPH_BASE_URL}/sites/${host}`;

  const payload = await graphRequest(url, accessToken, options);

  return parseSite(payload);
}

// -------------------------------------------------------------------
// The document libraries on a site.
//
// CONFIRMED: https://learn.microsoft.com/graph/api/drive-list
//
// Not paged here on purpose. A site with more than the default page of
// libraries is not a thing we have seen, and following nextLink would add
// a loop to a call that exists only to fill a picker. If it ever matters
// it will show as a missing library in the list, which an admin can see -
// not as silently crawling the wrong one.
// -------------------------------------------------------------------
export async function fetchDrivesForSite(
  siteId: string,
  accessToken: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<ParsedDrive[]> {
  const url = `${GRAPH_BASE_URL}/sites/${encodeURIComponent(siteId)}/drives`;

  const payload = await graphRequest(url, accessToken, options);

  return parseDriveList(payload);
}

// -------------------------------------------------------------------
// The first page of a delta walk on a drive.
//
// `$select` is applied here and carried by Graph onto every following
// page automatically - the nextLink already encodes it, which is why
// deltaPage below takes a bare URL.
// -------------------------------------------------------------------
export function deltaStartUrl(driveId: string): string {
  const select = DELTA_SELECT_FIELDS.join(",");
  return `${GRAPH_BASE_URL}/drives/${encodeURIComponent(driveId)}/root/delta?$select=${select}`;
}

// -------------------------------------------------------------------
// Fetch and check one page.
//
// The parse is not optional and its failure is not swallowed: a response
// that does not match the contract throws, so it can never be mistaken for
// a library with nothing in it.
// -------------------------------------------------------------------
export async function fetchDeltaPage(
  url: string,
  accessToken: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<DeltaPage> {
  try {
    const payload = await graphRequest(url, accessToken, options);
    return parseDeltaPage(payload);
  } catch (error) {
    // Both of these carry a meaning the caller acts on, so they travel
    // untouched rather than being flattened into a generic failure.
    if (error instanceof GraphRequestError || error instanceof GraphContractError) throw error;
    throw handleError("fetchDeltaPage", error);
  }
}
