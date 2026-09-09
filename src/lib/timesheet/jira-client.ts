import "server-only";

import { envServer } from "../env-server";
import { handleError } from "../handle-errors";

// -------------------------------------------------------------------
// Jira Cloud REST client - the incremental worklog endpoints
//
// ===================================================================
// UNCONFIRMED CONTRACT - confirm this file before trusting a sync run
// ===================================================================
// The three endpoint paths below, the 1000-id cap and the pagination field
// names come from a third-party guide, NOT from Atlassian's own reference:
// that page renders as client-side navigation and could not be read, on two
// separate attempts. Everything else in the sync is built on well-established
// endpoints; this file is the one place carrying the assumption.
//
// Confirm against the official reference before the first production run:
//   https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-worklogs/
// If any of it is wrong, this file is the only one that changes.
//
// The mitigation until then is below: every response is shape-checked, and a
// response that does not match throws by name. It must never be possible for
// a wrong guess here to read as "nothing changed" - that failure would look
// exactly like a quiet week and would stop billing without a single error.
// -------------------------------------------------------------------

// Jira hydrates at most this many worklog ids per call. Also unconfirmed.
const WORKLOG_LIST_BATCH_SIZE = 1000;

// A page walk that never terminates would hang the job, so it is bounded.
// 1000 pages of ids is far beyond any real window for a team of six; hitting
// it means the pagination fields are not what this file assumes.
const MAX_PAGES = 1000;

const REQUEST_TIMEOUT_MS = 30000;
const MAX_RETRIES = 3;

// -------------------------------------------------------------------
// Raw shapes, as returned by Jira.
// -------------------------------------------------------------------
export interface JiraWorklogIdEntry {
  worklogId: number;
  updatedTime: number;
}

export interface JiraWorklog {
  id: string;
  issueId: string;
  author?: { accountId?: string; displayName?: string };
  updateAuthor?: { accountId?: string; displayName?: string };
  // ADF, not a string. See adfToPlainText.
  comment?: unknown;
  started?: string;
  timeSpentSeconds?: number;
  updated?: string;
}

export interface JiraIssueResponse {
  id: string;
  key: string;
  fields: Record<string, unknown>;
}

export interface JiraProjectResponse {
  key: string;
  name: string;
  projectTypeKey?: string;
  projectCategory?: { name?: string };
}

export interface JiraClient {
  worklogIdsUpdatedSince(sinceMs: number): Promise<JiraWorklogIdEntry[]>;
  worklogIdsDeletedSince(sinceMs: number): Promise<JiraWorklogIdEntry[]>;
  worklogsByIds(ids: string[]): Promise<JiraWorklog[]>;
  issue(idOrKey: string): Promise<JiraIssueResponse | null>;
  searchIssues(jql: string, fields: string[]): Promise<JiraIssueResponse[]>;
  projects(): Promise<JiraProjectResponse[]>;
}

// Fields the issue cache needs. Requested explicitly rather than taking Jira's
// default set, so a site with hundreds of custom fields does not ship all of
// them on every row.
export const ISSUE_FIELDS = [
  "summary",
  "description",
  "parent",
  "project",
  "issuetype",
  "status",
  "updated",
  "timeoriginalestimate",
  // R&D classification. Added here rather than fetched separately: the sync
  // already sweeps every Project and Deliverable in one search, so asking
  // for labels on that call costs no extra round trip. A second pass over
  // the same issues - bulkfetch or otherwise - would be one more Jira
  // contract to depend on for data we are already being handed.
  "labels",
];

// The page size for JQL search. Jira caps this server-side anyway; asking for
// a round number keeps the pagination loop honest.
const SEARCH_PAGE_SIZE = 100;

// -------------------------------------------------------------------
// Basic auth with a service account's API token.
//
// Atlassian call this "not as secure as other methods" and recommend OAuth
// 3LO for apps - but 3LO is built around a person clicking Allow in a
// browser, and a timer job at 3am has nobody to click it. A dedicated service
// account is the deliberate choice; see docs/timesheet-sync.md.
//
// The token belongs in Key Vault and reaches the app as an env var. It must
// never be a person's own token: when that account is deactivated the sync
// stops, and billing stops with it, silently.
// -------------------------------------------------------------------
function authorisationHeader(email: string, apiToken: string): string {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
}

// -------------------------------------------------------------------
// Anything that is not an object with the expected key is a contract
// mismatch, and must stop the run. Returning an empty array here would let a
// wrong assumption look like a quiet period.
// -------------------------------------------------------------------
function requireArray(payload: unknown, key: string, endpoint: string): unknown[] {
  if (payload === null || typeof payload !== "object") {
    throw new Error(`Jira ${endpoint} returned ${typeof payload}, expected an object. The API contract has changed.`);
  }

  const value = (payload as Record<string, unknown>)[key];

  if (!Array.isArray(value)) {
    const keys = Object.keys(payload as Record<string, unknown>).join(", ");
    throw new Error(
      `Jira ${endpoint} response has no '${key}' array (keys present: ${keys || "none"}). ` +
        `The API contract has changed - see the note at the top of jira-client.ts.`,
    );
  }

  return value;
}

function parseIdEntries(values: unknown[], endpoint: string): JiraWorklogIdEntry[] {
  return values.map((entry) => {
    if (entry === null || typeof entry !== "object") {
      throw new Error(`Jira ${endpoint} returned a non-object entry.`);
    }

    const record = entry as Record<string, unknown>;
    const worklogId = Number(record.worklogId);

    if (!Number.isFinite(worklogId)) {
      throw new Error(`Jira ${endpoint} returned an entry with no numeric worklogId.`);
    }

    return { worklogId, updatedTime: Number(record.updatedTime) || 0 };
  });
}

export function createJiraClient(): JiraClient | null {
  const baseUrl = envServer.JIRA_BASE_URL;
  const email = envServer.JIRA_EMAIL;
  const apiToken = envServer.JIRA_API_TOKEN;

  // Unconfigured is a state, not an error. The caller reports it.
  if (!baseUrl || !email || !apiToken) return null;

  const root = baseUrl.replace(/\/+$/, "");
  const headers = {
    Authorization: authorisationHeader(email, apiToken),
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  // -----------------------------------------------------------------
  // One request, with a timeout and a bounded retry.
  //
  // 429 and 5xx are retried because Jira rate-limits and occasionally sheds
  // load, and a sync that gave up on the first 429 would leave the watermark
  // behind and re-read the same window forever. 4xx other than 429 is not
  // retried: a 401 will still be a 401 in two seconds, and hammering an
  // endpoint with bad credentials is how an account gets locked.
  // -----------------------------------------------------------------
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      try {
        const response = await fetch(`${root}${path}`, {
          ...init,
          headers,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          // A sync must never be served from a cache.
          cache: "no-store",
        });

        if (response.ok) return (await response.json()) as T;

        const retryable = response.status === 429 || response.status >= 500;

        if (!retryable || attempt === MAX_RETRIES - 1) {
          // The body often explains the failure; the token is never in it.
          const body = await response.text().catch(() => "");
          throw new Error(`Jira ${path} responded ${response.status}. ${body.slice(0, 500)}`);
        }

        // Honour Retry-After when Jira sends one, otherwise back off.
        const retryAfter = Number(response.headers.get("retry-after"));
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } catch (error) {
        lastError = error;
        // A thrown non-retryable response error above must not be retried.
        if (error instanceof Error && error.message.startsWith("Jira ")) throw error;
        if (attempt === MAX_RETRIES - 1) break;
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Jira ${path} failed.`);
  }

  // -----------------------------------------------------------------
  // Walk a paginated id feed (updated or deleted) from `since`.
  //
  // Paging follows Jira's own `nextPage` link rather than incrementing an
  // offset, so a worklog changing mid-walk cannot shift rows past the cursor
  // and out of the results.
  // -----------------------------------------------------------------
  async function walkIdFeed(feed: "updated" | "deleted", sinceMs: number): Promise<JiraWorklogIdEntry[]> {
    const endpoint = `worklog/${feed}`;
    const entries: JiraWorklogIdEntry[] = [];

    let path: string | null = `/rest/api/3/worklog/${feed}?since=${sinceMs}`;
    let pages = 0;

    while (path) {
      const payload: unknown = await request<unknown>(path);
      entries.push(...parseIdEntries(requireArray(payload, "values", endpoint), endpoint));

      pages += 1;
      if (pages >= MAX_PAGES) {
        throw new Error(
          `Jira ${endpoint} paged past ${MAX_PAGES} pages without reporting lastPage. ` +
            `Pagination is not behaving as assumed - see the note at the top of jira-client.ts.`,
        );
      }

      const record = payload as Record<string, unknown>;
      const isLastPage = record.lastPage === true;
      const nextPage = typeof record.nextPage === "string" ? record.nextPage : null;

      if (isLastPage || !nextPage) break;

      // nextPage is an absolute URL; the request helper prepends the root.
      path = nextPage.startsWith(root) ? nextPage.slice(root.length) : nextPage;
    }

    return entries;
  }

  return {
    async worklogIdsUpdatedSince(sinceMs: number): Promise<JiraWorklogIdEntry[]> {
      try {
        return await walkIdFeed("updated", sinceMs);
      } catch (error) {
        throw handleError("worklogIdsUpdatedSince", error);
      }
    },

    async worklogIdsDeletedSince(sinceMs: number): Promise<JiraWorklogIdEntry[]> {
      try {
        return await walkIdFeed("deleted", sinceMs);
      } catch (error) {
        throw handleError("worklogIdsDeletedSince", error);
      }
    },

    // ---------------------------------------------------------------
    // Hydrate ids into full worklogs, in batches.
    //
    // Jira returns only the worklogs that still exist, so the result can be
    // shorter than the input. That is not an error: a worklog deleted between
    // the id feed and this call is handled by the deletion pass.
    // ---------------------------------------------------------------
    async worklogsByIds(ids: string[]): Promise<JiraWorklog[]> {
      try {
        const worklogs: JiraWorklog[] = [];

        for (let index = 0; index < ids.length; index += WORKLOG_LIST_BATCH_SIZE) {
          const batch = ids.slice(index, index + WORKLOG_LIST_BATCH_SIZE);

          const payload: unknown = await request<unknown>("/rest/api/3/worklog/list", {
            method: "POST",
            body: JSON.stringify({ ids: batch.map((id) => Number(id)) }),
          });

          // This endpoint returns a bare array rather than a wrapper object.
          if (!Array.isArray(payload)) {
            throw new Error(
              `Jira worklog/list returned ${typeof payload}, expected an array. ` +
                `The API contract has changed - see the note at the top of jira-client.ts.`,
            );
          }

          worklogs.push(...(payload as JiraWorklog[]));
        }

        return worklogs;
      } catch (error) {
        throw handleError("worklogsByIds", error);
      }
    },

    // ---------------------------------------------------------------
    // One issue by id or key.
    //
    // Deliberately one call per issue rather than a JQL search: the search
    // endpoint has been changing (the older /search is being replaced by
    // /search/jql) and its pagination is exactly the kind of contract this
    // file already has one unconfirmed assumption too many of. GET issue by
    // key is the most stable endpoint Jira has.
    //
    // The cost is fine at this volume - issues are cached in jira_issue, so
    // only new or changed ones are ever fetched.
    //
    // A 404 returns null rather than throwing: an issue deleted in Jira is a
    // normal thing that leaves its worklogs orphaned, and the audit reports
    // that rather than the sync dying on it.
    // ---------------------------------------------------------------
    async issue(idOrKey: string): Promise<JiraIssueResponse | null> {
      try {
        return await request<JiraIssueResponse>(`/rest/api/3/issue/${encodeURIComponent(idOrKey)}`);
      } catch (error) {
        if (error instanceof Error && error.message.includes("responded 404")) return null;
        throw handleError("issue", error);
      }
    },

    // ---------------------------------------------------------------
    // Issues by JQL.
    //
    // POST /rest/api/3/search/jql is the ONLY option: the older
    // GET /rest/api/3/search now answers 410 Gone, verified against this
    // instance. Confirmed working, unlike the worklog endpoints this file
    // originally guessed at.
    //
    // Paging follows `nextPageToken` rather than a numeric offset, so an issue
    // changing mid-walk cannot shift rows past the cursor and out of the
    // results.
    //
    // Jira rejects an unbounded JQL query outright, so every caller must pass
    // a restriction. That is enforced by the API, not by this code.
    // ---------------------------------------------------------------
    async searchIssues(jql: string, fields: string[]): Promise<JiraIssueResponse[]> {
      try {
        const issues: JiraIssueResponse[] = [];
        let nextPageToken: string | undefined;
        let pages = 0;

        do {
          const payload: unknown = await request<unknown>("/rest/api/3/search/jql", {
            method: "POST",
            body: JSON.stringify({ jql, fields, maxResults: SEARCH_PAGE_SIZE, nextPageToken }),
          });

          issues.push(...(requireArray(payload, "issues", "search/jql") as JiraIssueResponse[]));

          const record = payload as Record<string, unknown>;
          nextPageToken = record.isLast === true ? undefined : ((record.nextPageToken as string) ?? undefined);

          pages += 1;
          if (pages >= MAX_PAGES) {
            throw new Error(`Jira search/jql paged past ${MAX_PAGES} pages without reporting isLast.`);
          }
        } while (nextPageToken);

        return issues;
      } catch (error) {
        throw handleError("searchIssues", error);
      }
    },

    // ---------------------------------------------------------------
    // Every project the account can see, with its category.
    //
    // The category is what Internal vs External is read from, and it is needed
    // even for projects with no time logged - a category that exists and has
    // nothing against it is a fact worth showing, not one to hide.
    // ---------------------------------------------------------------
    async projects(): Promise<JiraProjectResponse[]> {
      try {
        const projects: JiraProjectResponse[] = [];
        let startAt = 0;

        for (let page = 0; page < MAX_PAGES; page += 1) {
          const payload: unknown = await request<unknown>(
            `/rest/api/3/project/search?maxResults=${SEARCH_PAGE_SIZE}&startAt=${startAt}`,
          );

          const values = requireArray(payload, "values", "project/search") as JiraProjectResponse[];
          projects.push(...values);

          const record = payload as Record<string, unknown>;
          if (record.isLast === true || values.length === 0) return projects;
          startAt += values.length;
        }

        return projects;
      } catch (error) {
        throw handleError("projects", error);
      }
    },
  };
}
