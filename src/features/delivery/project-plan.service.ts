import "server-only";

import { generateId } from "better-auth";

import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import { database, runInTransaction } from "@/lib/data/kysely-database-client";
import {
  PROJECT_STATUSES,
  RATE_BANDS,
  TASK_COLUMNS,
  USER_ROLES,
  type UserRole,
} from "@/lib/data/kysely-database-types";
import { addClientRepo, getClientByNameRepo } from "@/lib/data/repositories/clients.repository";
import { addPhaseRepo } from "@/lib/data/repositories/phases.repository";
import { addProjectRepo, setProjectMembersRepo } from "@/lib/data/repositories/projects.repository";
import { addTaskRepo } from "@/lib/data/repositories/tasks.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { type ResolvedProjectPlan } from "@/lib/delivery/project-plan";

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
