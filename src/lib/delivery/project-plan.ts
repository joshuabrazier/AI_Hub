// ===================================================================
// A WHOLE PROJECT, DESCRIBED IN NAMES, TURNED INTO SOMETHING THE APP CAN
// ACTUALLY CREATE
//
// "Here is a new project, 250 hours, one phase, these are the tasks, the
// client is Bowhill." A person can say that in a sentence. Every id it
// implies has to be resolved against real rows before anything is written,
// and the interesting work is what happens when one of them does not
// resolve.
//
// THE DANGEROUS FAILURE IS A PLAN THAT LOOKS RIGHT, not a plan that is
// refused. This is the same lesson as the timesheet ask box: Kysely
// parameterises everything, so an invented id was never injectable - it just
// produces a project attached to the wrong client, or twelve tasks assigned
// to nobody, and both of those read as success. So:
//
//   NAMES RESOLVE OR THEY ARE DROPPED AND NAMED. matchByName's ladder -
//   exact id, exact name, unique case-insensitive, unique prefix - and
//   anything ambiguous is a miss with every candidate reported.
//
//   A MISS DOWNGRADES, IT DOES NOT DESTROY. An assignee who cannot be
//   resolved leaves the task unassigned and says so, because refusing a
//   twelve-task plan over one misspelt name is worse than creating it and
//   pointing at the gap.
//
//   ANYTHING THAT CANNOT BE MADE SAFE IS A BLOCKER. No phases means nowhere
//   to put a task; two phases with one name means a board nobody can read.
//   Those stop the plan rather than degrading it.
//
// THE CLIENT IS THE ONE THAT BITES. Creating a project is allowed to create
// its client, which is genuinely convenient and is also how a library ends
// up holding "Bowhill" and "Bowhill Engineering" as separate clients with
// half the work under each. An exact name already reuses the existing row -
// resolveProjectClient does that - so what is left is the NEAR miss, and
// this reports it as loudly as it can without refusing the plan outright.
//
// PURE. It reads catalogues and returns a decision, so every rule above is
// testable without a database, a model or a session.
// ===================================================================

import { z } from "zod";

import { matchByName, type NameCandidate } from "@/lib/resolve-by-name";

// A name and an id, which is all this needs of a client, a person or
// anything else somebody might refer to by name.
export type PlanOption = NameCandidate;

// -------------------------------------------------------------------
// What a caller submits: names, never ids.
//
// DELIBERATELY NAMES ONLY. A caller that could pass an id could pass one it
// was never shown, and the whole safety argument here is that everything is
// resolved against a catalogue this app read for itself.
// -------------------------------------------------------------------
export type ProjectPlanDraft = {
  clientName: string;
  projectTitle: string;
  description?: string | null;
  isBillable?: boolean;
  // What the project was sold for. Compared against the sum of the task
  // estimates, and reported either way - it is not a limit anything here
  // enforces, because a plan that is over is a conversation rather than an
  // error.
  budgetHours?: number | null;
  phases: PlanPhaseDraft[];
  members?: PlanMemberDraft[];
};

export type PlanPhaseDraft = {
  name: string;
  tasks: PlanTaskDraft[];
};

export type PlanTaskDraft = {
  title: string;
  estimateHours: number;
  description?: string | null;
  assigneeName?: string | null;
};

export type PlanMemberDraft = {
  name: string;
  isLead?: boolean;
};

// -------------------------------------------------------------------
// What the app will do, once every name has been looked up.
// -------------------------------------------------------------------
export type ResolvedProjectPlan = {
  client: { mode: "existing"; clientId: string; name: string } | { mode: "new"; name: string };
  project: {
    title: string;
    description: string | null;
    isBillable: boolean;
  };
  phases: ResolvedPhase[];
  members: ResolvedMember[];
  totals: PlanTotals;
  // Things worth reading before saying yes. The plan still applies with
  // these on it.
  warnings: string[];
  // Things that stop it. The plan does not apply while any of these stand.
  blockers: string[];
};

export type ResolvedPhase = {
  name: string;
  tasks: ResolvedTask[];
};

export type ResolvedTask = {
  title: string;
  description: string | null;
  estimateHours: number;
  assigneeId: string | null;
  // Kept even when the id is null, so the review can say who was asked for
  // and not found.
  assigneeName: string | null;
};

export type ResolvedMember = {
  userId: string;
  name: string;
  isLead: boolean;
  // True when this person was not asked for by name and is here only because
  // a task was assigned to them. Surfaced because "who is on this project"
  // is a decision somebody should see being made for them.
  addedForAssignment: boolean;
};

export type PlanTotals = {
  phaseCount: number;
  taskCount: number;
  estimateHours: number;
  budgetHours: number | null;
  // Positive when the estimates exceed the budget. Null when no budget was
  // given, which is not the same as zero.
  overBudgetHours: number | null;
};

// A task estimate above this is almost certainly a misread - "250 hours" for
// the whole project arriving as one task's estimate is the exact shape of
// mistake a model makes with this input.
const IMPLAUSIBLE_TASK_HOURS = 200;

export function resolveProjectPlan(
  draft: ProjectPlanDraft,
  catalogue: { clients: readonly PlanOption[]; people: readonly PlanOption[] },
): ResolvedProjectPlan {
  const warnings: string[] = [];
  const blockers: string[] = [];

  const client = resolveClient(draft.clientName, catalogue.clients, warnings, blockers);
  const phases = resolvePhases(draft.phases, catalogue.people, warnings, blockers);
  const members = resolveMembers(draft.members ?? [], phases, catalogue.people, warnings);

  const title = draft.projectTitle.trim();
  if (!title) blockers.push("The project has no title.");

  const totals = totalsFor(phases, draft.budgetHours ?? null);

  if (totals.overBudgetHours !== null && totals.overBudgetHours > 0) {
    warnings.push(
      `The tasks add up to ${formatHours(totals.estimateHours)} against a budget of ` +
        `${formatHours(totals.budgetHours ?? 0)}, which is ${formatHours(totals.overBudgetHours)} over.`,
    );
  }

  return {
    client,
    project: {
      title,
      description: draft.description?.trim() || null,
      // Billable unless somebody says otherwise. That is the ordinary case,
      // and a project created non-billable by omission is money nobody
      // invoices.
      isBillable: draft.isBillable ?? true,
    },
    phases,
    members,
    totals,
    warnings,
    blockers,
  };
}

// -------------------------------------------------------------------
// The client, and the near miss.
//
// An exact name reuses the existing row, so the only way to end up with a
// duplicate is a name that ALMOST matches one. That is reported here rather
// than left for somebody to notice next quarter, because by then both
// clients have work under them and merging is a billing exercise.
// -------------------------------------------------------------------
function resolveClient(
  wanted: string,
  clients: readonly PlanOption[],
  warnings: string[],
  blockers: string[],
): ResolvedProjectPlan["client"] {
  const name = wanted.trim();

  if (!name) {
    blockers.push("No client was named.");
    return { mode: "new", name: "" };
  }

  const match = matchByName(name, clients);

  if (match.kind === "matched") {
    // MATCHED ON A PREFIX, NOT ON THE WHOLE NAME. "Bowhill" reaches "Bowhill
    // Engineering" through the unique-prefix rung of the ladder, which is
    // the outcome you want - it reuses the real client instead of making a
    // second one - but it is still the app choosing a client somebody did
    // not fully type. Said out loud, because attaching a project to the
    // wrong client is the failure this whole module is shaped around and a
    // silent widening is how it would happen.
    if (match.name.trim().toLowerCase() !== name.toLowerCase()) {
      warnings.push(`"${name}" was matched to the existing client "${match.name}".`);
    }

    return { mode: "existing", clientId: match.id, name: match.name };
  }

  // Ambiguous rather than absent, and a BLOCKER rather than a warning.
  // Everywhere else a miss downgrades, but there is no safe downgrade here:
  // creating a new client called "Perks" while "Perks" and "Perks
  // Accounting" both exist is the wrong-client outcome arriving by a
  // different door.
  if (match.kind === "ambiguous") {
    blockers.push(
      `"${name}" matches more than one client (${match.candidates.join(", ")}). ` +
        "Name it exactly.",
    );
    return { mode: "new", name };
  }

  const near = nearestClient(name, clients);

  if (near) {
    warnings.push(
      `No client is called "${name}", so a new one will be created - but "${near}" already exists. ` +
        "Check this is not the same client under a shorter name.",
    );
  }

  return { mode: "new", name };
}

// A name that contains, or is contained by, an existing one. Deliberately
// narrow: this is looking for "Bowhill" against "Bowhill Engineering", not
// for a fuzzy match, because a loose rule here would warn on every project.
function nearestClient(name: string, clients: readonly PlanOption[]): string | null {
  const wanted = name.trim().toLowerCase();

  if (wanted.length < 3) return null;

  const near = clients.find((client) => {
    const existing = client.name.trim().toLowerCase();

    return existing.startsWith(wanted) || wanted.startsWith(existing);
  });

  return near?.name ?? null;
}

function resolvePhases(
  drafts: readonly PlanPhaseDraft[],
  people: readonly PlanOption[],
  warnings: string[],
  blockers: string[],
): ResolvedPhase[] {
  if (drafts.length === 0) {
    blockers.push("The project has no phases, so there is nowhere to put a task.");
    return [];
  }

  const seen = new Set<string>();

  const phases = drafts.map((phase) => {
    const name = phase.name.trim();

    if (!name) blockers.push("A phase has no name.");

    const key = name.toLowerCase();
    if (seen.has(key)) {
      blockers.push(`Two phases are both called "${name}".`);
    }
    seen.add(key);

    return {
      name,
      tasks: phase.tasks.map((task) => resolveTask(task, name, people, warnings, blockers)),
    };
  });

  return phases;
}

function resolveTask(
  draft: PlanTaskDraft,
  phaseName: string,
  people: readonly PlanOption[],
  warnings: string[],
  blockers: string[],
): ResolvedTask {
  const title = draft.title.trim();

  if (!title) blockers.push(`A task in "${phaseName}" has no title.`);

  if (!Number.isFinite(draft.estimateHours) || draft.estimateHours < 0) {
    blockers.push(`"${title || "A task"}" has an estimate that is not a number of hours.`);
  } else if (draft.estimateHours > IMPLAUSIBLE_TASK_HOURS) {
    // A warning rather than a blocker: it is occasionally real, and refusing
    // it would be this module deciding how somebody runs a project. But the
    // whole project's budget arriving as one task's estimate is the commonest
    // way this input gets misread.
    warnings.push(
      `"${title}" is estimated at ${formatHours(draft.estimateHours)}, which is unusually large for one task. ` +
        "Check it is not the whole project's budget.",
    );
  }

  const wanted = draft.assigneeName?.trim();

  if (!wanted) {
    return {
      title,
      description: draft.description?.trim() || null,
      estimateHours: draft.estimateHours,
      assigneeId: null,
      assigneeName: null,
    };
  }

  const match = matchByName(wanted, people);

  // DROPPED AND NAMED, never guessed. The task is still created - refusing a
  // twelve-task plan over one misspelt name is worse than creating it and
  // pointing at the gap.
  if (match.kind === "ambiguous") {
    warnings.push(
      `"${wanted}" matches more than one person (${match.candidates.join(", ")}), ` +
        `so "${title}" was left unassigned.`,
    );
  } else if (match.kind === "none") {
    warnings.push(`Nobody here is called "${wanted}", so "${title}" was left unassigned.`);
  }

  return {
    title,
    description: draft.description?.trim() || null,
    estimateHours: draft.estimateHours,
    assigneeId: match.kind === "matched" ? match.id : null,
    assigneeName: wanted,
  };
}

// -------------------------------------------------------------------
// Who ends up on the project.
//
// ANYBODY WITH A TASK IS A MEMBER, whether they were listed or not. The
// service refuses an assignee who is not on the project - assigning work to
// somebody who cannot see it is a silent dead end - so a plan that assigns
// twelve tasks to three people and lists no members would otherwise fail at
// the last step, having already created the project.
//
// It is reported rather than done quietly: who is on a project decides who
// can edit its board, and that is not a detail to infer from a task list
// without saying so.
// -------------------------------------------------------------------
function resolveMembers(
  drafts: readonly PlanMemberDraft[],
  phases: readonly ResolvedPhase[],
  people: readonly PlanOption[],
  warnings: string[],
): ResolvedMember[] {
  const byId = new Map<string, ResolvedMember>();

  for (const draft of drafts) {
    const wanted = draft.name.trim();
    if (!wanted) continue;

    const match = matchByName(wanted, people);

    if (match.kind !== "matched") {
      warnings.push(
        match.kind === "ambiguous"
          ? `"${wanted}" matches more than one person (${match.candidates.join(", ")}), so they were not added.`
          : `Nobody here is called "${wanted}", so they were not added to the project.`,
      );
      continue;
    }

    byId.set(match.id, {
      userId: match.id,
      name: match.name,
      isLead: draft.isLead ?? false,
      addedForAssignment: false,
    });
  }

  for (const phase of phases) {
    for (const task of phase.tasks) {
      if (!task.assigneeId || byId.has(task.assigneeId)) continue;

      const match = people.find((person) => person.id === task.assigneeId);

      byId.set(task.assigneeId, {
        userId: task.assigneeId,
        name: match?.name ?? task.assigneeName ?? "Somebody",
        isLead: false,
        addedForAssignment: true,
      });
    }
  }

  const members = [...byId.values()];

  const inferred = members.filter((member) => member.addedForAssignment);

  if (inferred.length > 0) {
    warnings.push(
      `${listNames(inferred.map((member) => member.name))} ` +
        `${inferred.length === 1 ? "was" : "were"} added to the project because ` +
        `${inferred.length === 1 ? "a task is" : "tasks are"} assigned to ${inferred.length === 1 ? "them" : "them"}.`,
    );
  }

  // A LEAD IS NOT INVENTED. Picking one would be this module deciding who
  // runs the project, and the setup screen already treats a missing lead as
  // an unfinished step rather than an error.
  if (members.length > 0 && !members.some((member) => member.isLead)) {
    warnings.push("Nobody is marked as the lead, so only an admin will be able to edit the board.");
  }

  return members;
}

function totalsFor(phases: readonly ResolvedPhase[], budgetHours: number | null): PlanTotals {
  const tasks = phases.flatMap((phase) => phase.tasks);

  const estimateHours = tasks.reduce(
    (total, task) => total + (Number.isFinite(task.estimateHours) ? task.estimateHours : 0),
    0,
  );

  return {
    phaseCount: phases.length,
    taskCount: tasks.length,
    estimateHours,
    budgetHours,
    // Null rather than zero when nothing was budgeted: "not over" and "there
    // was no budget" are different answers and a reader should be able to
    // tell them apart.
    overBudgetHours: budgetHours === null ? null : Math.max(0, estimateHours - budgetHours),
  };
}

// One decimal, and no trailing ".0" on a whole number. An estimate reads as
// a quantity somebody chose, and "8.0 hours" reads as a machine.
function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;

  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ${rounded === 1 ? "hour" : "hours"}`;
}

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "Nobody";

  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// ===================================================================
// THE WIRE SHAPE
//
// What an outside caller may send. Kept beside the draft type it validates,
// because a schema in another file is a schema that drifts from the shape it
// claims to check.
//
// NAMES ONLY, and every bound is here rather than trusted. This is reached
// by a bearer token from outside the app, so the request is the boundary:
// a thousand tasks, a title the length of a book, or an estimate of
// Infinity all have to be refused by the parse rather than by whatever they
// eventually hit.
// ===================================================================

// Generous for a real project and far short of anything that would matter.
// A plan is typed or dictated by a person; the limits exist so a malformed
// or runaway caller is refused at the door rather than deep inside a
// transaction.
const MAX_PHASES = 20;
const MAX_TASKS_PER_PHASE = 200;
const MAX_MEMBERS = 50;

const planName = z.string().trim().min(1).max(200);

export const ProjectPlanDraftSchema = z.object({
  clientName: planName,
  projectTitle: planName,
  description: z.string().trim().max(5_000).nullish(),
  isBillable: z.boolean().optional(),
  // Finite and non-negative. NaN and Infinity both pass a bare number check
  // and both would poison every total downstream.
  budgetHours: z.number().finite().nonnegative().nullish(),
  phases: z
    .array(
      z.object({
        name: planName,
        tasks: z
          .array(
            z.object({
              title: planName,
              description: z.string().trim().max(5_000).nullish(),
              estimateHours: z.number().finite().nonnegative(),
              assigneeName: z.string().trim().max(200).nullish(),
            }),
          )
          .max(MAX_TASKS_PER_PHASE),
      }),
    )
    .max(MAX_PHASES),
  members: z
    .array(z.object({ name: planName, isLead: z.boolean().optional() }))
    .max(MAX_MEMBERS)
    .optional(),
});
