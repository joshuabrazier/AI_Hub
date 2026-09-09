import "server-only";

import { BedrockNotConfiguredError, converseText } from "@/lib/ai/converse";
import { isBedrockConfigured } from "@/lib/ai/bedrock-client";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { AI_CHAT_REQUEST_KINDS, USER_ROLES } from "@/lib/data/kysely-database-types";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { isGranularity } from "@/lib/timesheet/period";

import {
  getAdminTimesheetsService,
  getStaffDashboardService,
  type TimesheetRequest,
} from "./admin-timesheets.service";
import { buildAnswerMeasures, describeScope } from "./admin-timesheets-answer";
import { getForecastForScopeService } from "./admin-timesheets-forecast.service";
import { getOutstandingEffortService } from "./admin-timesheets-outstanding.service";
import { getRevenueForFactsService } from "./admin-timesheets-revenue.service";
import { buildQueryPrompt, QUERY_SYSTEM_PROMPT } from "./admin-timesheets-query.prompt";
import { ResolvedQuerySchema, type TimesheetQueryResultDTO } from "./admin-timesheets-query.types";

// -------------------------------------------------------------------
// Turning a typed question into a filtered dashboard.
//
// THE MODEL RETURNS FILTERS, NEVER SQL, AND NEVER A URL. It picks values from
// a closed vocabulary; this service checks each one against that vocabulary,
// and then IT builds the path. Repositories stay the only database access and
// the ordinary typed query runs unchanged, so the widest thing this feature
// can do is show an admin a page they could already have reached with the
// filter controls.
//
// The interesting failure is not injection - Kysely parameterises everything -
// it is a WRONG ANSWER THAT LOOKS RIGHT. An invented person id produces an
// empty dashboard, and an empty dashboard reads as "nobody logged any time",
// not as "I misunderstood you". So a value that is not on the list is dropped
// and reported, never passed through.
// -------------------------------------------------------------------

// Small: the reply is one flat object. A generous cap here would only pay for
// the model explaining itself at length, which this prompt asks it not to do.
const QUERY_MAX_TOKENS = 600;

// The reply did not fit the shape. Its own error so the action can say "I could
// not read that as a filter" rather than reporting a generic fault for a
// recoverable misunderstanding.
//
// handleError returns the same instance for anything already an Error, so this
// survives the service's catch and the action's instanceof check.
export class QueryNotUnderstoodError extends Error {
  constructor() {
    super("Could not turn that into a filter");
    this.name = "QueryNotUnderstoodError";
  }
}

// -------------------------------------------------------------------
// The model is told to reply with bare JSON. Models wrap JSON in a fence
// anyway, often enough that stripping one is cheaper than a retry - and a
// retry would double the cost of the most common recoverable failure.
// -------------------------------------------------------------------
function parseJsonReply(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();

  // Also tolerate a sentence before or after the object, by taking the outer
  // braces. Anything less structured than that is a genuine failure.
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace <= firstBrace) throw new QueryNotUnderstoodError();

  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  } catch {
    throw new QueryNotUnderstoodError();
  }
}

// -------------------------------------------------------------------
// The allowlist check, and the reason this service exists rather than the
// action calling the model directly.
//
// `offered` is the exact set of values the prompt put in front of the model
// for THIS period. A returned value outside it is dropped and named, so the
// caller can say "I could not find a person called that" instead of rendering
// an empty page.
// -------------------------------------------------------------------
// Exported for its own tests. This is the security boundary of the feature -
// the thing that holds when the model does not - so it is tested directly
// rather than only through whatever the model happens to return on the day.
export function admitOption(
  value: string | null,
  offered: Set<string>,
  label: string,
  rejected: string[],
): string | undefined {
  if (value === null || value === "" || value === "all") return undefined;

  if (!offered.has(value)) {
    rejected.push(label);
    return undefined;
  }

  return value;
}

// A date the period code can work with. The regex in the schema proves the
// shape; this proves it is a real day and not 2026-13-45, and that it is not
// somewhere absurd that would make the period control useless.
export function admitStart(value: string | null, rejected: string[]): string | undefined {
  if (!value) return undefined;

  const parsed = new Date(`${value}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() < 2000 || parsed.getUTCFullYear() > 2100) {
    rejected.push("the date");
    return undefined;
  }

  // Round-tripped, so 2026-02-31 does not silently become 2026-03-03.
  if (parsed.toISOString().slice(0, 10) !== value) {
    rejected.push("the date");
    return undefined;
  }

  return value;
}

export async function askTimesheetQueryService(
  question: string,
  request: TimesheetRequest = {},
): Promise<TimesheetQueryResultDTO> {
  try {
    const actor = await requireUserRole([USER_ROLES.ADMIN]);

    if (!isBedrockConfigured()) throw new BedrockNotConfiguredError();

    // The options come from the period the reader is on, which is also what
    // makes "the week before" answerable.
    const data = await getAdminTimesheetsService(request);

    const result = await converseText({
      userId: actor.id,
      kind: AI_CHAT_REQUEST_KINDS.TIMESHEET_QUERY,
      system: QUERY_SYSTEM_PROMPT,
      prompt: buildQueryPrompt({
        question,
        // From the SESSION, never from the question. "my hours" must mean the
        // person signed in, not whoever a question claims to be.
        askedBy: actor.name ?? null,
        today: data.todayIso,
        currentGranularity: data.filters.granularity,
        currentPeriodLabel: data.period.label,
        categories: data.categoryOptions,
        clients: data.clientOptions,
        projects: data.projectOptions,
        people: data.personOptions,
      }),
      maxTokens: QUERY_MAX_TOKENS,
    });

    const parsed = ResolvedQuerySchema.safeParse(parseJsonReply(result.text));

    // A reply that does not fit the shape is a failure, not something to
    // salvage. Guessing at a malformed filter is how a confident dashboard of
    // the wrong thing gets rendered.
    if (!parsed.success) throw new QueryNotUnderstoodError();

    const resolved = parsed.data;

    if (!resolved.understood) {
      return {
        understood: false,
        href: null,
        interpretation: resolved.interpretation,
        rejected: [],
        answer: null,
      };
    }

    const rejected: string[] = [];

    const granularity = resolved.granularity && isGranularity(resolved.granularity)
      ? resolved.granularity
      : data.filters.granularity;

    const start = admitStart(resolved.start, rejected) ?? data.filters.start;

    const params = new URLSearchParams({ granularity, start });

    const category = admitOption(
      resolved.category,
      new Set(data.categoryOptions.map((option) => option.value)),
      "that category",
      rejected,
    );
    const client = admitOption(
      resolved.client,
      new Set(data.clientOptions.map((option) => option.value)),
      "that client",
      rejected,
    );
    const project = admitOption(
      resolved.project,
      new Set(data.projectOptions.map((option) => option.value)),
      "that job",
      rejected,
    );

    // Each name is admitted INDEPENDENTLY, so asking about three people of
    // whom one has left narrows to the two who are here and says so - rather
    // than throwing the whole filter away because one id was unknown.
    const offeredPeople = new Set(data.personOptions.map((option) => option.value));

    const people = (resolved.people ?? [])
      .map((value) => admitOption(value, offeredPeople, "that person", rejected))
      .filter((value): value is string => Boolean(value));

    const billable = resolved.billable && resolved.billable !== "all" ? resolved.billable : undefined;

    if (category) params.set("category", category);
    if (client) params.set("client", client);
    if (project) params.set("project", project);
    if (people.length > 0) params.set("person", people.join(","));
    if (billable) params.set("billable", billable);

    // Built HERE, from values this service admitted, and always a relative
    // path on this app. A model-supplied URL would be an open redirect; a
    // model-supplied filter tuple cannot be, because the server decides what
    // to do with it.
    //
    // ONE person lands on their own page, because that is the screen measuring
    // somebody against their own target. Two or more lands on the entries
    // list: there is no screen that compares two people against their separate
    // capacities, and sending them to one person's page would answer a
    // narrower question than they asked.
    const href =
      people.length === 1
        ? `${ROUTES.ADMIN_TIMESHEETS_STAFF}/${encodeURIComponent(people[0])}?${params.toString()}`
        : `${ROUTES.ADMIN_TIMESHEETS_ENTRIES}?${params.toString()}`;

    // -----------------------------------------------------------------
    // The answer, when figures were asked for.
    //
    // Recomputed through the ORDINARY service with the resolved filters, so
    // the numbers in the card are the same numbers the linked page will show.
    // Deriving them from the unfiltered `data` above would answer a different
    // question from the one the link opens.
    // -----------------------------------------------------------------
    const measures = resolved.measures ?? [];

    // -----------------------------------------------------------------
    // A question about work outstanding gets sent to the screen that answers
    // it, not to the entries list.
    //
    // Only when EVERY measure asked for is an outstanding one. A question
    // wanting cost and work-left together belongs on a period screen, because
    // that is where the cost half lives - and sending it to a page with no
    // period on it would answer the smaller half of the question.
    //
    // The client comes from the project when the question named only the
    // project, since a project belongs to exactly one client and the
    // Outstanding page needs both to open on the right scope.
    // -----------------------------------------------------------------
    const outstandingMeasures = measures.filter((measure) =>
      ["outstandingWork", "budgetLeft", "unsizedWork"].includes(measure),
    );
    const wantsOutstanding = outstandingMeasures.length > 0;
    const onlyOutstanding = wantsOutstanding && outstandingMeasures.length === measures.length;

    const projectOption = project ? data.projectOptions.find((option) => option.value === project) : undefined;
    const outstandingClient = client ?? projectOption?.clientKey ?? null;

    const outstandingHref = (() => {
      const outstandingParams = new URLSearchParams();
      if (outstandingClient) outstandingParams.set("client", outstandingClient);
      if (project) outstandingParams.set("project", project);
      const query = outstandingParams.toString();
      return query
        ? `${ROUTES.ADMIN_TIMESHEETS_OUTSTANDING}?${query}`
        : ROUTES.ADMIN_TIMESHEETS_OUTSTANDING;
    })();

    const resolvedHref = onlyOutstanding ? outstandingHref : href;

    if (measures.length === 0) {
      return {
        understood: true,
        href: resolvedHref,
        interpretation: resolved.interpretation,
        rejected,
        answer: null,
      };
    }

    const scopedRequest: TimesheetRequest = {
      granularity,
      start,
      category,
      client,
      project,
      person: people.length > 0 ? people.join(",") : undefined,
      billable,
    };

    const scoped = await getAdminTimesheetsService(scopedRequest);
    const revenue = await getRevenueForFactsService(scoped.report.facts);

    // Utilisation AND every forecast need contracted capacity, which only the
    // staff dashboard knows. Fetched once when any of them is asked for, so a
    // plain "what did it cost" question does not pay for a capacity
    // calculation nobody wanted.
    const needsCapacity = measures.some((measure) =>
      ["utilisation", "projectedCost", "projectedValue", "remainingCapacity"].includes(measure),
    );

    const dashboard = needsCapacity ? (await getStaffDashboardService(scopedRequest)).dashboard : null;

    // Scoped by CLIENT and PROJECT only. Deliberately not by person or by
    // period: an estimate is not owned by anybody, and work left to do is a
    // fact about now. Passing the period filters in would have produced a
    // figure that changed when the reader stepped a month, which is exactly
    // the misreading the caveat on these measures exists to prevent.
    const outstanding = wantsOutstanding
      ? await getOutstandingEffortService({ clientKey: outstandingClient, projectKey: project })
      : null;

    // Today comes from the app's own zone, never a clock in this file: a
    // forecast that disagreed with the dashboard about what day it is would
    // count the wrong number of days remaining.
    const forecast = dashboard
      ? await getForecastForScopeService(
          dashboard,
          scoped.period,
          scoped.todayIso,
          revenue,
          scoped.report.facts,
          people,
        )
      : null;

    const peopleNames = people.map(
      (id) => data.personOptions.find((option) => option.value === id)?.label ?? id,
    );

    return {
      understood: true,
      href: resolvedHref,
      interpretation: resolved.interpretation,
      rejected,
      answer: {
        periodLabel: scoped.period.label,
        scope: describeScope({
          periodLabel: scoped.period.label,
          peopleNames,
          category,
          clientLabel: client
            ? (data.clientOptions.find((option) => option.value === client)?.label ?? client)
            : undefined,
          projectLabel: projectOption?.summary ?? project ?? undefined,
          billable,
        }),
        measures: buildAnswerMeasures(measures, scoped, revenue, dashboard, forecast, outstanding),
      },
    };
  } catch (error) {
    throw handleError("askTimesheetQueryService", error);
  }
}
