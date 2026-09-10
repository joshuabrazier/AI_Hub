import "server-only";

import { generateId } from "better-auth";

import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import { database, runInTransaction } from "@/lib/data/kysely-database-client";
import {
  AI_CHAT_REQUEST_KINDS,
  PROJECT_STATUSES,
  RATE_BANDS,
  TASK_COLUMNS,
  USER_ROLES,
  type UserRole,
} from "@/lib/data/kysely-database-types";
import {
  addClientRepo,
  getClientByNameRepo,
  getClientsRepo,
} from "@/lib/data/repositories/clients.repository";
import { addPhaseRepo } from "@/lib/data/repositories/phases.repository";
import { addProjectRepo, setProjectMembersRepo } from "@/lib/data/repositories/projects.repository";
import { addTaskRepo } from "@/lib/data/repositories/tasks.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { isBedrockConfigured } from "@/lib/ai/bedrock-client";
import { converseCeilingFor, converseText } from "@/lib/ai/converse";
import {
  ProjectPlanDraftSchema,
  resolveProjectPlan,
  type ProjectPlanDraft,
  type ResolvedProjectPlan,
} from "@/lib/delivery/project-plan";
import {
  buildProjectPlanPrompt,
  MAX_BRIEF_CHARS,
  PROJECT_PLAN_SYSTEM_PROMPT,
} from "@/lib/delivery/project-plan.prompt";

// ===================================================================
// APPLY A RESOLVED PLAN: ONE TRANSACTION, OR NOTHING
//
// A project, its client, its phases, its tasks and its members, written in
// one go. Every repository here takes a `db`, so all of it joins a single
// transaction and a failure at the last task leaves no project behind.
//
// A HALF-CREATED PROJECT IS WORSE THAN NONE, which is the whole reason this
// is not a loop over the existing services. Those each open their own write
// and each resolve their own actor from a session; calling them in sequence
// would leave a project with four of its twelve tasks and no way to tell
// whether the rest were meant to exist. Somebody would then finish it by
// hand and never be sure what was missing.
//
// IT TAKES AN ACTOR RATHER THAN READING A SESSION, and that is what makes it
// reachable from outside a browser. The same arrangement as
// sweepAllTranscriptionsService, for the same reason: a caller with no
// cookie still has to be somebody, because createdBy and the audit trail are
// not optional. Every caller is responsible for proving who that is - a
// server action does it with requireUserRole, and a token route does it by
// verifying the token - and the role is re-checked HERE regardless, because
// a service that trusts its caller to have checked is a service that gets
// called by the one that forgot.
//
// IT DOES NOT RESOLVE NAMES. resolveProjectPlan did that, against catalogues
// this app read for itself, and it refuses anything ambiguous. What arrives
// here is ids, and the only name left in the plan is a client that is about
// to be created.
// ===================================================================

export type AppliedProjectPlan = {
  projectId: string;
  clientId: string;
  clientCreated: boolean;
  phaseCount: number;
  taskCount: number;
  memberCount: number;
};

export async function applyProjectPlanService(
  plan: ResolvedProjectPlan,
  actor: { id: string; role: UserRole },
): Promise<AppliedProjectPlan> {
  try {
    // RE-CHECKED HERE, not taken on trust. Creating a project is an admin
    // act everywhere else in this module, and this is the one path that can
    // be reached without a browser session - so it is the last place the
    // rule can be enforced and the first place it would be missed.
    if (actor.role !== USER_ROLES.ADMIN) {
      throw new DisplayErrorMessage("Only an administrator can create a project.");
    }

    // A plan that still carries a blocker was never applicable. The caller
    // should not have got this far, and saying so beats writing half of a
    // plan somebody was told was not ready.
    if (plan.blockers.length > 0) {
      throw new DisplayErrorMessage(
        `This plan cannot be applied yet: ${plan.blockers.join(" ")}`,
      );
    }

    const applied = await runInTransaction(database, async (trx) => {
      const now = new Date();

      // ---------------------------------------------------------------
      // The client. An exact name reuses the existing row rather than
      // failing on the unique index - "Perks already exists" is not an
      // error from the point of view of somebody who just wants the project
      // made, and the resolver has already warned if this looked like a
      // near miss.
      // ---------------------------------------------------------------
      let clientId: string;
      let clientCreated = false;

      if (plan.client.mode === "existing") {
        clientId = plan.client.clientId;
      } else {
        const existing = await getClientByNameRepo(plan.client.name, trx);

        if (existing) {
          clientId = existing.id;
        } else {
          const created = await addClientRepo(
            {
              id: generateId(),
              name: plan.client.name,
              notes: null,
              isActive: true,
              createdBy: actor.id,
              createdAt: now,
              updatedAt: now,
            },
            trx,
          );

          clientId = created.id;
          clientCreated = true;
        }
      }

      const project = await addProjectRepo(
        {
          id: generateId(),
          clientId,
          title: plan.project.title,
          description: plan.project.description,
          isBillable: plan.project.isBillable,
          // Stated rather than left to the column default, matching
          // createProjectService: the schema offers no choice precisely so
          // nobody can create an archived project.
          status: PROJECT_STATUSES.ACTIVE,
          // Nobody has finished planning yet, so the board's setup nudge
          // shows. Stamped once, later, by markProjectBudgetAssignedService.
          budgetAssignedAt: null,
          createdBy: actor.id,
          createdAt: now,
          updatedAt: now,
        },
        trx,
      );

      // ---------------------------------------------------------------
      // MEMBERS BEFORE TASKS, and the order is load-bearing. A task carries
      // an assignee, and assigning work to somebody who is not on the
      // project is a silent dead end the board would never show them. The
      // resolver has already put everybody with a task into this list.
      // ---------------------------------------------------------------
      if (plan.members.length > 0) {
        await setProjectMembersRepo(
          project.id,
          plan.members.map((member) => ({
            userId: member.userId,
            isLead: member.isLead,
            // The band nobody chose. A plan describes work, not pay, and
            // guessing somebody's band from a sentence is not a thing this
            // should do - the rates screen is where that belongs.
            rateBand: RATE_BANDS.STANDARD,
          })),
          trx,
        );
      }

      let taskCount = 0;

      for (const phase of plan.phases) {
        const created = await addPhaseRepo(
          {
            id: generateId(),
            projectId: project.id,
            name: phase.name,
            createdAt: now,
            updatedAt: now,
          },
          trx,
        );

        for (const [index, task] of phase.tasks.entries()) {
          await addTaskRepo(
            {
              id: generateId(),
              phaseId: created.id,
              projectId: project.id,
              title: task.title,
              description: task.description,
              // MINUTES. The plan speaks in hours because a person does;
              // the column counts minutes, and this is the single place the
              // conversion happens on this path.
              estimateMinutes: Math.round(task.estimateHours * 60),
              // Everything starts in the first column. A plan describes work
              // to be done, and a card that arrived already in progress
              // would be a claim nobody made.
              boardColumn: TASK_COLUMNS.TODO,
              // The project is new, so the column is empty and the index IS
              // the position. Appending by reading siblings would be a query
              // per task to compute a number this loop already knows.
              position: index,
              assigneeId: task.assigneeId,
              createdBy: actor.id,
              createdAt: now,
              updatedAt: now,
            },
            trx,
          );

          taskCount += 1;
        }
      }

      return {
        projectId: project.id,
        clientId,
        clientCreated,
        phaseCount: plan.phases.length,
        taskCount,
        memberCount: plan.members.length,
      };
    });

    // ---------------------------------------------------------------
    // AFTER THE TRANSACTION, deliberately. An audit entry for a project that
    // rolled back would be a record of something that never happened, which
    // is worse than a missing one - and the audit log has its own failure
    // handling that must not take the write down with it.
    //
    // The counts are here because "created a project" understates what this
    // did. Twelve tasks and three people arrived in one act, and the trail
    // should say so.
    // ---------------------------------------------------------------
    await recordAuditEvent({
      action: AUDIT_ACTIONS.PROJECT_CREATED,
      entityType: AUDIT_ENTITY_TYPES.PROJECT,
      entityId: applied.projectId,
      summary: `Created project ${plan.project.title} from a plan`,
      metadata: {
        clientId: applied.clientId,
        clientCreated: applied.clientCreated,
        phaseCount: applied.phaseCount,
        taskCount: applied.taskCount,
        memberCount: applied.memberCount,
        isBillable: plan.project.isBillable,
      },
    });

    return applied;
  } catch (error) {
    throw handleError("applyProjectPlanService", error);
  }
}

// ===================================================================
// READ THE CATALOGUES AND RESOLVE. WRITE NOTHING.
//
// The half an outside caller runs first: it turns a plan described in names
// into one described in ids, against the clients and accounts this app
// actually has, and hands back what it would do.
//
// THE CATALOGUES ARE READ HERE AND NOWHERE ELSE, which is what makes the
// resolver's guarantee true. A caller cannot supply the list its own names
// are checked against, so it cannot widen what a name is allowed to match.
//
// INACTIVE ROWS ARE LEFT OUT, both of them for the same reason: offering a
// retired client or a deactivated account means a plan can name something
// somebody deliberately took out of circulation, and the write would then
// either fail or succeed and be wrong.
// ===================================================================
export async function planProjectService(
  draft: ProjectPlanDraft,
  actor: { id: string; role: UserRole },
): Promise<ResolvedProjectPlan> {
  try {
    if (actor.role !== USER_ROLES.ADMIN) {
      throw new DisplayErrorMessage("Only an administrator can create a project.");
    }

    const [clients, people] = await Promise.all([
      getClientsRepo({ includeInactive: false }),
      getActiveAssignableUsersRepo(),
    ]);

    return resolveProjectPlan(draft, {
      clients: clients.map((client) => ({ id: client.id, name: client.name })),
      people: people.map((person) => ({ id: person.id, name: person.name })),
    });
  } catch (error) {
    throw handleError("planProjectService", error);
  }
}

// -------------------------------------------------------------------
// Who a plan may name.
//
// ACTIVE ACCOUNTS ONLY, and accounts rather than invitations: a pending
// invitation's id is an invitation, not a user, and assigning a task to one
// would post an id that resolves to nobody. The same filter the setup screen
// applies to its member picker, for the same reason.
// -------------------------------------------------------------------
async function getActiveAssignableUsersRepo(): Promise<{ id: string; name: string }[]> {
  const rows = await database
    .selectFrom("users")
    .select(["id", "name"])
    .where("isActive", "=", true)
    .orderBy("name")
    .execute();

  // A de-identified account keeps its row and loses its name. It cannot be
  // named in a plan, which is correct - there is nothing to name it by.
  return rows.flatMap((row) => (row.name ? [{ id: row.id, name: row.name }] : []));
}

// ===================================================================
// READ A PASTED BRIEF INTO A PLAN
//
// The model's half of "Create with AI". Somebody pastes a scope of work, a
// quote, an email or three lines they typed, and this hands back a plan they
// can look at. It writes nothing.
//
// TWO STEPS, AND THE SECOND DOES NOT TRUST THE FIRST. The model turns prose
// into names; resolveProjectPlan turns names into ids against catalogues
// this app read for itself. So a model that invents a client, names a person
// who left, or answers with something that is not a plan at all cannot get
// past the second step - the worst it can do is produce a draft that is
// reported as wrong, which is the outcome a person is here to catch.
//
// A MALFORMED REPLY IS A FAILURE, NOT SOMETHING TO SALVAGE. Guessing at a
// half-parsed plan is how somebody ends up reviewing three tasks when the
// brief described twelve, and approving it because three looked plausible.
// ===================================================================
export async function draftProjectPlanService(
  brief: string,
  actor: { id: string; role: UserRole },
): Promise<ResolvedProjectPlan> {
  try {
    if (actor.role !== USER_ROLES.ADMIN) {
      throw new DisplayErrorMessage("Only an administrator can create a project.");
    }

    const trimmed = brief.trim();

    if (!trimmed) {
      throw new DisplayErrorMessage("Paste the project details first.");
    }

    if (trimmed.length > MAX_BRIEF_CHARS) {
      throw new DisplayErrorMessage(
        `That brief is ${trimmed.length.toLocaleString()} characters, and ${MAX_BRIEF_CHARS.toLocaleString()} is the most this can read at once. Trim it to the scope and the tasks.`,
      );
    }

    if (!isBedrockConfigured()) {
      throw new DisplayErrorMessage("AI is not configured on this environment.");
    }

    const [clients, people] = await Promise.all([
      getClientsRepo({ includeInactive: false }),
      getActiveAssignableUsersRepo(),
    ]);

    const catalogue = {
      clients: clients.map((client) => ({ id: client.id, name: client.name })),
      people: people.map((person) => ({ id: person.id, name: person.name })),
    };

    const prompt = buildProjectPlanPrompt({ brief: trimmed, ...catalogue });

    const result = await converseText({
      userId: actor.id,
      kind: AI_CHAT_REQUEST_KINDS.PROJECT_PLAN,
      system: PROJECT_PLAN_SYSTEM_PROMPT,
      prompt: prompt.text,
      maxTokens: PROJECT_PLAN_MAX_TOKENS,
      timeoutMs: converseCeilingFor(PROJECT_PLAN_MAX_TOKENS),
    });

    const parsed = ProjectPlanDraftSchema.safeParse(parsePlanReply(result.text));

    if (!parsed.success) {
      throw new DisplayErrorMessage(
        "The brief could not be read into a plan. Try again, or say the client, the phases and the tasks more plainly.",
      );
    }

    const plan = resolveProjectPlan(parsed.data, catalogue);

    // Truncation is reported alongside the resolver's own warnings rather
    // than swallowed. A model that could not use a real name because it was
    // never shown one looks exactly like one that ignored the list.
    if (prompt.truncated) {
      plan.warnings.push(
        "There are more clients or people than could be shown to the model at once, so it may not have used a name that exists. Check the client and the assignees.",
      );
    }

    return plan;
  } catch (error) {
    throw handleError("draftProjectPlanService", error);
  }
}

// A plan for a real project, with room for a description on every task.
// Larger than the filing decision's 300 by an order of magnitude, because
// this is the reply rather than a choice from a list.
const PROJECT_PLAN_MAX_TOKENS = 8_000;

// -------------------------------------------------------------------
// Tolerant of a fence and of a sentence either side of the object, and of
// nothing else. The same parser as the timesheet ask box and the filing
// decision, for the same reason: a reply less structured than an object with
// braces round it is a genuine failure rather than something to rescue.
// -------------------------------------------------------------------
function parsePlanReply(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();

  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace <= firstBrace) return null;

  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}
