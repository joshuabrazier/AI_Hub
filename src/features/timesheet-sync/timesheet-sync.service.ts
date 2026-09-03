import "server-only";

import { database } from "@/lib/data/kysely-database-client";
import { generateId } from "better-auth";

import { NewJiraIssue, NewWorklogFact, NewWorklogRndHistory } from "@/lib/data/kysely-database-types";
import {
  addWorklogRndHistoryRepo,
  advanceSyncWatermarkRepo,
  deleteWorklogFactsRepo,
  getJiraIssuesRepo,
  getSyncWatermarkRepo,
  getWorklogRndStatesRepo,
  recordSyncFailureRepo,
  upsertJiraIssuesRepo,
  upsertJiraProjectsRepo,
  upsertWorklogFactsRepo,
} from "@/lib/data/repositories/timesheet.repository";
import { envServer } from "@/lib/env-server";
import { handleError } from "@/lib/handle-errors";
import { createJiraClient, ISSUE_FIELDS, JiraIssueResponse } from "@/lib/timesheet/jira-client";
import {
  classifyRnd,
  hoursFieldToSeconds,
  labelsSnapshot,
  normaliseText,
  readCustomFieldValue,
  readLabels,
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

// -------------------------------------------------------------------
// The whole book of work is synced, not just what has time booked to it.
//
// This app replaces a job-and-timesheet system, so a job with no hours yet is
// not noise - it is the job nobody has started, and leaving it out means the
// list silently disagrees with Jira. The same reasoning covers a project
// category with nothing against it.
//
// JQL must carry a restriction: Jira rejects an unbounded query outright.
// Filtering on the two hierarchy levels that matter is that restriction, and
// it also keeps sub-tasks out of the job list.
// -------------------------------------------------------------------
const JOB_LEVEL_JQL = 'issuetype in ("Project", "Deliverable") ORDER BY key ASC';

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
  projectsWritten: number;
  orphanedIssueIds: string[];
  // -----------------------------------------------------------------
  // R&D classification outcomes.
  //
  // Warnings, never failures: none of these should stop a sync, and all of
  // them are somebody's job to fix in Jira rather than in code.
  // -----------------------------------------------------------------
  rndReclassified: number;
  // Items carrying BOTH labels. Resolved to core, and NAMED, so the item
  // gets corrected rather than the ambiguity living on inside a number.
  rndBothLabelsIssueKeys: string[];
  // Items with no label of their own whose PARENT carries one. Not an
  // error - but if this is ever non-zero, the labelling convention in Jira
  // is parent-level and the decision not to inherit needs revisiting.
  rndParentLabelledOnlyIssueKeys: string[];
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
    projectsWritten: 0,
    orphanedIssueIds: [],
    rndReclassified: 0,
    rndBothLabelsIssueKeys: [],
    rndParentLabelledOnlyIssueKeys: [],
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
// On category: Internal vs External is NOT a custom field. It is the Jira
// project category, which arrives on every issue at
// fields.project.projectCategory.name. The name is read rather than the id,
// because the ids are per-site and mean nothing to anyone reading a report.
//
// On estimates: both come from custom fields holding HOURS. Jira's built-in
// timeoriginalestimate is the fallback when those are not configured.
// Jira's `timeestimate` is deliberately never used: it is the REMAINING
// estimate, not a revised total, and treating remaining as "current" would
// make a nearly finished item look nearly unbudgeted.
// -------------------------------------------------------------------
function toIssueRow(issue: JiraIssueResponse): NewJiraIssue {
  const fields = issue.fields ?? {};

  const parent = fields.parent as { key?: string } | undefined;
  const project = fields.project as { key?: string; projectCategory?: { name?: string } } | undefined;
  const issueType = fields.issuetype as { name?: string } | undefined;
  const status = fields.status as { name?: string } | undefined;

  const billableField = envServer.JIRA_FIELD_BILLABLE ? fields[envServer.JIRA_FIELD_BILLABLE] : undefined;
  const baselineField = envServer.JIRA_FIELD_BASELINE_ESTIMATE
    ? fields[envServer.JIRA_FIELD_BASELINE_ESTIMATE]
    : undefined;
  const currentField = envServer.JIRA_FIELD_CURRENT_ESTIMATE
    ? fields[envServer.JIRA_FIELD_CURRENT_ESTIMATE]
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
    category: normaliseText(project?.projectCategory?.name),
    billable: readCustomFieldValue(billableField),
    baselineEstimateSeconds: hoursFieldToSeconds(baselineField) ?? originalEstimate,
    currentEstimateSeconds: hoursFieldToSeconds(currentField) ?? originalEstimate,
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
    // 5. The whole book of work, and the project list.
    //
    // Every job and deliverable is swept, not only the ones a worklog points
    // at. A job with no hours booked to it is not noise in a system that
    // replaces a job-and-timesheet tool - it is the job nobody has started,
    // and omitting it makes the list quietly disagree with Jira.
    //
    // This also replaces what used to be one HTTP call per issue. Two requests
    // now cover every issue and every project, and the billable fields are
    // re-read on each run because a value that decides invoicing must never be
    // served from a stale cache.
    // ---------------------------------------------------------------
    const searchFields = [
      ...ISSUE_FIELDS,
      envServer.JIRA_FIELD_BILLABLE,
      envServer.JIRA_FIELD_BASELINE_ESTIMATE,
      envServer.JIRA_FIELD_CURRENT_ESTIMATE,
    ].filter((field): field is string => Boolean(field));

    const [allIssues, allProjects] = await Promise.all([
      client.searchIssues(JOB_LEVEL_JQL, searchFields),
      client.projects(),
    ]);

    const issuesById = new Map<string, JiraIssueResponse>();
    const issuesByKey = new Map<string, JiraIssueResponse>();
    for (const issue of allIssues) {
      issuesById.set(String(issue.id), issue);
      issuesByKey.set(issue.key, issue);
    }

    // A worklog booked to an issue type outside the sweep (a Task, a Bug, a
    // sub-task) still has to be attributable, so those are fetched
    // individually. Normally this list is empty.
    const missingIssueIds = [
      ...new Set(liveWorklogs.map((worklog) => String(worklog.issueId)).filter((id) => id && !issuesById.has(id))),
    ];

    const orphanedIssueIds: string[] = [];

    if (missingIssueIds.length > 0) {
      const extras = await mapWithConcurrency(missingIssueIds, ISSUE_FETCH_CONCURRENCY, (id) => client.issue(id));

      extras.forEach((issue, index) => {
        if (issue) {
          issuesById.set(String(issue.id), issue);
          issuesByKey.set(issue.key, issue);
        } else {
          // Deleted in Jira between the worklog feed and now. Its worklogs
          // stay, and the audit reports them as orphans rather than the sync
          // failing on them.
          orphanedIssueIds.push(missingIssueIds[index]);
        }
      });
    }

    // Parents already cached but outside this sweep still need their billable
    // status, to resolve what a deliverable inherits.
    const cachedIssues = await getJiraIssuesRepo();
    const cachedByKey = new Map(cachedIssues.map((issue) => [issue.issueKey, issue]));

    const projectRows = allProjects.map((project) => ({
      projectKey: project.key,
      name: project.name,
      category: normaliseText(project.projectCategory?.name),
      projectType: normaliseText(project.projectTypeKey),
    }));

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

    // Issues carrying BOTH labels - a data entry error, surfaced by key so
    // somebody fixes the item rather than the number being quietly decided.
    const bothLabelsIssueKeys = new Set<string>();
    // Issues whose own labels say nothing but whose parent is labelled. See
    // the note at the classification below.
    const parentLabelledOnly = new Set<string>();

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
      // The parent as Jira sent it, which is the only place its labels are.
      // jira_issue deliberately does not store labels: they belong to the
      // worklog snapshot, and a second stored copy is a second thing that
      // can go stale.
      const parentRaw = parentKey ? issuesByKey.get(parentKey) : undefined;

      const issueBillable = normaliseText(issueRow.billable);
      const parentBillable = normaliseText(parentRow?.billable);

      const billable = issueBillable ?? parentBillable ?? null;
      const billableSource = issueBillable ? "issue" : parentBillable ? "parent" : "unset";

      // -------------------------------------------------------------
      // R&D classification, from the labels on the item the time was
      // booked to.
      //
      // DELIBERATELY NOT INHERITED FROM THE PARENT, unlike `billable`
      // above. The labels are described as applying to work items, and
      // inheriting one would silently claim hours on a deliverable nobody
      // had labelled. Getting that wrong in the direction of claiming
      // more is the expensive mistake.
      //
      // The cost of that choice is a real risk - somebody labels the
      // Project and expects its deliverables to follow - so it is
      // MEASURED rather than assumed away: rndParentLabelledOnly counts
      // worklogs that came out unclassified while their parent carries a
      // label. A non-zero count there means the convention in Jira is
      // parent-level and this decision needs revisiting.
      // -------------------------------------------------------------
      const labels = readLabels(issue.fields?.labels);
      const { rndClass, rndSource, hasBothLabels } = classifyRnd(labels, {
        projectKey: issueRow.projectKey,
        coreProjectKeys: envServer.RND_CORE_PROJECT_KEYS,
      });

      if (hasBothLabels) bothLabelsIssueKeys.add(issue.key);

      if (rndClass === null && parentRaw && classifyRnd(readLabels(parentRaw.fields?.labels)).rndClass !== null) {
        parentLabelledOnly.add(issue.key);
      }

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
        // Frozen here, never derived at query time. See migration 016.
        labelsSnapshot: labelsSnapshot(labels),
        rndClass,
        rndSource,
        classifiedAt: runStartedAt,
      });
    }

    // -----------------------------------------------------------------
    // Reclassifications.
    //
    // Read BEFORE the upsert, because after it the previous value is gone.
    // Only actual CHANGES produce a row: a sync that re-reads the same
    // labels and reaches the same answer writes nothing, so the history
    // stays a record of what moved rather than a log of every run.
    //
    // A worklog with no existing row is a first classification, not a
    // reclassification - there is no "old" to record, and treating an
    // insert as a change would fill the table with noise on any backfill.
    // -----------------------------------------------------------------
    const priorStates = await getWorklogRndStatesRepo(factRows.map((row) => row.worklogId));
    const priorByWorklogId = new Map(priorStates.map((state) => [state.worklogId, state]));

    const historyRows: NewWorklogRndHistory[] = [];

    for (const row of factRows) {
      const prior = priorByWorklogId.get(row.worklogId);
      if (!prior) continue;

      const next = row.rndClass ?? null;
      const nextSource = row.rndSource ?? null;

      // A change of SOURCE is recorded as well as a change of class. An hour
      // that was core because somebody labelled it, and is now core only
      // because of where it lives, is weaker evidence than it was - and a
      // history that only watched the class would call that no change at all.
      if (prior.rndClass === next && prior.rndSource === nextSource) continue;

      historyRows.push({
        id: generateId(),
        worklogId: row.worklogId,
        oldRndClass: prior.rndClass,
        newRndClass: next,
        // Both label arrays, so the change can be explained rather than
        // merely observed: "core to null" is a fact, "core to null because
        // RnD-core was removed" is an answer.
        oldRndSource: prior.rndSource,
        newRndSource: nextSource,
        oldLabels: prior.labelsSnapshot,
        newLabels: row.labelsSnapshot ?? null,
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
      projectsWritten: projectRows.length,
      orphanedIssueIds,
      rndReclassified: historyRows.length,
      rndBothLabelsIssueKeys: [...bothLabelsIssueKeys].sort(),
      rndParentLabelledOnlyIssueKeys: [...parentLabelledOnly].sort(),
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
      await upsertJiraProjectsRepo(projectRows, trx);
      await upsertJiraIssuesRepo(issueRows, trx);
      // History BEFORE the upsert, so a failure cannot leave a new
      // classification stored with no record of what it replaced. Same
      // transaction, so the pair is all or nothing.
      await addWorklogRndHistoryRepo(historyRows, trx);
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
