import "server-only";

import { requireUser } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { getUserByUserIdRepo } from "@/lib/data/repositories/users.repository";
import { getWorklogFactsInRangeRepo } from "@/lib/data/repositories/timesheet.repository";
import { envServer } from "@/lib/env-server";
import { handleError } from "@/lib/handle-errors";
import { secondsToHours, type OutstandingSummary } from "@/lib/timesheet/outstanding";
import { getOutstandingEffortService } from "./admin-timesheets-outstanding.service";
import { buildReport } from "@/lib/timesheet/aggregate";
import { Granularity, isGranularity, resolvePeriod } from "@/lib/timesheet/period";
import { capacityHoursForRange, measureAgainstCapacity, toStaffCapacity } from "@/lib/timesheet/staff-capacity";
import { todayInAppZone } from "@/lib/timezone";

import { loadStaffTargets } from "./admin-timesheets-loaders";
import { getAdminTimesheetsService, getOverviewService } from "./admin-timesheets.service";
import { getRevenueForFactsService } from "./admin-timesheets-revenue.service";

// -------------------------------------------------------------------
// Timesheet figures for the AI chat.
//
// THIS FUNCTION IS THE SECURITY BOUNDARY for the whole feature, and it is
// worth being blunt about why it has to be.
//
// AI chat is available to EVERY signed-in user - its guard is requireUser,
// because a conversation is private from other users rather than scoped to a
// team. Timesheets are admin-only. Wiring one to the other without a check
// would hand any member a way to read a colleague's utilisation, and their pay
// rate, by typing a question - a privilege escalation through a side channel,
// which is the kind that does not look like one until somebody tries it.
//
// So:
//
//   THE SCOPE COMES FROM THE SESSION, NEVER FROM THE QUESTION. A member asking
//   about Philipp does not get Philipp. The `person` argument is only ever
//   consulted for an admin; for everybody else it is discarded before it can
//   reach a query, rather than validated and rejected. There is no argument a
//   model can emit that widens what the caller may see.
//
//   COST IS ADMIN-ONLY, SEPARATELY. A member's own figures carry hours,
//   utilisation and billable share, and never their own pay rate - the point
//   is what they worked, not what they are worth, and their rate is not theirs
//   to be told by a chatbot either.
//
//   THE MODEL NEVER COMPUTES A NUMBER. Everything below is already finished
//   and rounded before it is handed over. That rule predates this feature: a
//   model asked to derive utilisation will sometimes divide by five days for
//   somebody contracted to three, and a plausible wrong figure in prose is
//   worse than no figure. See aggregate.ts.
// -------------------------------------------------------------------

export interface TimesheetChatFactsRequest {
  granularity?: string;
  // Any date inside the wanted period. Defaults to today's period.
  start?: string;
  // A person's NAME as the model heard it. Admin only, and resolved against
  // the period's own list rather than trusted - see resolvePerson. Ignored
  // entirely for anybody else.
  person?: string;
  client?: string;
  category?: string;
  billable?: string;
  // A piece of work to narrow to, by name. Matched against the period's own
  // projects the same way a client name is - exact, then case-insensitive,
  // then a unique prefix - and dropped and NAMED when it misses.
  project?: string;
}

export interface TimesheetChatFacts {
  // What was ACTUALLY applied, echoed back so the model describes the figures
  // it was given rather than the ones it asked for. A silently narrowed scope
  // is how a confident wrong answer happens.
  scope: {
    period: string;
    from: string;
    to: string;
    viewer: "admin" | "self";
    person: string | null;
    client: string | null;
    project: string | null;
    category: string | null;
    billable: string | null;
    // Set when something asked for could not be honoured, so the model can
    // say so instead of answering a different question.
    notes: string[];
  };
  totals: {
    hours: number;
    billableHours: number;
    nonBillableHours: number;
    unsetHours: number;
    billableSharePercent: number | null;
    entries: number;
    daysWorked: number;
  };
  capacity: {
    contractedHours: number | null;
    utilisationPercent: number | null;
    billableTargetPercent: number | null;
  };
  // Admin only, and absent entirely otherwise - not null, absent, so there is
  // no shape suggesting a value was withheld.
  money?: {
    chargeableValue: string;
    cost: string;
    margin: string | null;
    marginPercent: number | null;
    effectiveRatePerHour: string;
  };
  // WORK STILL TO DO. Admin only, and absent entirely otherwise - estimates
  // are a client's budget, which is the same reasoning that keeps money out of
  // a member's payload.
  //
  // NOT PERIOD SCOPED, unlike everything else here, which is why it carries
  // its own note rather than relying on the scope block above it. A model
  // handed "84.5" inside a payload headed "September 2026" will say
  // "84.5 hours outstanding in September" unless told otherwise.
  outstanding?: {
    // null when nothing in scope is sized. Never 0 - "no work left" and "we
    // have not estimated it" are opposite answers.
    workLeftHours: number | null;
    // BUDGET LEFT, which is a different question from work left and usually
    // the one meant by "how much have we got left on this".
    //
    // Work left is what the open tasks are estimated at. Budget left is
    // everything committed less everything spent, so coming in under on
    // finished work gives that time back. Measured live on Phase 2: 39h of
    // work left, 84.5h of budget left, because its finished items were
    // estimated at 51h and took 5.5h.
    //
    // null when nothing is committed - there is nothing to measure against,
    // and zero would read as "no budget left" rather than "no budget set".
    budgetLeftHours: number | null;
    committedHours: number;
    spentHours: number;
    overBudgetHours: number;
    openItems: number;
    sizedItems: number;
    unsizedItems: number;
    unsizedHoursLogged: number;
    // FINISHED WORK, and what it actually took. The evidence for whether the
    // estimates behind workLeftHours are worth anything - measured live, Phase
    // 2's finished items were estimated at 51h and took 5.5h, which is exactly
    // the sort of thing a reader should be told when they ask what is left.
    finishedItems: number;
    finishedEstimatedHours: number;
    finishedActualHours: number;
    note: string;
  };
  people?: { name: string; hours: number; billableSharePercent: number | null; utilisationPercent: number | null }[];
  clients?: { name: string; hours: number; projects: number }[];
  // The vocabulary that WAS available, so a name the model got wrong can be
  // corrected on its next call rather than guessed at.
  available?: { people: string[]; clients: string[]; projects: string[] };
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function percent(ratio: number | null): number | null {
  return ratio === null ? null : Math.round(ratio * 100);
}

// -------------------------------------------------------------------
// A name to an id, against the period's OWN list.
//
// Exact match first, then a unique case-insensitive one, then a unique
// prefix. Anything ambiguous is refused BY NAME rather than resolved to a
// guess: two people called Josh and an arbitrary pick is a wrong answer that
// looks right, which is the failure mode that matters here.
// -------------------------------------------------------------------
export function resolveNamed(
  wanted: string,
  options: { value: string; label: string }[],
  kind: "person" | "client" | "project",
): { id: string | null; note: string | null } {
  const trimmed = wanted.trim();
  if (!trimmed) return { id: null, note: null };

  // A key rather than a name. The model is told to use names, but a key is
  // unambiguous and refusing one would be pedantry.
  const byValue = options.filter((option) => option.value.toLowerCase() === trimmed.toLowerCase());
  if (byValue.length === 1) return { id: byValue[0].value, note: null };

  const exact = options.filter((option) => option.label === trimmed);
  if (exact.length === 1) return { id: exact[0].value, note: null };

  const lower = trimmed.toLowerCase();

  const insensitive = options.filter((option) => option.label.toLowerCase() === lower);
  if (insensitive.length === 1) return { id: insensitive[0].value, note: null };

  const prefix = options.filter((option) => option.label.toLowerCase().startsWith(lower));
  if (prefix.length === 1) return { id: prefix[0].value, note: null };

  if (prefix.length > 1) {
    return {
      id: null,
      note: `"${trimmed}" matches more than one ${kind} (${prefix.map((o) => o.label).join(", ")}); no ${kind} filter was applied.`,
    };
  }

  const noun = kind === "person" ? "No person called" : "No client called";
  const tail = kind === "person" ? "logged time in this period" : "was found";

  return { id: null, note: `${noun} "${trimmed}" ${tail}; no ${kind} filter was applied.` };
}

// Kept as a named wrapper so the person path reads as what it is, and so the
// tests that pin the resolver's behaviour do not have to pass a discriminator
// on every call.
export function resolvePerson(
  wanted: string,
  options: { value: string; label: string }[],
): { id: string | null; note: string | null } {
  return resolveNamed(wanted, options, "person");
}

export async function getTimesheetChatFactsService(
  request: TimesheetChatFactsRequest,
): Promise<TimesheetChatFacts> {
  try {
    const user = await requireUser();
    const isAdmin = user.role === USER_ROLES.ADMIN;

    return isAdmin ? await adminFacts(request) : await ownFacts(request, user.id);
  } catch (error) {
    throw handleError("getTimesheetChatFactsService", error);
  }
}

// -------------------------------------------------------------------
// The admin view: everything, through the same service the dashboard uses, so
// the chat cannot report a figure the screen would disagree with.
// -------------------------------------------------------------------
async function adminFacts(request: TimesheetChatFactsRequest): Promise<TimesheetChatFacts> {
  const notes: string[] = [];

  // Unfiltered first, so both names are matched against the period's full
  // lists rather than against an already-narrowed echo of them.
  const base = await getAdminTimesheetsService({
    granularity: request.granularity,
    start: request.start,
    category: request.category,
    billable: request.billable,
  });

  let clientKey: string | undefined;
  if (request.client) {
    const resolved = resolveNamed(
      request.client,
      base.clientOptions.filter((option) => option.value !== "all"),
      "client",
    );
    if (resolved.id) clientKey = resolved.id;
    if (resolved.note) notes.push(resolved.note);
  }

  let projectKey: string | undefined;
  if (request.project) {
    const resolved = resolveNamed(
      request.project,
      // Matched on the SUMMARY, because that is what a person calls a project:
      // "Phase 2", not "TSSS-88". The value stays the key.
      base.projectOptions
        .filter((option) => option.value !== "all")
        .map((option) => ({ value: option.value, label: option.summary ?? option.label })),
      "project",
    );
    if (resolved.id) projectKey = resolved.id;
    if (resolved.note) notes.push(resolved.note);
  }

  const scopeRequest = {
    granularity: request.granularity,
    start: request.start,
    category: request.category,
    client: clientKey,
    project: projectKey,
    billable: request.billable,
  };

  let personId: string | null = null;
  if (request.person) {
    const resolved = resolvePerson(
      request.person,
      base.personOptions.filter((option) => option.value !== "all"),
    );
    personId = resolved.id;
    if (resolved.note) notes.push(resolved.note);
  }

  // One call, giving both the filtered report and the capacity behind
  // utilisation - and it is the SAME call the dashboard makes, so the chat
  // cannot report a figure the screen would disagree with.
  const { data, overview } = await getOverviewService({
    ...scopeRequest,
    ...(personId ? { person: personId } : {}),
  });

  const { period, filters, report, personOptions, clientOptions } = data;

  const revenue = await getRevenueForFactsService(report.facts);

  // Scoped by client and project only. Deliberately NOT by person or period:
  // an estimate is not owned by anybody, and work left to do is a fact about
  // now rather than about the month being reported.
  const outstanding = await getOutstandingEffortService({
    clientKey: clientKey ?? null,
    projectKey: projectKey ?? null,
  });

  const personLabel = personId ? (personOptions.find((o) => o.value === personId)?.label ?? null) : null;

  const daysWorked = new Set(report.facts.map((fact) => fact.workDate)).size;

  return {
    scope: {
      period: period.label,
      from: period.from,
      to: period.to,
      viewer: "admin",
      person: personLabel,
      client: filters.client === "all" ? null : (clientOptions.find((o) => o.value === filters.client)?.label ?? null),
      project:
        filters.project === "all"
          ? null
          : (data.projectOptions.find((o) => o.value === filters.project)?.summary ?? filters.project),
      category: filters.category === "all" ? null : filters.category,
      billable: filters.billable === "all" ? null : filters.billable,
      notes,
    },
    totals: {
      hours: round(report.totals.hours),
      billableHours: round(report.split.billableHours),
      nonBillableHours: round(report.split.nonBillableHours),
      unsetHours: round(report.split.unsetHours),
      billableSharePercent: percent(report.split.billableRatio),
      entries: report.totals.worklogCount,
      daysWorked,
    },
    capacity: {
      contractedHours: round(overview.capacityHours),
      utilisationPercent: percent(overview.utilisation),
      billableTargetPercent: null,
    },
    money: revenue.configured
      ? {
          chargeableValue: formatMoney(revenue.chargeableValueCents),
          cost: formatMoney(revenue.costCents),
          margin: revenue.marginCents === null ? null : formatMoney(revenue.marginCents),
          marginPercent: percent(revenue.marginRatio),
          effectiveRatePerHour: formatMoney(revenue.effectiveRatePerLoggedHourCents),
        }
      : undefined,
    outstanding: outstandingFacts(outstanding),
    people: personId
      ? undefined
      : personOptions
          .filter((option) => option.value !== "all")
          .map((option) => ({
            name: option.label,
            hours: round(option.hours),
            billableSharePercent: null,
            utilisationPercent: null,
          })),
    clients: clientOptions
      .filter((option) => option.value !== "all")
      .map((option) => ({ name: option.label, hours: round(option.hours), projects: option.projectCount })),
    available: {
      people: personOptions.filter((o) => o.value !== "all").map((o) => o.label),
      clients: clientOptions.filter((o) => o.value !== "all").map((o) => o.label),
      projects: data.projectOptions
        .filter((o) => o.value !== "all")
        .map((o) => o.summary ?? o.label),
    },
  };
}

// -------------------------------------------------------------------
// Everybody else: their own time, and nothing about anybody else.
//
// Built from the repository and the engine directly rather than through the
// admin service, because that service guards on ADMIN and would redirect.
// Narrower on purpose - no clients, no budgets, no colleagues, no money.
// -------------------------------------------------------------------
async function ownFacts(request: TimesheetChatFactsRequest, userId: string): Promise<TimesheetChatFacts> {
  const notes: string[] = [];

  if (request.person) {
    notes.push("Only your own time is available to you, so the person asked about was ignored.");
  }

  const todayIso = todayInAppZone();
  const granularity: Granularity = isGranularity(request.granularity) ? request.granularity : "month";
  const period = resolvePeriod(
    granularity,
    request.start ?? todayIso,
    todayIso,
    envServer.TIMESHEET_HISTORY_START ?? envServer.JIRA_SYNC_START_DATE,
  );

  const row = await getUserByUserIdRepo(userId);
  const accountId = row?.atlassianAccountId ?? null;

  if (!accountId) {
    return {
      scope: {
        period: period.label,
        from: period.from,
        to: period.end,
        viewer: "self",
        person: null,
        client: null,
        project: null,
        category: null,
        billable: null,
        notes: [
          ...notes,
          "This account is not linked to a Jira user, so no timesheet figures can be found for it. An administrator has to link it.",
        ],
      },
      totals: {
        hours: 0,
        billableHours: 0,
        nonBillableHours: 0,
        unsetHours: 0,
        billableSharePercent: null,
        entries: 0,
        daysWorked: 0,
      },
      capacity: { contractedHours: null, utilisationPercent: null, billableTargetPercent: null },
    };
  }

  const factRows = await getWorklogFactsInRangeRepo(period.from, period.end);

  // Scoped to this person BEFORE the engine runs, so every roll-up and the
  // billable split describe one person's time and nothing is filtered out of
  // a finished total afterwards.
  const mine = factRows.filter((fact) => fact.personId === accountId);

  const report = buildReport({
    worklogs: mine.map((fact) => ({
      worklogId: fact.worklogId,
      issueKey: fact.issueKey,
      personId: fact.personId,
      personName: fact.personName,
      workDate: fact.workDate,
      startSecond: fact.startSecond,
      timeSpentSeconds: fact.timeSpentSeconds,
      narrative: fact.narrative,
    })),
    issues: [],
    today: todayIso,
    options: { workingHoursPerDay: envServer.WORKING_DAY_HOURS, periodStart: period.from, periodEnd: period.end },
  });

  const targets = await loadStaffTargets();
  const capacity = toStaffCapacity(targets.find((target) => target.personId === accountId) ?? null, accountId);
  const contracted = capacityHoursForRange(capacity, period.from, period.end);
  const measured = measureAgainstCapacity(capacity, contracted, report.totals.hours, report.split.billableHours);

  return {
    scope: {
      period: period.label,
      from: period.from,
      to: period.end,
      viewer: "self",
      person: row?.name ?? null,
      client: null,
      project: null,
      category: null,
      billable: null,
      notes,
    },
    totals: {
      hours: round(report.totals.hours),
      billableHours: round(report.split.billableHours),
      nonBillableHours: round(report.split.nonBillableHours),
      unsetHours: round(report.split.unsetHours),
      billableSharePercent: percent(report.split.billableRatio),
      entries: report.totals.worklogCount,
      daysWorked: new Set(mine.map((fact) => fact.workDate)).size,
    },
    capacity: {
      contractedHours: round(contracted),
      utilisationPercent: percent(measured.utilisation),
      billableTargetPercent: capacity.billableTargetPercent,
    },
  };
}

function formatMoney(cents: number | null): string {
  if (cents === null) return "not available";
  return `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// -------------------------------------------------------------------
// The outstanding block, and the note that has to travel with it.
//
// Everything else in this payload is about a period. This is not, and a model
// given "84.5" inside a result headed "September 2026" will report it as
// September's number unless the payload itself says otherwise. So the note is
// part of the data rather than left to the system prompt.
//
// workLeftHours is null rather than 0 when nothing is sized, because "no work
// left" and "nobody has estimated it" are opposite answers and a model handed
// 0 will give the first one.
// -------------------------------------------------------------------
function outstandingFacts(summary: OutstandingSummary): TimesheetChatFacts["outstanding"] {
  const sized = summary.estimatedCount + summary.coveredCount;

  const note =
    summary.openCount === 0
      ? "Nothing is open here; every item is in a finished status. This is a live figure, not a figure for the period above."
      : summary.estimatedCount === 0
        ? `Not known: none of the ${summary.openCount} open items carries an estimate, so there is no total to give. Say that rather than reporting zero. This is a live figure, not a figure for the period above.`
        : summary.committedSeconds > 0 &&
            Math.abs(summary.budgetRemainingSeconds - summary.remainingSeconds) > 3600
          ? `workLeftHours (${round(secondsToHours(summary.remainingSeconds))}) and budgetLeftHours (${round(secondsToHours(summary.budgetRemainingSeconds))}) DIFFER and both are correct: the first is what the open tasks are estimated at, the second is the commitment less everything spent, and finished work that came in under gives its time back. Say which one you are quoting.${summary.unestimatedCount > 0 ? ` Also a floor: ${summary.unestimatedCount} open items are unsized.` : ""} This is a live figure as at today, NOT a figure for the period above.`
        : summary.unestimatedCount > 0
          ? `A FLOOR, NOT A FORECAST: ${sized} of ${summary.openCount} open items are sized, so ${summary.unestimatedCount} more could add to this. Say so when you report it. This is a live figure as at today, NOT a figure for the period above.`
          : "Every open item is sized. This is a live figure as at today, NOT a figure for the period above.";

  return {
    workLeftHours: summary.estimatedCount > 0 ? round(secondsToHours(summary.remainingSeconds)) : null,
    budgetLeftHours:
      summary.committedSeconds > 0 ? round(secondsToHours(summary.budgetRemainingSeconds)) : null,
    committedHours: round(secondsToHours(summary.committedSeconds)),
    spentHours: round(secondsToHours(summary.spentSeconds)),
    overBudgetHours: round(secondsToHours(summary.overBudgetSeconds)),
    openItems: summary.openCount,
    sizedItems: sized,
    unsizedItems: summary.unestimatedCount,
    unsizedHoursLogged: round(secondsToHours(summary.unestimatedLoggedSeconds)),
    finishedItems: summary.completedCount,
    finishedEstimatedHours: round(secondsToHours(summary.completedEstimateSeconds)),
    finishedActualHours: round(secondsToHours(summary.completedLoggedSeconds)),
    note,
  };
}
