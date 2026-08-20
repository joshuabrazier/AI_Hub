import "server-only";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES, AI_CHAT_REQUEST_KINDS } from "@/lib/data/kysely-database-types";
import {
  getTimesheetAiSummaryRepo,
  purgeTimesheetAiSummariesRepo,
  TIMESHEET_AI_SUMMARY_RETENTION_DAYS,
  upsertTimesheetAiSummaryRepo,
} from "@/lib/data/repositories/timesheet-ai-summary.repository";
import { BedrockNotConfiguredError, converseText } from "@/lib/ai/converse";
import { BEDROCK_MODEL_ID, BEDROCK_REGION, isBedrockConfigured } from "@/lib/ai/bedrock-client";
import { handleError } from "@/lib/handle-errors";
import { summaryCacheKey, summaryFingerprint, type SummaryFacts } from "@/lib/timesheet/summary-facts";

import { getOverviewService, getStaffDashboardService, type TimesheetRequest } from "./admin-timesheets.service";
import type {
  AdminTimesheetsDTO,
  OverviewDTO,
  StaffDashboardDTO,
  StaffSummaryDTO,
  TimesheetFiltersDTO,
} from "./admin-timesheets.types";
import {
  buildOverviewFacts,
  buildPersonFacts,
  buildStaffFacts,
  buildSummaryPrompt,
  SUMMARY_SYSTEM_PROMPT,
} from "./admin-timesheets-ai.facts";
import type { TimesheetSummaryDTO, TimesheetSummaryScope } from "./admin-timesheets-ai.types";

// -------------------------------------------------------------------
// AI period summaries for the timesheet screens.
//
// THE GUARD IS HERE, not only in the action. A page can call a service
// directly, and this one reads every person's utilisation and billable share,
// so the ADMIN check has to be the service's own. The repository it uses is
// unscoped by design; this is the thing standing in front of it.
//
// THE MODEL NEVER SEES A DATABASE ROW. It is handed the DTO the dashboard
// already computed - the same figures on the screen - so the prose and the
// tiles cannot disagree, and no worklog narrative or raw entry reaches it.
// See admin-timesheets-ai.facts.ts.
//
// READS ARE FREE, WRITING COSTS MONEY. getTimesheetSummaryService only ever
// reads the cache; nothing renders a page into a paid call. Generating is a
// separate function behind a button, which is also why the page can say "no
// summary yet" rather than silently spending on every navigation.
// -------------------------------------------------------------------

// Everything every scope needs, derived in ONE place so the read path and the
// write path cannot disagree about which row they are talking about. A cache
// that reads one key and writes another looks exactly like a cache that never
// works, and it would only show up as a bill.
type ResolvedScope = {
  facts: SummaryFacts;
  filters: TimesheetFiltersDTO;
  cacheKey: string;
  fingerprint: string;
};

// A person scope with no id is a programming error, not a request to summarise
// everybody. Failing loudly beats quietly writing a team summary into a row
// keyed as one person's.
export class PersonScopeRequiresIdError extends Error {
  constructor() {
    super("The person scope requires a personId");
    this.name = "PersonScopeRequiresIdError";
  }
}

async function resolveScope(
  scope: TimesheetSummaryScope,
  request: TimesheetRequest & { personId?: string },
): Promise<ResolvedScope> {
  if (scope === "person") {
    if (!request.personId) throw new PersonScopeRequiresIdError();

    // The person filter is FORCED to the id, exactly as the page itself does
    // it, so the report and every figure in it describe them and nobody else.
    // It also means data.filters.person carries the id, which is what keeps
    // one person's cache row from being served for another - the whole reason
    // the cache key can stay the filter tuple.
    const { data, dashboard } = await getStaffDashboardService({ ...request, person: request.personId });

    const person = dashboard.people.find((candidate) => candidate.personId === request.personId);

    // Nobody by that id in this period. Not an error: the page itself answers
    // notFound() for the same case, and there is nothing to summarise either
    // way. An empty fact set reports as `empty` and never reaches the model.
    if (!person) {
      const facts = buildStaffFacts(data, dashboard);

      return {
        facts: { ...facts, scope: "person", totals: { ...facts.totals, worklogCount: 0 } },
        filters: data.filters,
        cacheKey: summaryCacheKey({ scope, ...data.filters }),
        fingerprint: summaryFingerprint(facts),
      };
    }

    const facts = buildPersonFacts(data, dashboard, person);

    return {
      facts,
      filters: data.filters,
      cacheKey: summaryCacheKey({ scope, ...data.filters }),
      fingerprint: summaryFingerprint(facts),
    };
  }

  if (scope === "staff") {
    const { data, dashboard } = await getStaffDashboardService(request);
    const facts = buildStaffFacts(data, dashboard);

    return {
      facts,
      filters: data.filters,
      cacheKey: summaryCacheKey({ scope, ...data.filters }),
      fingerprint: summaryFingerprint(facts),
    };
  }

  const { data, overview } = await getOverviewService(request);
  const facts = buildOverviewFacts(data, overview);

  return {
    facts,
    filters: data.filters,
    cacheKey: summaryCacheKey({ scope, ...data.filters }),
    fingerprint: summaryFingerprint(facts),
  };
}

// -------------------------------------------------------------------
// What the page shows on load. Never calls the model.
//
// THE VIEWS PASS IN THE DATA THEY ALREADY FETCHED, which is why there are
// three entry points rather than one taking a request. A single
// request-shaped function would re-run getStaffDashboardService or
// getOverviewService that the page had just run - two identical dashboard
// queries per render, on three screens, for a panel that is usually empty.
// Nothing here fetches; it maps and reads one cache row.
//
// A row whose fingerprint no longer matches is reported as STALE rather than
// hidden: the reader is better served by "here is what it said, the numbers
// have since moved" than by an empty panel, and it stops a sync quietly
// erasing something somebody was reading.
// -------------------------------------------------------------------
async function readCachedSummary(
  scope: TimesheetSummaryScope,
  facts: SummaryFacts,
  filters: TimesheetFiltersDTO,
): Promise<TimesheetSummaryDTO> {
  await requireUserRole([USER_ROLES.ADMIN]);

  const configured = isBedrockConfigured();
  const cached = await getTimesheetAiSummaryRepo(summaryCacheKey({ scope, ...filters }));

  if (!cached) return { scope, available: configured, state: "none", summary: null, generatedAt: null };

  return {
    scope,
    available: configured,
    state: cached.dataFingerprint === summaryFingerprint(facts) ? "current" : "stale",
    summary: cached.summary,
    generatedAt: cached.createdAt,
  };
}

export async function getOverviewSummaryService(
  data: AdminTimesheetsDTO,
  overview: OverviewDTO,
): Promise<TimesheetSummaryDTO> {
  try {
    return await readCachedSummary("overview", buildOverviewFacts(data, overview), data.filters);
  } catch (error) {
    throw handleError("getOverviewSummaryService", error);
  }
}

export async function getStaffSummaryService(
  data: AdminTimesheetsDTO,
  dashboard: StaffDashboardDTO,
): Promise<TimesheetSummaryDTO> {
  try {
    return await readCachedSummary("staff", buildStaffFacts(data, dashboard), data.filters);
  } catch (error) {
    throw handleError("getStaffSummaryService", error);
  }
}

export async function getPersonSummaryService(
  data: AdminTimesheetsDTO,
  dashboard: StaffDashboardDTO,
  person: StaffSummaryDTO,
): Promise<TimesheetSummaryDTO> {
  try {
    return await readCachedSummary("person", buildPersonFacts(data, dashboard, person), data.filters);
  } catch (error) {
    throw handleError("getPersonSummaryService", error);
  }
}

// -------------------------------------------------------------------
// Write one. The only path that spends anything.
//
// Short-circuits on a matching fingerprint, so a double click, two admins on
// the same screen, or a stray refresh cost nothing. The check is here rather
// than in the action because the action is not the only possible caller.
// -------------------------------------------------------------------
export async function generateTimesheetSummaryService(
  scope: TimesheetSummaryScope,
  request: TimesheetRequest & { personId?: string } = {},
): Promise<TimesheetSummaryDTO> {
  try {
    const actor = await requireUserRole([USER_ROLES.ADMIN]);

    const { facts, filters, cacheKey, fingerprint } = await resolveScope(scope, request);

    const cached = await getTimesheetAiSummaryRepo(cacheKey);
    if (cached && cached.dataFingerprint === fingerprint) {
      return {
        scope,
        available: true,
        state: "current",
        summary: cached.summary,
        generatedAt: cached.createdAt,
      };
    }

    // Nothing to describe. Worth stopping before the call rather than paying
    // for a paragraph explaining that there is no data - the screen already
    // has an empty state that says it better and for nothing.
    if (!facts.totals.worklogCount) {
      return { scope, available: isBedrockConfigured(), state: "empty", summary: null, generatedAt: null };
    }

    const result = await converseText({
      userId: actor.id,
      kind: AI_CHAT_REQUEST_KINDS.TIMESHEET_SUMMARY,
      system: SUMMARY_SYSTEM_PROMPT,
      prompt: buildSummaryPrompt(facts),
    });

    const stored = await upsertTimesheetAiSummaryRepo({
      cacheKey,
      scope,
      granularity: filters.granularity,
      // The resolved period start, not whatever the caller asked for: the
      // request may carry nothing at all and let the service pick.
      periodStart: filters.start,
      category: facts.filters.category,
      project: facts.filters.project,
      person: facts.filters.person,
      dataFingerprint: fingerprint,
      summary: result.text,
      modelId: BEDROCK_MODEL_ID,
      region: BEDROCK_REGION,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
      cacheWriteTokens: result.usage.cacheWriteTokens,
      generatedBy: actor.id,
    });

    return {
      scope,
      available: true,
      state: "current",
      summary: stored.summary,
      generatedAt: stored.createdAt,
    };
  } catch (error) {
    // An unconfigured deployment is a state, not a fault: the feature is
    // optional and the panel says so rather than showing an error toast for
    // something no admin can fix from the app.
    if (error instanceof BedrockNotConfiguredError) {
      return { scope, available: false, state: "none", summary: null, generatedAt: null };
    }

    throw handleError("generateTimesheetSummaryService", error);
  }
}

// -------------------------------------------------------------------
// Retention: drop cached summaries past their window.
//
// NO ROLE CHECK, and that is the one exception in this file. The caller is the
// monthly job route, which authenticates with RETENTION_JOB_SECRET and has no
// session at all - requiring ADMIN here would make the job fail rather than
// make anything safer. It reads nothing and returns a count.
//
// Not gated on RETENTION_JOB_ENABLED either. That switch guards
// DE-IDENTIFICATION, which is irreversible; this is a cache sweep, and every
// row it removes can be rewritten by pressing a button.
// -------------------------------------------------------------------
export async function purgeExpiredTimesheetSummariesService(): Promise<{
  retentionDays: number;
  purged: number;
}> {
  try {
    const retentionDays = TIMESHEET_AI_SUMMARY_RETENTION_DAYS;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    return { retentionDays, purged: await purgeTimesheetAiSummariesRepo(cutoff) };
  } catch (error) {
    throw handleError("purgeExpiredTimesheetSummariesService", error);
  }
}
