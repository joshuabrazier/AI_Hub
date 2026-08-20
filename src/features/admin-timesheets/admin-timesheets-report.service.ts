import "server-only";

import { notFound } from "next/navigation";

import { BEDROCK_MODEL_ID, BEDROCK_REGION, isBedrockConfigured } from "@/lib/ai/bedrock-client";
import { BedrockNotConfiguredError, converseText } from "@/lib/ai/converse";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { AI_CHAT_REQUEST_KINDS, USER_ROLES, type TimesheetReport } from "@/lib/data/kysely-database-types";
import {
  addTimesheetReportRepo,
  deleteTimesheetReportRepo,
  getTimesheetReportRepo,
  listTimesheetReportsRepo,
  purgeTimesheetReportsRepo,
  TIMESHEET_REPORT_RETENTION_DAYS,
} from "@/lib/data/repositories/timesheet-report.repository";
import { handleError } from "@/lib/handle-errors";
import { generateId } from "better-auth";
import type { ReportFacts } from "@/lib/timesheet/report-facts";

import { getOverviewService, getStaffDashboardService, type TimesheetRequest } from "./admin-timesheets.service";
import { buildReportFacts, buildReportPrompt, REPORT_SYSTEM_PROMPT } from "./admin-timesheets-report.facts";
import type {
  TimesheetReportDTO,
  TimesheetReportListItemDTO,
  TimesheetReportsPageDTO,
} from "./admin-timesheets-report.types";

// -------------------------------------------------------------------
// Saved timesheet reports.
//
// THE GUARD IS HERE, in the service, on every function including the reads.
// The repository is unscoped by design and a report holds every person's
// utilisation and billable share, so this is the only thing in front of it.
//
// A REPORT IS A RECORD. There is no cache lookup, no fingerprint and no
// staleness: writing one always calls the model and always inserts a new row.
// That is the point of the feature - a summary tells you how things are, a
// report is what somebody wrote down about how they were. Two reports of the
// same month written a week apart are two documents, not a conflict.
//
// A report costs a real Opus call every time, which is why nothing here is
// reachable by rendering a page. Creating one is an explicit act with a name
// attached to it.
// -------------------------------------------------------------------

// Generous next to a summary's 1,500: six sections over a month of data. Still
// bounded, because an unbounded max is how one call quietly costs what fifty
// should.
const REPORT_MAX_TOKENS = 6_000;

// Nothing logged in the period. Its own error rather than a null return so the
// action can say why in words a person can act on, instead of a generic
// failure for something that is not a failure.
export class EmptyPeriodError extends Error {
  constructor() {
    super("There is nothing logged in this period to report on");
    this.name = "EmptyPeriodError";
  }
}

// -------------------------------------------------------------------
// The stored `facts` blob is JSONB written from a shape that will grow as the
// report gains sections. An old row must stay READABLE after it does, so it is
// parsed defensively and a row whose evidence cannot be read still renders its
// prose rather than throwing the page away.
// -------------------------------------------------------------------
function readFacts(raw: unknown): Partial<ReportFacts> | null {
  if (raw === null || raw === undefined) return null;

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    return parsed as Partial<ReportFacts>;
  } catch {
    // Deliberately silent about the content: this is a display concern, and
    // the row is not lost - only its evidence panel.
    console.warn("[timesheet-report] stored facts could not be parsed");
    return null;
  }
}

function toListItem(row: {
  id: string;
  title: string;
  periodLabel: string;
  granularity: string;
  periodStart: string;
  category: string;
  project: string;
  person: string;
  createdByName: string | null;
  createdAt: Date;
}): TimesheetReportListItemDTO {
  return {
    id: row.id,
    title: row.title,
    periodLabel: row.periodLabel,
    granularity: row.granularity,
    periodStart: row.periodStart,
    category: row.category,
    project: row.project,
    person: row.person,
    authorName: row.createdByName,
    createdAt: row.createdAt,
  };
}

function toReportDTO(row: TimesheetReport): TimesheetReportDTO {
  return {
    ...toListItem(row),
    body: row.body,
    facts: readFacts(row.facts),
    modelId: row.modelId,
    // With prompt caching off on this path these are the whole story, but the
    // sum is still the right thing to show: reading inputTokens alone is how a
    // working cache gets mistaken for a broken counter. See CLAUDE.md.
    totalInputTokens:
      row.inputTokens === null && row.cacheReadTokens === null && row.cacheWriteTokens === null
        ? null
        : (row.inputTokens ?? 0) + (row.cacheReadTokens ?? 0) + (row.cacheWriteTokens ?? 0),
    outputTokens: row.outputTokens,
  };
}

export async function getTimesheetReportsPageService(): Promise<TimesheetReportsPageDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    return {
      available: isBedrockConfigured(),
      reports: (await listTimesheetReportsRepo()).map(toListItem),
    };
  } catch (error) {
    throw handleError("getTimesheetReportsPageService", error);
  }
}

// -------------------------------------------------------------------
// One report.
//
// notFound() rather than an error for a missing id: a guessed id should not
// confirm whether a report exists, which is the same reasoning the person page
// applies. A role failure may say so plainly; a lookup failure may not.
// -------------------------------------------------------------------
export async function getTimesheetReportService(id: string): Promise<TimesheetReportDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const row = await getTimesheetReportRepo(id);
    if (!row) notFound();

    return toReportDTO(row);
  } catch (error) {
    throw handleError("getTimesheetReportService", error);
  }
}

// -------------------------------------------------------------------
// Write one. Always calls the model; always inserts.
//
// Both dashboard services are called because a report spans both screens -
// the business figures and the people figures - and there is no cheaper way to
// get a consistent pair. They are awaited together rather than in sequence:
// they are independent reads of the same read model.
// -------------------------------------------------------------------
export async function createTimesheetReportService(
  title: string,
  request: TimesheetRequest = {},
): Promise<{ id: string } | { unavailable: true }> {
  try {
    const actor = await requireUserRole([USER_ROLES.ADMIN]);

    const [{ data, overview }, { dashboard }] = await Promise.all([
      getOverviewService(request),
      getStaffDashboardService(request),
    ]);

    const facts = buildReportFacts(data, overview, dashboard);

    // Nothing logged in the period. Refused before the call rather than paying
    // for six headings explaining that there is no data.
    if (!facts.business.worklogCount) {
      throw new EmptyPeriodError();
    }

    const result = await converseText({
      userId: actor.id,
      kind: AI_CHAT_REQUEST_KINDS.TIMESHEET_REPORT,
      system: REPORT_SYSTEM_PROMPT,
      prompt: buildReportPrompt(facts, title),
      maxTokens: REPORT_MAX_TOKENS,
    });

    const stored = await addTimesheetReportRepo({
      id: generateId(),
      title,
      granularity: data.filters.granularity,
      periodStart: data.filters.start,
      // Snapshotted, so a later copy change to how periods are written does
      // not silently relabel this report.
      periodLabel: data.period.label,
      category: data.filters.category,
      project: data.filters.project,
      person: data.filters.person,
      body: result.text,
      facts: JSON.stringify(facts),
      modelId: BEDROCK_MODEL_ID,
      region: BEDROCK_REGION,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      cacheWriteTokens: result.usage.cacheWriteTokens,
      createdBy: actor.id,
      // Snapshotted beside the id, like audit_logs actor_name, so the report
      // still says who wrote it after that account is renamed or removed.
      createdByName: actor.name ?? null,
    });

    return { id: stored.id };
  } catch (error) {
    // An unconfigured deployment is a state, not a fault - the feature is
    // optional and no admin can fix a missing token from this screen.
    if (error instanceof BedrockNotConfiguredError) return { unavailable: true };

    throw handleError("createTimesheetReportService", error);
  }
}

export async function deleteTimesheetReportService(id: string): Promise<void> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    // No existence check first. Deleting something already gone is the
    // outcome the caller wanted, and a "no such report" answer to a guessed id
    // is the enumeration oracle notFound() exists to avoid.
    await deleteTimesheetReportRepo(id);
  } catch (error) {
    throw handleError("deleteTimesheetReportService", error);
  }
}

// -------------------------------------------------------------------
// Retention. No role check: the caller is the monthly job route, which
// authenticates with RETENTION_JOB_SECRET and has no session. Not gated on
// RETENTION_JOB_ENABLED either - that switch guards irreversible
// de-identification, and this is a dated sweep of a documented window.
//
// Unlike the summary cache, what this removes CANNOT be regenerated: the read
// model has moved on. That is the cost of putting a window on an artefact, and
// it is the right trade for prose about how individuals performed. The window
// is long and it is written down.
// -------------------------------------------------------------------
export async function purgeExpiredTimesheetReportsService(): Promise<{
  retentionDays: number;
  purged: number;
}> {
  try {
    const retentionDays = TIMESHEET_REPORT_RETENTION_DAYS;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    return { retentionDays, purged: await purgeTimesheetReportsRepo(cutoff) };
  } catch (error) {
    throw handleError("purgeExpiredTimesheetReportsService", error);
  }
}
