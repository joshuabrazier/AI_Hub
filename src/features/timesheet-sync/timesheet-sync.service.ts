import "server-only";

import { database } from "@/lib/data/kysely-database-client";
import { NewJiraIssue, NewWorklogFact } from "@/lib/data/kysely-database-types";
import {
  advanceSyncWatermarkRepo,
  deleteWorklogFactsRepo,
  getJiraIssuesRepo,
  getSyncWatermarkRepo,
  recordSyncFailureRepo,
  upsertJiraIssuesRepo,
  upsertWorklogFactsRepo,
} from "@/lib/data/repositories/timesheet.repository";
import { envServer } from "@/lib/env-server";
import { handleError } from "@/lib/handle-errors";
import { createJiraClient, JiraIssueResponse } from "@/lib/timesheet/jira-client";
import {
  hoursFieldToSeconds,
  normaliseText,
  readCustomFieldValue,
  toAppZoneDate,
  toAppZoneSecondOfDay,
} from "@/lib/timesheet/jira-mapping";

// -------------------------------------------------------------------
// Jira worklog sync
//
// Pulls what changed since the last successful run and writes it to the read
// model. The order of operations is the whole design:
//
//   1. read the watermark
//   2. walk worklog/updated from it, collecting ids
//   3. hydrate those ids into worklogs
//   4. walk worklog/deleted for the same window
//   5. fetch any issues not already cached, and their parents
//   6. write facts, deletions and issues
//   7. advance the watermark LAST, in the same transaction
//
// Step 7 is the one that matters. If the job dies anywhere before it, the
// transaction rolls back and the next run repeats the window. Repeating is
// harmless because every write is an upsert keyed on Jira's own worklog id.
// Skipping is not: it loses billable time, and nothing downstream would ever
// report it missing.
// -------------------------------------------------------------------

export const JIRA_WORKLOG_SYNC_JOB = "jira-worklog";

const MILLISECONDS_PER_MINUTE = 60000;

// Issues are fetched one at a time (see the note in jira-client.ts on why),
// so a few run concurrently to keep a backfill from taking all afternoon.
// Low enough not to trip Jira's rate limiter.
const ISSUE_FETCH_CONCURRENCY = 5;

export interface SyncResult {
  ok: boolean;
  // True when the job ran against Jira but wrote nothing, because
  // JIRA_SYNC_ENABLED is not "true".
  dryRun: boolean;
  configured: boolean;
  // The window actually read, for the sync health panel.
  since: string | null;
  until: string | null;
  worklogIdsSeen: number;
  worklogsWritten: number;
  worklogsDeleted: number;
  issuesWritten: number;
  orphanedIssueIds: string[];
  error: string | null;
}

function emptyResult(overrides: Partial<SyncResult>): SyncResult {
  return {
    ok: false,
    dryRun: false,
    configured: false,
    since: null,
    until: null,
    worklogIdsSeen: 0,
    worklogsWritten: 0,
    worklogsDeleted: 0,
    issuesWritten: 0,
    orphanedIssueIds: [],
    error: null,
    ...overrides,
  };
}

// -------------------------------------------------------------------
// Where this run starts reading from.
//
// The watermark, less an overlap for clock skew between this app and Jira.
// Re-reading a few minutes twice costs nothing because the writes are
// upserts; missing a few minutes loses time silently. So the overlap is
// always subtracted, never added.
//
// With no watermark at all, JIRA_SYNC_START_DATE decides. Without that it
// falls back to 90 days, which is deliberately modest: a first run that
// quietly tried to read all of history would look like a hang.
// -------------------------------------------------------------------
async function resolveSince(jobName: string): Promise<Date> {
  const watermark = await getSyncWatermarkRepo(jobName);
  const overlapMs = envServer.JIRA_SYNC_OVERLAP_MINUTES * MILLISECONDS_PER_MINUTE;

  if (watermark) return new Date(watermark.lastSyncedAt.getTime() - overlapMs);

  if (envServer.JIRA_SYNC_START_DATE) {
    // Parsed as UTC midnight. It only decides where a first read begins, and
    // reading from slightly too early is the safe direction.
    return new Date(`${envServer.JIRA_SYNC_START_DATE}T00:00:00Z`);
  }

  const ninetyDays = 90 * 24 * 60 * MILLISECONDS_PER_MINUTE;
  return new Date(Date.now() - ninetyDays);
}

// -------------------------------------------------------------------
// A Jira issue payload to a read-model row.
//
// On estimates: Jira's `timeoriginalestimate` is the original estimate and
// `timeestimate` is the REMAINING estimate, not a revised total. Treating
// remaining as "current" would make a nearly finished item look nearly
// unbudgeted, so it is not used. Current falls back to the original unless a
// custom field says otherwise.
//
// Confirm against how the team actually uses these fields before the first
// budget report goes to anyone.
// -------------------------------------------------------------------
function toIssueRow(issue: JiraIssueResponse): NewJiraIssue {
  const fields = issue.fields ?? {};

  const parent = fields.parent as { key?: string } | undefined;
  const project = fields.project as { key?: string } | undefined;
  const issueType = fields.issuetype as { name?: string } | undefined;
  const status = fields.status as { name?: string } | undefined;

  const billableField = envServer.JIRA_FIELD_BILLABLE ? fields[envServer.JIRA_FIELD_BILLABLE] : undefined;
  const categoryField = envServer.JIRA_FIELD_CATEGORY ? fields[envServer.JIRA_FIELD_CATEGORY] : undefined;
  const baselineField = envServer.JIRA_FIELD_BASELINE_ESTIMATE
    ? fields[envServer.JIRA_FIELD_BASELINE_ESTIMATE]
    : undefined;

  const originalEstimate = typeof fields.timeoriginalestimate === "number" ? fields.timeoriginalestimate : null;

  return {
    issueKey: issue.key,
    parentKey: normaliseText(parent?.key),
    // An issue always belongs to a project; the key prefix is the fallback if
    // the field is somehow absent, because projectKey is NOT NULL.
    projectKey: normaliseText(project?.key) ?? issue.key.split("-")[0],
    issueType: normaliseText(issueType?.name),
    summary: normaliseText(fields.summary) ?? issue.key,
    description: normaliseText(fields.description),
    category: readCustomFieldValue(categoryField),
    billable: readCustomFieldValue(billableField),
    baselineEstimateSeconds: hoursFieldToSeconds(baselineField) ?? originalEstimate,
    currentEstimateSeconds: originalEstimate,
    status: normaliseText(status?.name),
    jiraUpdatedAt: typeof fields.updated === "string" ? new Date(fields.updated) : null,
  };
}

// Run an async mapper over items, a few at a time.
async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];

  for (let index = 0; index < items.length; index += limit) {
    const batch = items.slice(index, index + limit);
    results.push(...(await Promise.all(batch.map(mapper))));
  }

  return results;
}

// -------------------------------------------------------------------
// Run the sync.
//
// `dryRun` reads everything from Jira and writes nothing, so a new
// environment can be pointed at a real Jira and inspected before it is
// allowed to touch the read model. It is computed from JIRA_SYNC_ENABLED by
// the caller AND defaulted here, so neither alone decides whether data moves.
// -------------------------------------------------------------------
export async function syncJiraWorklogsService(options: { dryRun?: boolean } = {}): Promise<SyncResult> {
  const dryRun = options.dryRun ?? !envServer.JIRA_SYNC_ENABLED;
  const client = createJiraClient();

  if (!client) {
    return emptyResult({
      ok: false,
      configured: false,
      dryRun,
      error: "Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN.",
    });
  }

  // Captured once, before any reading. The next run starts from here, so it
  // must not be later than the oldest change this run could have seen.
  const runStartedAt = new Date();

  try {
    const since = await resolveSince(JIRA_WORKLOG_SYNC_JOB);
    const sinceMs = since.getTime();

    // ---------------------------------------------------------------
    // 2-4. What changed, and what went away.
    // ---------------------------------------------------------------
    const updatedEntries = await client.worklogIdsUpdatedSince(sinceMs);
    const deletedEntries = await client.worklogIdsDeletedSince(sinceMs);

    const updatedIds = [...new Set(updatedEntries.map((entry) => String(entry.worklogId)))];
    const deletedIds = [...new Set(deletedEntries.map((entry) => String(entry.worklogId)))];

    const worklogs = updatedIds.length > 0 ? await client.worklogsByIds(updatedIds) : [];

    // A worklog can be edited and then deleted inside the same window. The
    // deletion wins: applying it second would be enough, but filtering here
    // means the row is never written in the first place.
    const deletedSet = new Set(deletedIds);
    const liveWorklogs = worklogs.filter((worklog) => !deletedSet.has(String(worklog.id)));

    // ---------------------------------------------------------------
    // 5. The issues behind those worklogs.
    //
    // worklog/list identifies an issue by numeric id, not by key, so the
    // issue has to be fetched to learn its key, its parent and its billable
    // status. Issues already cached are re-fetched too, because the fields
    // that decide billing may have changed since - that is cheap at this
    // volume and wrong to skip.
    // ---------------------------------------------------------------
    const issueIds = [...new Set(liveWorklogs.map((worklog) => String(worklog.issueId)).filter(Boolean))];

    const fetchedIssues = await mapWithConcurrency(issueIds, ISSUE_FETCH_CONCURRENCY, (issueId) =>
      client.issue(issueId),
    );

    const issuesById = new Map<string, JiraIssueResponse>();
    const orphanedIssueIds: string[] = [];

    fetchedIssues.forEach((issue, index) => {
      if (issue) issuesById.set(String(issue.id), issue);
      // Deleted in Jira between the worklog feed and now. Its worklogs stay,
      // and the audit reports them as orphans rather than the sync failing.
      else orphanedIssueIds.push(issueIds[index]);
    });

    // Parents, for the billable status a deliverable inherits. Only the ones
    // not already fetched in this run - anything else already cached is read
    // from the read model below.
    const fetchedKeys = new Set([...issuesById.values()].map((issue) => issue.key));

    const parentKeys = [
      ...new Set(
        [...issuesById.values()]
          .map((issue) => (issue.fields?.parent as { key?: string } | undefined)?.key)
          .filter((key): key is string => Boolean(key))
          .filter((key) => !fetchedKeys.has(key)),
      ),
    ];

    const fetchedParents = await mapWithConcurrency(parentKeys, ISSUE_FETCH_CONCURRENCY, (key) => client.issue(key));

    const issuesByKey = new Map<string, JiraIssueResponse>();
    for (const issue of [...issuesById.values(), ...fetchedParents.filter((issue) => issue !== null)]) {
      issuesByKey.set(issue.key, issue);
    }

    // Parents already in the cache still need their billable status to
    // resolve inheritance for the rows about to be written.
    const cachedIssues = await getJiraIssuesRepo();
    const cachedByKey = new Map(cachedIssues.map((issue) => [issue.issueKey, issue]));

    // ---------------------------------------------------------------
    // Build the rows.
    //
    // The billable question is answered here, at sync time, so the fact table
    // can be read on its own. The item wins over its parent; which of the two
    // it was is recorded, because an inherited status changes silently when
    // an item is re-parented.
    // ---------------------------------------------------------------
    const issueRows: NewJiraIssue[] = [...issuesByKey.values()].map(toIssueRow);
    const issueRowsByKey = new Map(issueRows.map((row) => [row.issueKey, row]));

    const factRows: NewWorklogFact[] = [];

    for (const worklog of liveWorklogs) {
      const issue = issuesById.get(String(worklog.issueId));

      // The issue was deleted from under it. The worklog is skipped rather
      // than written with a made-up issue key; it will be reported as missing
      // by the audit if a fact for it already exists.
      if (!issue) continue;

      const issueRow = issueRowsByKey.get(issue.key);
      if (!issueRow) continue;

      const parentKey = issueRow.parentKey ?? null;
      const parentRow = parentKey ? (issueRowsByKey.get(parentKey) ?? cachedByKey.get(parentKey)) : undefined;

      const issueBillable = normaliseText(issueRow.billable);
      const parentBillable = normaliseText(parentRow?.billable);

      const billable = issueBillable ?? parentBillable ?? null;
      const billableSource = issueBillable ? "issue" : parentBillable ? "parent" : "unset";

      factRows.push({
        worklogId: String(worklog.id),
        issueKey: issue.key,
        parentKey,
        projectKey: issueRow.projectKey,
        category: issueRow.category ?? parentRow?.category ?? null,
        // accountId, never the display name.
        personId: worklog.author?.accountId ?? "unknown",
        personName: normaliseText(worklog.author?.displayName),
        // Adelaide-local, converted explicitly. Never the first ten
        // characters of the timestamp.
        workDate: worklog.started ? toAppZoneDate(worklog.started) : toAppZoneDate(new Date().toISOString()),
        startSecond: worklog.started ? toAppZoneSecondOfDay(worklog.started) : null,
        timeSpentSeconds: typeof worklog.timeSpentSeconds === "number" ? worklog.timeSpentSeconds : 0,
        billable,
        billableSource,
        narrative: normaliseText(worklog.comment),
        jiraUpdatedAt: worklog.updated ? new Date(worklog.updated) : null,
      });
    }

    const result: SyncResult = {
      ok: true,
      dryRun,
      configured: true,
      since: since.toISOString(),
      until: runStartedAt.toISOString(),
      worklogIdsSeen: updatedIds.length,
      worklogsWritten: factRows.length,
      worklogsDeleted: deletedIds.length,
      issuesWritten: issueRows.length,
      orphanedIssueIds,
      error: null,
    };

    if (dryRun) return result;

    // ---------------------------------------------------------------
    // 6-7. Write, then advance the watermark, in ONE transaction.
    //
    // The watermark is the last statement. Anything that throws above it
    // rolls the whole thing back, and the next run re-reads the same window.
    // ---------------------------------------------------------------
    await database.transaction().execute(async (trx) => {
      await upsertJiraIssuesRepo(issueRows, trx);
      await upsertWorklogFactsRepo(factRows, trx);
      await deleteWorklogFactsRepo(deletedIds, trx);

      await advanceSyncWatermarkRepo(
        JIRA_WORKLOG_SYNC_JOB,
        runStartedAt,
        { updated: factRows.length, deleted: deletedIds.length },
        trx,
      );
    });

    return result;
  } catch (error) {
    const wrapped = handleError("syncJiraWorklogsService", error);

    // Recorded against the watermark row for the health panel, but the
    // watermark itself does not move. A failed run must leave the next one
    // reading the same window.
    await recordSyncFailureRepo(JIRA_WORKLOG_SYNC_JOB, wrapped.message).catch(() => undefined);

    return emptyResult({ ok: false, configured: true, dryRun, error: wrapped.message });
  }
}
