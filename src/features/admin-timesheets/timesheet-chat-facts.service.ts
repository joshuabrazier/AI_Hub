import "server-only";

import { requireUser } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { getUserByUserIdRepo } from "@/lib/data/repositories/users.repository";
import { getWorklogFactsInRangeRepo } from "@/lib/data/repositories/timesheet.repository";
import { envServer } from "@/lib/env-server";
import { handleError } from "@/lib/handle-errors";
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
  people?: { name: string; hours: number; billableSharePercent: number | null; utilisationPercent: number | null }[];
  clients?: { name: string; hours: number; projects: number }[];
  // The vocabulary that WAS available, so a name the model got wrong can be
  // corrected on its next call rather than guessed at.
  available?: { people: string[]; clients: string[] };
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
  kind: "person" | "client",
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

  const scopeRequest = {
    granularity: request.granularity,
    start: request.start,
    category: request.category,
    client: clientKey,
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
