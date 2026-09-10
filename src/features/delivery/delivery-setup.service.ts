import "server-only";

import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { diffFields } from "@/lib/audit/audit-diff";
import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import type { SessionUser } from "@/lib/auth/auth.types";
import { requireUser, requireUserRole } from "@/lib/auth/session-auth-server";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  RATE_BAND_LABELS,
  USER_ROLES,
  type Client,
  type Phase,
  type ProjectBudgetGroup,
  type User,
} from "@/lib/data/kysely-database-types";
import {
  addClientRepo,
  countProjectsForClientRepo,
  getClientByIdRepo,
  getClientByNameRepo,
  getClientsRepo,
  updateClientByIdRepo,
  type ClientListItem,
} from "@/lib/data/repositories/clients.repository";
import {
  addPhaseRepo,
  deletePhaseRepo,
  getPhaseRepo,
  getPhaseTimeLoggedRepo,
  getPhasesForProjectRepo,
  renamePhaseRepo,
  reorderPhasesForProjectRepo,
  type PhaseTimeLogged,
} from "@/lib/data/repositories/phases.repository";
import {
  addProjectBudgetGroupRepo,
  addProjectMemberRepo,
  addProjectRepo,
  deleteProjectBudgetGroupRepo,
  getProjectBudgetGroupRepo,
  getProjectBudgetGroupsRepo,
  getAllProjectsRepo,
  getProjectByIdRepo,
  getProjectForMemberRepo,
  getProjectMembersRepo,
  getProjectsForUserRepo,
  markProjectBudgetAssignedRepo,
  removeProjectMemberRepo,
  setProjectBudgetGroupMembersRepo,
  setProjectMembersRepo,
  updateProjectBudgetGroupRepo,
  updateProjectMemberRepo,
  updateProjectRepo,
  type ProjectMemberWithUser,
  type ProjectWithClient,
  type UserProjectMembership,
} from "@/lib/data/repositories/projects.repository";
import {
  getAttachmentCountsForProjectRepo,
  getPhaseEstimateMinutesRepo,
  getProjectBoardTasksRepo,
  getProjectEstimateMinutesRepo,
  type TaskAttachmentCount,
} from "@/lib/data/repositories/tasks.repository";
import {
  getLoggedMinutesByPhaseRepo,
  getLoggedMinutesByProjectRepo,
  getLoggedMinutesByUserForProjectRepo,
} from "@/lib/data/repositories/time-entries.repository";
import { getUsersByIdsRepo } from "@/lib/data/repositories/users.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { userDisplayName } from "@/lib/user-display-name";

import {
  budgetProgress,
  canEditProjectTasks,
  formatMinutesAsClock,
  type AddProjectMemberRequest,
  type ArchiveProjectRequest,
  type BudgetGroupReportDTO,
  type ClientDetailDTO,
  type ClientOptionDTO,
  type ClientSummaryDTO,
  type CreateBudgetGroupRequestDTO,
  type CreateClientRequestDTO,
  type CreatePhaseRequestDTO,
  type CreateProjectRequestDTO,
  type DeactivateClientRequest,
  type DeleteBudgetGroupRequestDTO,
  type DeletePhaseRequestDTO,
  type MarkProjectBudgetAssignedRequestDTO,
  type PhaseDTO,
  type ProjectClientRequestDTO,
  type ProjectDetailDTO,
  type ProjectMemberDTO,
  type ProjectSummaryDTO,
  type RemoveProjectMemberRequest,
  type RenamePhaseRequestDTO,
  type ReorderPhasesRequestDTO,
  type SetBudgetGroupMembersRequestDTO,
  type SetProjectMembersRequestDTO,
  type UpdateBudgetGroupRequestDTO,
  type UpdateClientRequestDTO,
  type UpdateProjectMemberRequest,
  type UpdateProjectRequestDTO,
} from "./delivery.types";

// -------------------------------------------------------------------
// ===================================================================
// DELIVERY SETUP: the admin side
// ===================================================================
//
// Clients, projects, who is on them, their pooled budget groups and their
// phases. Everything a project needs to exist before anybody can log an
// hour against it.
//
// THE ACCESS MODEL, in full, because getting it wrong here is not a bug in
// a screen - it is one client's rates and margin visible to another
// client's team.
//
//   THE ACTOR COMES FROM THE SESSION, ALWAYS. Every function below opens
//   with requireUser or requireUserRole and uses THAT id. No id in a
//   request DTO is proof of anything: a projectId is a lookup key, and a
//   userId in a member payload is a subject, never a caller.
//
//   `project_members` IS THE BOUNDARY. A non-admin sees a project only
//   because a membership row says so, and `getProjectForMemberRepo` is the
//   read that answers it - one call that both authorises and hands back
//   `isLead` and `rateBand`, so nothing has to ask twice.
//
//   ADMIN SEES AND DOES EVERYTHING. Creating and changing clients,
//   projects, membership and budget groups is admin-only, so most of this
//   file guards on requireUserRole([ADMIN]) and then has no scope filter at
//   all. That is the role check's decision, not an omission.
//
//   `is_lead` IS THE SECOND GATE, and in this file it governs the PHASES
//   only. A lead who may create a task but not the heading to put it under
//   is a strange half-power, and phases are board furniture rather than an
//   access or billing decision - which is why the admin-only list above
//   names clients, projects, members and budget groups, and does not name
//   phases. Tasks and estimates are the other side of that gate and live in
//   their own service.
//
//   A SCOPE FAILURE ANSWERS notFound(). Replying "forbidden" to a guessed
//   project id confirms the project exists and turns the route into an
//   enumeration oracle. A ROLE failure may say so plainly, which is what
//   requireUserRole's redirect does.
//
//   AN EMPTY SCOPE IS NOTHING, NOT EVERYTHING. Somebody on no projects sees
//   no projects; the nav read below is keyed on their own memberships and
//   returns an empty list rather than widening.
//
//   MONEY IS ABSENT, NOT NULL, for anybody who may not see it - and in this
//   file it is absent from everything. Nothing here computes a rate: the
//   setup screens deal in minutes, and cents belong to the budget report,
//   which resolves them under its own guard. See the note on
//   BudgetReportDTO in delivery.types.ts for why absence and null are not
//   interchangeable.
//
//   AN ARCHIVED PROJECT TAKES NEITHER NUMBERS NOR STRUCTURE. The time
//   service already refuses logging time, adding a timesheet row and
//   adjusting an estimate on one; requireProjectStructureAccess refuses the
//   phase mutations for the same reason, and the sentence is deliberately
//   the same sentence. Archiving is this module's soft delete, so building
//   a phase on an archived project produces a heading on a board nobody can
//   log an hour against - work that reads as progress and is not. The
//   argument the other way was considered and lost: "let somebody tidy a
//   dead end" only pays off if tidying can be done in place, and it cannot,
//   because renaming and reordering are the tidy-up acts and deleting a
//   phase is refused anyway the moment there is time under it. Restoring
//   the project is one admin act, it is audited, and it makes every one of
//   these writes available again. That is the way back, rather than a
//   quietly editable soft-deleted project.
//
//   UPDATING OR ARCHIVING THE PROJECT ITSELF IS NOT COVERED BY THAT, and
//   must not be: updateProjectService is how an archived project is made
//   active again, so refusing it would make archiving irreversible.
//
// TIME IS INTEGER MINUTES and money is integer cents. The Zod schemas
// convert hours to minutes at the boundary, so every `*Hours` field on a
// REQUEST DTO reaching this file already holds MINUTES. It keeps the
// form's name so the two sides of one field are recognisably the same
// field; read it as minutes and never multiply it again.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Projects are mounted in all three areas, because the nav is "my
// projects" and any signed-in person can be on one - so a write has to
// refresh all three. Which area the caller is looking at is not knowable
// here, and the same project's page is reachable from each of them.
//
// "layout" rather than the default "page", so a write also refreshes the
// project pages NESTED under each root. A plain revalidatePath on the root
// would leave a project's own screen serving the figures it held before
// the phase somebody just deleted.
// -------------------------------------------------------------------
function revalidateProjectViews(): void {
  revalidatePath(ROUTES.ADMIN_PROJECTS, "layout");
  revalidatePath(ROUTES.MANAGE_PROJECTS, "layout");
  revalidatePath(ROUTES.PORTAL_PROJECTS, "layout");
}

// Clients are admin-only, so unlike projects there is one screen to
// refresh. A client rename also changes what every project list shows, so
// this is called ALONGSIDE the project views rather than instead of them.
function revalidateClientViews(): void {
  revalidatePath(ROUTES.ADMIN_CLIENTS, "layout");
}

// -------------------------------------------------------------------
// THE REQUEST SHAPES AND THE SECOND GATE BOTH LIVE IN delivery.types.ts.
//
// The five single-act shapes this file used to declare as placeholders -
// adding, changing and removing ONE project member, archiving a project,
// retiring a client - now have Zod schemas beside every other schema in
// the module, so they are validated at an action's boundary like anything
// else and this file simply imports the output types. They kept their
// names on the way, which is why nothing below reads as renamed.
//
// canEditProjectTasks moved for a different reason: the board and time
// services need the same answer, and three implementations of one
// authorization decision is how a screen ends up offering a member a
// button the server refuses.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// What a caller may do on one project, resolved once.
// -------------------------------------------------------------------
type ProjectAccess = {
  user: SessionUser;
  project: ProjectWithClient;
  isAdmin: boolean;
  isLead: boolean;
  canEditTasks: boolean;
};

// -------------------------------------------------------------------
// Resolve a project the caller may READ, or answer notFound().
//
// The two branches are different reads on purpose. An admin's scope is
// every project, so theirs is the unscoped read; everybody else goes
// through the membership join, which returns undefined for a project they
// are not on - the same answer an id that never existed gets.
//
// notFound() rather than a message, for the enumeration reason in the
// header. It escapes this function's caller through handleError, which
// calls unstable_rethrow, so it must never be wrapped in a plain catch.
//
// `sessionUser` IS AN ALREADY-RESOLVED SESSION, NEVER A CALLER-SUPPLIED
// ONE. The only thing that passes it is requirePhaseForStructure, which
// has to resolve the session BEFORE it reads the phase (a phase id off the
// browser must not buy an anonymous caller a query) and would otherwise
// pay for the session twice. It is optional rather than required because
// every other caller here has no session in hand, and a parameter they had
// to fill would tempt somebody into filling it from a request - which is
// why nothing exported takes one.
// -------------------------------------------------------------------
async function requireProjectAccess(projectId: string, sessionUser?: SessionUser): Promise<ProjectAccess> {
  const user = sessionUser ?? (await requireUser());

  if (user.role === USER_ROLES.ADMIN) {
    const project = await getProjectByIdRepo(projectId);

    if (!project) notFound();

    // An admin can be a member as well, and the nav says so, but their
    // editing rights do not come from it - so this does not pay for the
    // membership read.
    return {
      user,
      project,
      isAdmin: true,
      isLead: false,
      canEditTasks: canEditProjectTasks(user.role, false),
    };
  }

  const scoped = await getProjectForMemberRepo(projectId, user.id);

  if (!scoped) notFound();

  return {
    user,
    project: scoped,
    isAdmin: false,
    isLead: scoped.isLead,
    canEditTasks: canEditProjectTasks(user.role, scoped.isLead),
  };
}

// -------------------------------------------------------------------
// Resolve a project for an ADMIN-ONLY write.
//
// The role check comes first, so a member reaching one of these is told
// plainly that they may not - a role failure carries no information about
// what exists. The project itself is then a lookup, and a missing one is a
// sentence rather than notFound(): an admin's scope is every project, so
// there is nothing to enumerate, and the honest answer to a stale form is
// that the project is gone.
// -------------------------------------------------------------------
async function requireAdminProject(projectId: string): Promise<{ user: SessionUser; project: ProjectWithClient }> {
  const user = await requireUserRole([USER_ROLES.ADMIN]);

  const project = await getProjectByIdRepo(projectId);

  if (!project) {
    throw new DisplayErrorMessage("That project no longer exists.");
  }

  return { user, project };
}

// -------------------------------------------------------------------
// Resolve a project for a write only an ADMIN OR ITS LEAD may make - the
// phase mutations, and nothing else in this file.
//
// A non-member gets notFound() from requireProjectAccess, so this only has
// to refuse the ordinary member who IS on the project. That is a scope
// failure about a project they can already see, so it says so: they know
// it exists, and "ask a lead" is advice they can act on.
//
// AND IT IS ALSO WHERE AN ARCHIVED PROJECT IS REFUSED, for the reason in
// the header: archiving is the soft delete, and a phase built on an
// archived project is a heading on a board nobody can log an hour against.
// One gate rather than four checks, because all four phase mutations pass
// through here and a fifth added later should inherit the rule rather than
// have to remember it - which is why `act` is required and not optional.
//
// THE SENTENCE IS DELIBERATELY THE TIME SERVICE'S SENTENCE, word for word
// (see requireUnarchivedProject there): somebody who has met it once while
// logging time should recognise it, and "an administrator can make it
// active again" is the same advice either way. Two copies of one sentence
// in two services is worth watching - if a third appears, it belongs in
// delivery.types.ts beside the other shared rules rather than in a fourth.
//
// The role and lead check comes FIRST. A member who may not touch phases
// gets the same answer whatever the project's status, and the status is not
// the thing standing in their way.
// -------------------------------------------------------------------
async function requireProjectStructureAccess(
  projectId: string,
  act: string,
  sessionUser?: SessionUser,
): Promise<ProjectAccess> {
  const access = await requireProjectAccess(projectId, sessionUser);

  if (!access.canEditTasks) {
    throw new DisplayErrorMessage("Only a project lead or an administrator can change a project's phases.");
  }

  if (access.project.status === PROJECT_STATUSES.ARCHIVED) {
    throw new DisplayErrorMessage(
      `This project has been archived, so ${act} is no longer possible. An administrator can make it active again first.`,
    );
  }

  return access;
}

// -------------------------------------------------------------------
// Accounts an admin may put on a project.
//
// The same rule teams use: active, and still identifiable. A de-identified
// account's personal data is gone, so placing it inside this module's
// security boundary would put an unreadable row where a person should be -
// and it would appear on a board as an assignee nobody can contact.
// -------------------------------------------------------------------
function isAssignable(user: User): boolean {
  return user.isActive && user.deidentifiedAt === null;
}

// The name to show comes from `userDisplayName` in src/lib, which is the
// one copy of that rule for the whole app. This file used to carry its own
// - identical, and identical is exactly the problem: the symptom of the
// four copies that existed before it was one panel calling the same person
// "Ada" in its members list and "Adelaide Lovelace" against her time
// entries.
//
// Every caller here passes a row whose `name` is NOT NULL, so the overload
// that returns a plain `string` is the one that applies and nothing below
// has to handle a null name.

// -------------------------------------------------------------------
// Mapping
//
// Local rather than in a shared mappers module, because every shape below
// is assembled from figures this service computes - a phase's counts, a
// project's rollup. If a second delivery service ever needs one of them,
// lift it to delivery.mappers.ts rather than copying it.
// -------------------------------------------------------------------

function mapClientSummary(client: ClientListItem): ClientSummaryDTO {
  return {
    id: client.id,
    name: client.name,
    isActive: client.isActive,
    projectCount: client.projectCount,
  };
}

// `canEditTasks` is passed in rather than derived here: the nav read knows
// the caller's own `isLead`, and the role is what overrides it.
function mapProjectSummary(
  project: Pick<UserProjectMembership, "id" | "title" | "clientId" | "clientName" | "status" | "isBillable">,
  canEditTasks: boolean,
): ProjectSummaryDTO {
  return {
    id: project.id,
    title: project.title,
    clientId: project.clientId,
    clientName: project.clientName,
    status: project.status,
    isBillable: project.isBillable,
    canEditTasks,
  };
}

function mapProjectMember(member: ProjectMemberWithUser): ProjectMemberDTO {
  return {
    userId: member.userId,
    name: userDisplayName(member),
    email: member.email,
    isLead: member.isLead,
    // The BAND, never a rate. Naming which of three tiers applies tells a
    // member nothing about what the client pays.
    rateBand: member.rateBand,
  };
}

// -------------------------------------------------------------------
// ===================================================================
// CLIENTS
// ===================================================================
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Every client for the admin screen, retired ones included, each with the
// number of projects hanging off it.
//
// The count comes off the list query itself - one read for the whole
// screen - and it is what makes a client undeletable, so the screen can
// say so rather than offering a button that always fails. There is no
// delete: `projects.client_id` is ON DELETE RESTRICT precisely so removing
// a client cannot take billing history with it.
// -------------------------------------------------------------------
export async function getClientsService(): Promise<ClientSummaryDTO[]> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const clients = await getClientsRepo({ includeInactive: true });

    return clients.map(mapClientSummary);
  } catch (error) {
    throw handleError("getClientsService", error);
  }
}

// -------------------------------------------------------------------
// The clients a new project may be started for: ACTIVE only.
//
// Retired clients are left out because offering one in a picker is how a
// project ends up attached to a client somebody deliberately took out of
// circulation. Typing the name of a retired client is refused with a
// sentence rather than silently reusing it - see resolveProjectClient.
// -------------------------------------------------------------------
export async function getClientOptionsService(): Promise<ClientOptionDTO[]> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const clients = await getClientsRepo();

    return clients.map((client) => ({ id: client.id, name: client.name }));
  } catch (error) {
    throw handleError("getClientOptionsService", error);
  }
}

// One client, with the notes the edit form needs. Separate from the list
// because a list of fifty clients has no use for fifty notes fields.
export async function getClientDetailService(clientId: string): Promise<ClientDetailDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const client = await getClientByIdRepo(clientId);

    if (!client) notFound();

    const projectCount = await countProjectsForClientRepo(client.id);

    return {
      id: client.id,
      name: client.name,
      isActive: client.isActive,
      projectCount,
      notes: client.notes,
      createdAt: client.createdAt,
    };
  } catch (error) {
    throw handleError("getClientDetailService", error);
  }
}

// -------------------------------------------------------------------
// WHAT A TYPED CLIENT NAME MEANS, given whatever the index says already
// exists under it.
//
// Pure, and exported so the rule can be asserted without a database - the
// same arrangement `isCompletePhaseOrdering` and `admitOption` use, and for
// the same reason: the interesting part is what it REFUSES, and a decision
// only reachable through two repository calls never gets tested.
//
// Three answers and no fourth:
//
//   nothing exists   -> create it. The ordinary case.
//   an ACTIVE match  -> reuse it. "Perks already exists" is not an error
//                       from the point of view of somebody who just wants
//                       the project made.
//   a RETIRED match  -> refuse, and name it. Somebody took that client out
//                       of circulation; reusing it silently would undo
//                       that decision without saying so, and creating a
//                       second one is impossible - the unique index covers
//                       retired rows too.
//
// The caller supplies the match from `getClientByNameRepo`, whose predicate
// IS the unique index's expression. Matching is therefore EXACT once
// normalised, with no prefix or fuzzy fallback: quietly attaching a project
// to a similarly named client is worse than a duplicate an admin can see,
// because the wrong one is invisible and every report about either client
// is then wrong.
// -------------------------------------------------------------------
export type TypedClientOutcome =
  | { kind: "create" }
  | { kind: "reuse" }
  | { kind: "refuse"; message: string };

export function typedClientOutcome(existing: Client | undefined): TypedClientOutcome {
  if (!existing) return { kind: "create" };

  if (existing.isActive) return { kind: "reuse" };

  return {
    kind: "refuse",
    message: `There is already a client called ${existing.name}, and it has been retired. Restore it before starting a project for them.`,
  };
}

// -------------------------------------------------------------------
// Whether a phase can be deleted, and the sentence if it cannot.
//
// Pure and exported for the same reason as above: the refusal is the whole
// point of the function, and it has to fire on `timeEntryCount` rather than
// on `loggedMinutes`. Those come apart - an entry of nought minutes cannot
// exist (`minutes > 0` is a CHECK), but summing to zero is what a caller
// would see if the join ever changed, and RESTRICT cares about the ROWS.
// -------------------------------------------------------------------
export function phaseDeletionRefusal(phaseName: string, logged: PhaseTimeLogged): string | null {
  if (logged.timeEntryCount === 0) return null;

  return `${phaseName} cannot be deleted: ${formatMinutesAsClock(
    logged.loggedMinutes,
  )} has been logged against its tasks. Rename it, or move the tasks that are still open to another phase.`;
}

// -------------------------------------------------------------------
// How many files hang off one phase's cards.
//
// Pure, and composed from two reads the board already has rather than from
// a phase-scoped query, because there is no phase-scoped attachment read in
// the repository layer and a service may not write one. `tasks` carries
// `phaseId`, `getAttachmentCountsForProjectRepo` is keyed by task, so the
// join happens here on values the caller was already authorised for.
//
// A CARD WITH NO FILES IS ABSENT from the counts rather than present as a
// zero - that is the documented contract of the grouped read - so this
// sums what is there and never has to default a miss.
// -------------------------------------------------------------------
export function attachmentsUnderPhase(
  phaseId: string,
  projectTasks: readonly { id: string; phaseId: string }[],
  attachmentCounts: readonly TaskAttachmentCount[],
): number {
  const taskIdsInPhase = new Set(
    projectTasks.filter((task) => task.phaseId === phaseId).map((task) => task.id),
  );

  return attachmentCounts.reduce(
    (total, row) => (taskIdsInPhase.has(row.taskId) ? total + row.attachmentCount : total),
    0,
  );
}

// -------------------------------------------------------------------
// Whether a phase's files stand in the way of deleting it, and the
// sentence if they do.
//
// Pure and exported for the same reason as phaseDeletionRefusal, and shaped
// like it deliberately: same opening clause, same "here is what to do
// instead" ending. The two refusals are the same kind of answer and should
// not read like two different systems talking.
//
// THE COUNT IS NAMED because it is what makes the sentence actionable -
// "one file" is a card somebody can find, and a large number says the
// phase is more alive than they thought. See deletePhaseService for why
// this refusal exists at all rather than the files simply being cleared.
// -------------------------------------------------------------------
export function phaseAttachmentRefusal(phaseName: string, attachmentCount: number): string | null {
  if (attachmentCount === 0) return null;

  return `${phaseName} cannot be deleted: ${attachmentCount} file${
    attachmentCount === 1 ? " is" : "s are"
  } attached to its tasks, and deleting the phase would leave those files stored with nothing pointing at them. Remove them from their cards first, then delete the phase.`;
}

// -------------------------------------------------------------------
// Turn the case-insensitive unique index into a sentence.
//
// `idx_clients_name_unique` is UNIQUE on lower(btrim(name)), so "Perks"
// and "perks" cannot both exist - without that rule every report about
// either one would be half right. Nothing in the schema layer can check
// it, so this is the module's job, and this is the CLIENT FORM's half of
// it: a refusal. The project setup flow's half is typedClientOutcome
// above, which reuses instead, and the difference is what somebody on each
// form meant.
// -------------------------------------------------------------------
function duplicateClientMessage(existing: Client): DisplayErrorMessage {
  return new DisplayErrorMessage(
    existing.isActive
      ? `There is already a client called ${existing.name}. Open that one instead of creating a second.`
      : `There is already a client called ${existing.name}, and it has been retired. Restore it rather than creating a second.`,
  );
}

// -------------------------------------------------------------------
// Create a client from the client screen.
//
// DELIBERATELY NOT create-or-reuse. Somebody on this form is stating that
// a new client exists, so being quietly handed the one that already does -
// possibly a retired one - hides the thing they need to know. The project
// setup flow is the opposite case and reuses; see resolveProjectClient for
// why the two differ.
// -------------------------------------------------------------------
export async function createClientService(requestDTO: CreateClientRequestDTO): Promise<string> {
  try {
    const user = await requireUserRole([USER_ROLES.ADMIN]);

    const existing = await getClientByNameRepo(requestDTO.name);

    if (existing) throw duplicateClientMessage(existing);

    const now = new Date();

    let client: Client;

    try {
      client = await addClientRepo({
        id: generateId(),
        name: requestDTO.name,
        notes: requestDTO.notes,
        isActive: true,
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      // Two tabs, or two clicks. The check above is a read and not a lock,
      // so the index is what actually holds the rule - and this is what
      // stops it reaching somebody as a constraint violation. Re-read
      // rather than inspecting the error: the same lower(btrim(name))
      // predicate the index uses answers "was it this" without depending
      // on a driver's error shape.
      const raced = await getClientByNameRepo(requestDTO.name);

      if (!raced) throw error;

      throw duplicateClientMessage(raced);
    }

    await recordAuditEvent({
      action: AUDIT_ACTIONS.CLIENT_CREATED,
      entityType: AUDIT_ENTITY_TYPES.CLIENT,
      entityId: client.id,
      summary: `Created client ${client.name}`,
    });

    revalidateClientViews();

    return client.id;
  } catch (error) {
    throw handleError("createClientService", error);
  }
}

// -------------------------------------------------------------------
// Rename a client, edit its notes, or retire and restore it.
//
// `isActive` is the soft delete and it travels on the ordinary edit form,
// so this is also the restore path. A rename is checked against the same
// unique index a create is: two clients cannot end up sharing a name by
// the back door of an edit.
// -------------------------------------------------------------------
export async function updateClientService(requestDTO: UpdateClientRequestDTO): Promise<void> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const before = await getClientByIdRepo(requestDTO.clientId);

    if (!before) {
      throw new DisplayErrorMessage("That client no longer exists.");
    }

    // ONLY WHEN A NAME WAS ACTUALLY SUPPLIED. The schema makes it optional -
    // absent leaves the name alone - and a patch that changes only the notes
    // has no new name to collide with, so there is nothing to look up.
    //
    // Compared through the index's own predicate, and the id check is what
    // makes re-saving a form without touching the name safe: a client is
    // never reported as a duplicate of itself.
    if (requestDTO.name !== undefined) {
      const sameName = await getClientByNameRepo(requestDTO.name);

      if (sameName && sameName.id !== before.id) throw duplicateClientMessage(sameName);
    }

    const updated = await updateClientByIdRepo(requestDTO.clientId, {
      name: requestDTO.name,
      notes: requestDTO.notes,
      isActive: requestDTO.isActive,
    });

    if (!updated) {
      throw new DisplayErrorMessage("That client no longer exists.");
    }

    const fieldChanges = diffFields([
      { field: "name", label: "Name", from: before.name, to: updated.name },
      { field: "notes", label: "Notes", from: before.notes, to: updated.notes },
      { field: "isActive", label: "Active", from: before.isActive, to: updated.isActive },
    ]);

    if (fieldChanges.length > 0) {
      // Retiring or restoring a client is worth finding on its own, the
      // same way a team's status change is. A save that also renamed it
      // reads better as one entry carrying every field.
      const statusOnly = fieldChanges.length === 1 && fieldChanges[0].field === "isActive";

      await recordAuditEvent({
        action: statusOnly ? AUDIT_ACTIONS.CLIENT_STATUS_CHANGED : AUDIT_ACTIONS.CLIENT_UPDATED,
        entityType: AUDIT_ENTITY_TYPES.CLIENT,
        entityId: updated.id,
        summary: statusOnly
          ? `${updated.isActive ? "Restored" : "Retired"} client ${updated.name}`
          : `Updated client ${updated.name}`,
        changes: { fields: fieldChanges },
      });
    }

    revalidateClientViews();
    // A client's name is on every project row, so a rename moves the
    // project screens too.
    revalidateProjectViews();
  } catch (error) {
    throw handleError("updateClientService", error);
  }
}

// -------------------------------------------------------------------
// Retire a client. THE ONLY WAY ONE LEAVES THE SCREEN.
//
// Not a delete, and there is no delete to add:
// `projects.client_id` is ON DELETE RESTRICT because removing a client
// with projects would take their time entries - billing history - with it.
// Retiring covers the "created it twice by accident" case just as well,
// since an inactive client is out of every picker.
//
// Its projects are NOT archived with it. That is a separate decision about
// each one, and a retired client with live projects is a real state -
// somebody has stopped taking new work from them while finishing what was
// already agreed.
// -------------------------------------------------------------------
export async function deactivateClientService(requestDTO: DeactivateClientRequest): Promise<void> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const client = await getClientByIdRepo(requestDTO.clientId);

    if (!client) {
      throw new DisplayErrorMessage("That client no longer exists.");
    }

    // Already retired. Not an error worth interrupting anybody over - two
    // tabs racing produce exactly this - and nothing is recorded, because
    // nothing changed.
    if (!client.isActive) return;

    const updated = await updateClientByIdRepo(client.id, { isActive: false });

    if (!updated) return;

    await recordAuditEvent({
      action: AUDIT_ACTIONS.CLIENT_STATUS_CHANGED,
      entityType: AUDIT_ENTITY_TYPES.CLIENT,
      entityId: updated.id,
      summary: `Retired client ${updated.name}`,
      changes: { fields: diffFields([{ field: "isActive", label: "Active", from: true, to: false }]) },
    });

    revalidateClientViews();
    revalidateProjectViews();
  } catch (error) {
    throw handleError("deactivateClientService", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// PROJECTS
// ===================================================================
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// THE CLIENT ON A NEW PROJECT: picked, or typed.
//
// CREATE-OR-REUSE, and the reuse is the point. The setup flow's client
// control is a combobox with a "create <name>" row in it, so somebody
// typing "Perks" when Perks already exists means "the Perks I know about" -
// and failing on the unique index would answer a reasonable act with a
// database error.
//
// MATCHING IS EXACT ONCE NORMALISED, and the normalising happens in SQL:
// getClientByNameRepo's predicate IS the index expression, character for
// character. There is deliberately no prefix or fuzzy fallback - quietly
// attaching a project to a similarly named client is worse than a duplicate
// an admin can see and merge, because the wrong one is invisible and every
// report about either client is then wrong.
//
// A RETIRED MATCH IS REFUSED rather than reused or reactivated. Somebody
// took that client out of circulation; silently bringing it back on the
// strength of a typed name would undo that decision without saying so.
//
// NOT IN THE PROJECT'S TRANSACTION, and that is deliberate. Postgres aborts
// a transaction on the first error, so the re-read that recovers from a
// unique-violation race cannot run inside one - it would fail with "current
// transaction is aborted" and the race would surface as a 500. The cost of
// keeping it outside is a client with no projects if the project insert
// then fails, which is visible in the admin list, reusable, and refuses to
// be deleted for no reason. The alternative loses the recovery entirely.
// -------------------------------------------------------------------
async function resolveProjectClient(client: ProjectClientRequestDTO, actorUserId: string): Promise<Client> {
  if (client.mode === "existing") {
    const existing = await getClientByIdRepo(client.clientId);

    if (!existing) {
      throw new DisplayErrorMessage("That client no longer exists. Pick another, or type a new name.");
    }

    if (!existing.isActive) {
      throw new DisplayErrorMessage(
        `${existing.name} has been retired. Restore that client before starting a project for them.`,
      );
    }

    return existing;
  }

  const matched = await getClientByNameRepo(client.name);
  const outcome = typedClientOutcome(matched);

  if (outcome.kind === "refuse") throw new DisplayErrorMessage(outcome.message);

  // Narrowing: "reuse" is only reachable with a match in hand.
  if (outcome.kind === "reuse" && matched) return matched;

  const now = new Date();

  try {
    return await addClientRepo({
      id: generateId(),
      name: client.name,
      // No notes: this client was created in passing while setting up a
      // project, and there is no field on that form to write one in.
      notes: null,
      isActive: true,
      createdBy: actorUserId,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    // The read above is not a lock, so two people setting up projects for
    // the same new client at once both reach the insert and one loses on
    // the index. Re-read and put the same rule to it: reuse what the winner
    // created, which is what both of them asked for.
    //
    // Nothing exists under the name after all, so the insert failed for
    // some other reason. Rethrown rather than described, because guessing
    // would be a lie - the action turns an unrecognised error into the
    // generic message and the real one goes to the log.
    const raced = await getClientByNameRepo(client.name);

    if (!raced) throw error;

    const racedOutcome = typedClientOutcome(raced);

    if (racedOutcome.kind === "refuse") throw new DisplayErrorMessage(racedOutcome.message);

    return raced;
  }
}

// -------------------------------------------------------------------
// THE LEFT-HAND NAV: the projects the SESSION USER is on.
//
// AN ADMIN SEES ONLY THEIR OWN MEMBERSHIPS HERE, and that is a decision
// rather than an oversight - the opposite is perfectly defensible, so it is
// written down. The nav is "my projects": an admin who is on two projects
// and administers forty wants the two, and a nav that lists everything is
// unusable in a month and stops being a working set. Nothing is hidden by
// it - an admin reaches any project through the admin screens, and
// requireProjectAccess lets them open it - so this is a matter of what the
// sidebar is for, not of authorization.
//
// Archived projects are out. Archiving is this module's soft delete, and a
// nav that keeps every project anybody has ever finished grows without
// limit.
// -------------------------------------------------------------------
export async function getMyProjectsService(): Promise<ProjectSummaryDTO[]> {
  try {
    const user = await requireUser();

    const memberships = await getProjectsForUserRepo(user.id, { sort: "alphabetical" });

    // An admin can edit any project's tasks whether or not they are its
    // lead, so the flag is the OR of the two - decided in one exported
    // function rather than in a component, which would be a second copy of
    // the same rule.
    return memberships.map((project) =>
      mapProjectSummary(project, canEditProjectTasks(user.role, project.isLead)),
    );
  } catch (error) {
    throw handleError("getMyProjectsService", error);
  }
}

// -------------------------------------------------------------------
// EVERY project, for an admin choosing one.
//
// WHY THIS EXISTS BESIDE getMyProjectsService. That one is the NAV read and
// is deliberately memberships-only - an admin on two projects who
// administers forty wants the two. It is the wrong read for a PICKER, and
// the budget report was using it: an admin who was not a member of a project
// had no way to open its report at all, while the page told them those
// projects "are reached from their own board" - a link that had been removed
// from the board. Two wrongs pointing at each other.
//
// ADMIN ONLY, because the one screen that picks from it is. The budget
// report itself guards on requireRatesAdmin, so a narrower list here would
// hide projects from somebody the service would then happily serve.
//
// ARCHIVED PROJECTS ARE INCLUDED, unlike the nav read. Archiving is this
// module's soft delete and the report is where somebody asks what a finished
// project cost - excluding them would hide exactly the ones worth reporting
// on. The nav excludes them because a sidebar that keeps every project
// anybody has ever finished grows without limit; a picker has a search box.
//
// `canEditTasks` is the admin's blanket true. It is not a membership answer
// here - there may be no membership row - and the DTO carries it because
// every consumer of ProjectSummaryDTO expects it.
// -------------------------------------------------------------------
export async function getAllProjectsForAdminService(): Promise<ProjectSummaryDTO[]> {
  try {
    const user = await requireUserRole([USER_ROLES.ADMIN]);

    const projects = await getAllProjectsRepo({ sort: "alphabetical", includeArchived: true });

    return projects.map((project) => mapProjectSummary(project, canEditProjectTasks(user.role, false)));
  } catch (error) {
    throw handleError("getAllProjectsForAdminService", error);
  }
}

// -------------------------------------------------------------------
// One project: its header, its people, its phases and its budget bar.
//
// READABLE BY A MEMBER, not only an admin - this is the screen the project
// is worked from. requireProjectAccess is the whole access decision, and a
// project the caller is not on answers notFound().
//
// ASSEMBLED FROM BATCHED READS. Four queries, none of them per phase: the
// phases, their estimate totals and task counts grouped in one pass, the
// minutes logged grouped by phase, and the project's own totals. A phase
// with no tasks is ABSENT from the grouped reads rather than zero, which is
// what the Map lookups default.
//
// NO MONEY. Not even for an admin: this screen deals in minutes, and cents
// come from the budget report under its own guard.
// -------------------------------------------------------------------
export async function getProjectDetailService(projectId: string): Promise<ProjectDetailDTO> {
  try {
    const access = await requireProjectAccess(projectId);
    const project = access.project;

    const [phases, phaseEstimates, phaseLogged, members, projectEstimateMinutes, projectLogged] = await Promise.all([
      getPhasesForProjectRepo(project.id),
      getPhaseEstimateMinutesRepo(project.id),
      getLoggedMinutesByPhaseRepo(project.id),
      getProjectMembersRepo(project.id),
      getProjectEstimateMinutesRepo(project.id),
      getLoggedMinutesByProjectRepo([project.id]),
    ]);

    const estimateByPhase = new Map(phaseEstimates.map((row) => [row.phaseId, row]));
    const loggedByPhase = new Map(phaseLogged.map((row) => [row.phaseId, row.minutes]));

    const phaseDTOs: PhaseDTO[] = phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      position: phase.position,
      taskCount: estimateByPhase.get(phase.id)?.taskCount ?? 0,
      estimateMinutes: estimateByPhase.get(phase.id)?.estimateMinutes ?? 0,
      loggedMinutes: loggedByPhase.get(phase.id) ?? 0,
    }));

    return {
      project: mapProjectSummary(
        {
          id: project.id,
          title: project.title,
          clientId: project.clientId,
          clientName: project.clientName,
          status: project.status,
          isBillable: project.isBillable,
        },
        access.canEditTasks,
      ),
      description: project.description,
      members: members.map(mapProjectMember),
      phases: phaseDTOs,
      // Every task estimate against every minute logged. The project's own
      // totals rather than the sum of the phases above: a task moved
      // between phases would make those two agree anyway, but only one of
      // them is the figure the header is claiming.
      rollup: budgetProgress(projectEstimateMinutes, projectLogged[0]?.minutes ?? 0),
      budgetAssignedAt: project.budgetAssignedAt,
      createdAt: project.createdAt,
    };
  } catch (error) {
    throw handleError("getProjectDetailService", error);
  }
}

// -------------------------------------------------------------------
// Create a project, and its client if that is what was asked for.
//
// IT STARTS WITH NO MEMBERS, NO PHASES AND NO BUDGET GROUPS, which is what
// CreateProjectSchema describes and what its comment in delivery.types.ts
// says: the setup screen runs setProjectMembersService next, then the
// phases and the groups. A project with no members is invisible to
// everybody except an admin, and since admins are who create projects that
// locks nobody out.
//
// (The brief this was written from asked for one transaction covering
// members, bands, groups and phases as well. There is no schema for a
// composite create in delivery.types.ts - the committed contract split it
// deliberately - so this creates the project and the four setters that
// follow each own their own write. A composite act needs a schema first;
// inventing one here would put half this module's contract in a service.)
//
// The client is resolved BEFORE the insert rather than inside a transaction
// with it - see resolveProjectClient for why that cannot be one unit.
// -------------------------------------------------------------------
export async function createProjectService(requestDTO: CreateProjectRequestDTO): Promise<string> {
  try {
    const user = await requireUserRole([USER_ROLES.ADMIN]);

    const client = await resolveProjectClient(requestDTO.client, user.id);

    const now = new Date();

    const project = await addProjectRepo({
      id: generateId(),
      clientId: client.id,
      title: requestDTO.title,
      description: requestDTO.description,
      isBillable: requestDTO.isBillable,
      // Stated rather than left to the column default: a new project is
      // active, and the schema offers no choice precisely so nobody can
      // create an archived one.
      status: PROJECT_STATUSES.ACTIVE,
      // Nobody has finished planning yet, so the setup nudge shows. It is
      // stamped once, by markProjectBudgetAssignedService, and never
      // cleared.
      budgetAssignedAt: null,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    });

    await recordAuditEvent({
      action: AUDIT_ACTIONS.PROJECT_CREATED,
      entityType: AUDIT_ENTITY_TYPES.PROJECT,
      entityId: project.id,
      summary: `Created project ${project.title} for ${client.name}`,
      metadata: { clientId: client.id, isBillable: project.isBillable },
    });

    revalidateProjectViews();
    // The client list carries a project count per row, and one of them just
    // moved.
    revalidateClientViews();

    return project.id;
  } catch (error) {
    throw handleError("createProjectService", error);
  }
}

// -------------------------------------------------------------------
// Edit a project: title, description, billable, status.
//
// THE CLIENT CANNOT BE CHANGED HERE, and the schema does not carry one.
// Moving a project to another client would silently re-attribute every
// hour already logged against it, which is billing history.
// -------------------------------------------------------------------
export async function updateProjectService(requestDTO: UpdateProjectRequestDTO): Promise<void> {
  try {
    const { project: before } = await requireAdminProject(requestDTO.projectId);

    const updated = await updateProjectRepo(requestDTO.projectId, {
      title: requestDTO.title,
      description: requestDTO.description,
      isBillable: requestDTO.isBillable,
      status: requestDTO.status,
    });

    if (!updated) {
      throw new DisplayErrorMessage("That project no longer exists.");
    }

    const fieldChanges = diffFields([
      { field: "title", label: "Title", from: before.title, to: updated.title },
      { field: "description", label: "Description", from: before.description, to: updated.description },
      { field: "isBillable", label: "Billable", from: before.isBillable, to: updated.isBillable },
      {
        field: "status",
        label: "Status",
        from: PROJECT_STATUS_LABELS[before.status],
        to: PROJECT_STATUS_LABELS[updated.status],
      },
    ]);

    if (fieldChanges.length > 0) {
      const statusOnly = fieldChanges.length === 1 && fieldChanges[0].field === "status";

      await recordAuditEvent({
        action: statusOnly ? AUDIT_ACTIONS.PROJECT_STATUS_CHANGED : AUDIT_ACTIONS.PROJECT_UPDATED,
        entityType: AUDIT_ENTITY_TYPES.PROJECT,
        entityId: updated.id,
        summary: statusOnly
          ? `Set project ${updated.title} to ${PROJECT_STATUS_LABELS[updated.status]}`
          : `Updated project ${updated.title}`,
        changes: { fields: fieldChanges },
      });
    }

    revalidateProjectViews();
  } catch (error) {
    throw handleError("updateProjectService", error);
  }
}

// -------------------------------------------------------------------
// Archive a project. THE SOFT DELETE, and there is no hard one.
//
// Time entries reference tasks ON DELETE RESTRICT, so a project with any
// hours logged cannot be removed - and one without them still should not
// be, because "we did not end up doing this" is part of the record.
// Archiving takes it out of the nav and every default list and leaves
// everything readable.
//
// Membership is deliberately untouched: restoring the project should bring
// back the team that was on it, and removing the rows would also clear
// every task assignment on the way out.
// -------------------------------------------------------------------
export async function archiveProjectService(requestDTO: ArchiveProjectRequest): Promise<void> {
  try {
    const { project } = await requireAdminProject(requestDTO.projectId);

    if (project.status === PROJECT_STATUSES.ARCHIVED) return;

    const updated = await updateProjectRepo(project.id, { status: PROJECT_STATUSES.ARCHIVED });

    if (!updated) return;

    await recordAuditEvent({
      action: AUDIT_ACTIONS.PROJECT_STATUS_CHANGED,
      entityType: AUDIT_ENTITY_TYPES.PROJECT,
      entityId: updated.id,
      summary: `Archived project ${updated.title}`,
      changes: {
        fields: diffFields([
          {
            field: "status",
            label: "Status",
            from: PROJECT_STATUS_LABELS[project.status],
            to: PROJECT_STATUS_LABELS[PROJECT_STATUSES.ARCHIVED],
          },
        ]),
      },
    });

    revalidateProjectViews();
  } catch (error) {
    throw handleError("archiveProjectService", error);
  }
}

// -------------------------------------------------------------------
// Mark the budget as assigned. ONCE.
//
// The setup screen shows a progress bar of how much of the project's
// budget has been allocated to tasks, and this is what stops it. A ONE-TIME
// NUDGE, NOT A RULE: it must not reappear if an estimate is later reduced
// below the total again, which is why the repository only writes the
// timestamp while it is still null and why nothing here ever clears it.
//
// Undefined back means either "already stamped" or "no such project", and
// neither is worth distinguishing: both say there is nothing to do. So this
// is idempotent by construction and two tabs finishing setup together
// cannot move the timestamp.
// -------------------------------------------------------------------
export async function markProjectBudgetAssignedService(
  requestDTO: MarkProjectBudgetAssignedRequestDTO,
): Promise<void> {
  try {
    await requireAdminProject(requestDTO.projectId);

    const stamped = await markProjectBudgetAssignedRepo(requestDTO.projectId);

    // Nothing moved, so nothing to refresh.
    if (!stamped) return;

    revalidateProjectViews();
  } catch (error) {
    throw handleError("markProjectBudgetAssignedService", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// PROJECT MEMBERSHIP
// ===================================================================
//
// EVERY FUNCTION HERE IS AN AUTHORIZATION CHANGE. A membership row is what
// lets somebody see a project at all, `is_lead` is what lets them create
// and edit its tasks, and `rate_band` is what the client is charged for
// their hours. All of it is admin-only to set, and all of it is audited
// naming both parties.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Check the people being put on a project are accounts that may hold a
// place there, and return them by id so the audit entries can name them.
//
// Unknown ids are refused as a group rather than named. A member picker
// only offers assignable accounts, so an id that resolves to nothing did
// not come from the screen - and echoing back which of a set of guessed
// ids exists is an account oracle.
// -------------------------------------------------------------------
async function resolveAssignableUsers(userIds: string[]): Promise<Map<string, User>> {
  const users = await getUsersByIdsRepo(userIds);
  const byId = new Map(users.map((user) => [user.id, user]));

  if (byId.size !== new Set(userIds).size) {
    throw new DisplayErrorMessage("One of those accounts no longer exists. Refresh the page and try again.");
  }

  // Named, because this one is not an oracle: the caller already knows the
  // account exists, and "Ada Lovelace's account is not active" is the only
  // form of the message somebody can act on.
  const blocked = users.filter((user) => !isAssignable(user));

  if (blocked.length > 0) {
    throw new DisplayErrorMessage(
      `${blocked.map((user) => userDisplayName(user)).join(", ")} cannot be put on a project: the account is not active.`,
    );
  }

  return byId;
}

// -------------------------------------------------------------------
// Replace a project's WHOLE member set.
//
// The set rather than deltas, for the reason SetProjectMembersSchema gives:
// the failure mode of a delta is somebody removed on screen who is still in
// the table because one request of three was dropped. A complete set makes
// the database match what the admin was looking at when they saved, and the
// repository does it in one transaction.
//
// REMOVING SOMEBODY CLEARS THEIR TASK ASSIGNMENTS, inside that transaction.
// That is a security cleanup, not tidying: "my tasks" reads by assignee and
// carries the phase, the project title and the client's name, so an
// assignment left behind keeps four facts about a project somebody can no
// longer open. Their budget group place goes with it, and their TIME
// ENTRIES DO NOT - that is billing history, and losing access must never
// rewrite what somebody did.
//
// A PROJECT WITH NO LEAD IS ALLOWED. It is the honest intermediate state
// while a lead is being replaced, and it locks nobody out: an admin can act
// on any project. The screen warns; this does not refuse.
// -------------------------------------------------------------------
export async function setProjectMembersService(requestDTO: SetProjectMembersRequestDTO): Promise<void> {
  try {
    const { project } = await requireAdminProject(requestDTO.projectId);

    const usersById = await resolveAssignableUsers(requestDTO.members.map((member) => member.userId));

    const { addedUserIds, removedUserIds } = await setProjectMembersRepo(project.id, requestDTO.members);

    const bandByUserId = new Map(requestDTO.members.map((member) => [member.userId, member]));

    // Only the people who MOVED are recorded. A re-save of an unchanged
    // form is not an access change and must not read as everybody being
    // added again.
    for (const userId of addedUserIds) {
      const member = bandByUserId.get(userId);

      await recordAuditEvent({
        action: AUDIT_ACTIONS.PROJECT_MEMBER_ADDED,
        entityType: AUDIT_ENTITY_TYPES.PROJECT_MEMBER,
        entityId: project.id,
        subjectUserId: userId,
        summary: `Added ${nameOf(usersById, userId)} to project ${project.title}${
          member?.isLead ? " as lead" : ""
        }`,
        metadata: { projectId: project.id, isLead: member?.isLead ?? false, rateBand: member?.rateBand ?? null },
      });
    }

    // The half worth reading: these people just lost access to the project,
    // and their task assignments went with them.
    for (const userId of removedUserIds) {
      await recordAuditEvent({
        action: AUDIT_ACTIONS.PROJECT_MEMBER_REMOVED,
        entityType: AUDIT_ENTITY_TYPES.PROJECT_MEMBER,
        entityId: project.id,
        subjectUserId: userId,
        // The removed people are not in usersById - they were not in the
        // submitted set - so the id is all this has. It is the audit
        // viewer's job to resolve a name from it, which it does.
        summary: `Removed a member from project ${project.title}`,
        metadata: { projectId: project.id },
      });
    }

    revalidateProjectViews();
  } catch (error) {
    throw handleError("setProjectMembersService", error);
  }
}

// The name for an audit summary, or the id when the account was not part of
// this request. Never throws: an audit line with less to say still belongs
// in the record.
function nameOf(usersById: Map<string, User>, userId: string): string {
  const user = usersById.get(userId);

  return user ? userDisplayName(user) : userId;
}

// -------------------------------------------------------------------
// Put one person on a project.
//
// Undefined back means they were already on it and the EXISTING ROW WAS
// LEFT ALONE - deliberately, so re-adding somebody can never quietly
// change the rate band the client is charged or hand them a lead's editing
// rights. Use updateProjectMemberService when a change is what is meant.
// -------------------------------------------------------------------
export async function addProjectMemberService(requestDTO: AddProjectMemberRequest): Promise<void> {
  try {
    const { project } = await requireAdminProject(requestDTO.projectId);

    const usersById = await resolveAssignableUsers([requestDTO.userId]);

    const membership = await addProjectMemberRepo({
      projectId: project.id,
      userId: requestDTO.userId,
      isLead: requestDTO.isLead,
      rateBand: requestDTO.rateBand,
    });

    // Already a member. Nothing changed, so nothing is recorded.
    if (!membership) return;

    await recordAuditEvent({
      action: AUDIT_ACTIONS.PROJECT_MEMBER_ADDED,
      entityType: AUDIT_ENTITY_TYPES.PROJECT_MEMBER,
      entityId: project.id,
      subjectUserId: requestDTO.userId,
      summary: `Added ${nameOf(usersById, requestDTO.userId)} to project ${project.title} on the ${
        RATE_BAND_LABELS[requestDTO.rateBand]
      } band${requestDTO.isLead ? ", as lead" : ""}`,
      metadata: { projectId: project.id, isLead: requestDTO.isLead, rateBand: requestDTO.rateBand },
    });

    revalidateProjectViews();
  } catch (error) {
    throw handleError("addProjectMemberService", error);
  }
}

// -------------------------------------------------------------------
// Change what somebody is on a project: the lead flag, the rate band, or
// both.
//
// Changing a band does NOT restate work already logged. The rates that
// reach an invoice are snapshotted onto each time entry when the time is
// logged, so an hour stays worth what it was worth when it was worked.
// -------------------------------------------------------------------
export async function updateProjectMemberService(requestDTO: UpdateProjectMemberRequest): Promise<void> {
  try {
    const { project } = await requireAdminProject(requestDTO.projectId);

    const members = await getProjectMembersRepo(project.id);
    const before = members.find((member) => member.userId === requestDTO.userId);

    if (!before) {
      throw new DisplayErrorMessage("That person is not on this project.");
    }

    const fieldChanges = diffFields([
      { field: "isLead", label: "Lead", from: before.isLead, to: requestDTO.isLead },
      {
        field: "rateBand",
        label: "Rate band",
        from: RATE_BAND_LABELS[before.rateBand],
        to: RATE_BAND_LABELS[requestDTO.rateBand],
      },
    ]);

    // Nothing moved. The repository would read the row back and answer the
    // same thing, so this only saves the round trip and the audit line.
    if (fieldChanges.length === 0) return;

    const updated = await updateProjectMemberRepo(project.id, requestDTO.userId, {
      isLead: requestDTO.isLead,
      rateBand: requestDTO.rateBand,
    });

    if (!updated) {
      throw new DisplayErrorMessage("That person is not on this project.");
    }

    await recordAuditEvent({
      action: AUDIT_ACTIONS.PROJECT_MEMBER_CHANGED,
      entityType: AUDIT_ENTITY_TYPES.PROJECT_MEMBER,
      entityId: project.id,
      subjectUserId: requestDTO.userId,
      summary: `Changed ${userDisplayName(before)} on project ${project.title}`,
      changes: { fields: fieldChanges },
      metadata: { projectId: project.id },
    });

    revalidateProjectViews();
  } catch (error) {
    throw handleError("updateProjectMemberService", error);
  }
}

// -------------------------------------------------------------------
// Take one person off a project.
//
// removeProjectMemberRepo, NOT a plain delete: it clears their open task
// assignments and their budget group place in the SAME transaction as the
// removal. Nothing else would - neither `tasks` nor
// `project_budget_group_members` references the membership row, so no
// foreign key can cascade either, and splitting them across two
// transactions leaves a window where the row is gone and the assignment
// still reads.
// -------------------------------------------------------------------
export async function removeProjectMemberService(requestDTO: RemoveProjectMemberRequest): Promise<void> {
  try {
    const { project } = await requireAdminProject(requestDTO.projectId);

    const members = await getProjectMembersRepo(project.id);
    const before = members.find((member) => member.userId === requestDTO.userId);

    // Not on the project. Two tabs racing produce exactly this, and there
    // is nothing to undo.
    if (!before) return;

    const removed = await removeProjectMemberRepo(project.id, requestDTO.userId);

    if (removed === 0) return;

    await recordAuditEvent({
      action: AUDIT_ACTIONS.PROJECT_MEMBER_REMOVED,
      entityType: AUDIT_ENTITY_TYPES.PROJECT_MEMBER,
      entityId: project.id,
      subjectUserId: requestDTO.userId,
      summary: `Removed ${userDisplayName(before)} from project ${project.title}`,
      metadata: { projectId: project.id, clearedTaskAssignments: true },
    });

    revalidateProjectViews();
  } catch (error) {
    throw handleError("removeProjectMemberService", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// BUDGET GROUPS
// ===================================================================
//
// "These two interns have 400 hours between them; this principal has 50."
//
// EVERY MUTATION HERE IS HANDED A GROUP ID AND NOTHING ELSE, because that
// is what the forms have. So each one resolves the group first, learns
// which PROJECT it belongs to, and authorises against THAT before touching
// anything - which is exactly what getProjectBudgetGroupRepo exists for.
// Passing a project id in from elsewhere in the request would not fail
// safe: a mismatched pair matches no row on the updates but hits the
// composite foreign key on a member insert, so a guessed id would surface
// as a database error instead of a refusal.
// -------------------------------------------------------------------

// Resolve a group and the project it belongs to, admin-only.
async function requireAdminBudgetGroup(
  groupId: string,
): Promise<{ user: SessionUser; project: ProjectWithClient; group: ProjectBudgetGroup }> {
  const user = await requireUserRole([USER_ROLES.ADMIN]);

  const group = await getProjectBudgetGroupRepo(groupId);

  if (!group) {
    throw new DisplayErrorMessage("That budget group no longer exists.");
  }

  const project = await getProjectByIdRepo(group.projectId);

  if (!project) {
    throw new DisplayErrorMessage("That project no longer exists.");
  }

  return { user, project, group };
}

// -------------------------------------------------------------------
// A project's budget groups, with their people and their pooled progress.
//
// TWO READS AND A STITCH, never one per group: the groups with their
// members come back together, and the minutes are grouped by group in one
// pass. An empty group survives both - it is created before the people are
// picked, so it has to.
//
// MONEY IS ABSENT, and for an admin too. A pooled budget's chargeable value
// needs the rate snapshots, which is the budget report's work under its own
// guard; this is the setup view and deals in minutes. Absence here is the
// module's "not part of this view" rather than "unknown" - see the note on
// BudgetReportDTO.
// -------------------------------------------------------------------
export async function getProjectBudgetGroupsService(projectId: string): Promise<BudgetGroupReportDTO[]> {
  try {
    const access = await requireProjectAccess(projectId);

    const [groups, loggedRows] = await Promise.all([
      getProjectBudgetGroupsRepo(access.project.id),
      // Per person, then pooled here, because a group's spend IS the sum of
      // its people's - and doing it this way needs no second grouped query
      // that could disagree with the membership the groups came back with.
      getLoggedMinutesByUserForProjectRepo(access.project.id),
    ]);

    // Somebody who has logged nothing is absent from that read, so a miss
    // is zero.
    const loggedByUser = new Map(loggedRows.map((row) => [row.userId, row.minutes]));

    return groups.map((group) => {
      const loggedMinutes = group.members.reduce(
        (total, member) => total + (loggedByUser.get(member.userId) ?? 0),
        0,
      );

      return {
        groupId: group.id,
        name: group.name,
        members: group.members.map((member) => ({ userId: member.userId, name: userDisplayName(member) })),
        rollup: budgetProgress(group.budgetMinutes, loggedMinutes),
      };
    });
  } catch (error) {
    throw handleError("getProjectBudgetGroupsService", error);
  }
}

// -------------------------------------------------------------------
// Create a budget group.
//
// `budgetHours` HOLDS MINUTES by the time it arrives - the schema's
// plannedHoursField converted it - so it is written straight into
// `budget_minutes`. The field keeps the form's name on purpose; multiplying
// it again here is the one mistake this pair of units invites.
//
// `position` is not set: the column defaults, and the list read orders by
// position then name, so groups come back alphabetically until somebody
// asks for a reorder. There is deliberately no reorder mutation - see
// CreateBudgetGroupSchema.
// -------------------------------------------------------------------
export async function createBudgetGroupService(requestDTO: CreateBudgetGroupRequestDTO): Promise<string> {
  try {
    const { project } = await requireAdminProject(requestDTO.projectId);

    const now = new Date();

    const group = await addProjectBudgetGroupRepo({
      id: generateId(),
      projectId: project.id,
      name: requestDTO.name,
      budgetMinutes: requestDTO.budgetHours,
      createdAt: now,
      updatedAt: now,
    });

    revalidateProjectViews();

    return group.id;
  } catch (error) {
    throw handleError("createBudgetGroupService", error);
  }
}

// Rename a group or change its pooled minutes. Keyed on both ids in the
// repository, so a group id belonging to another project matches nothing.
export async function updateBudgetGroupService(requestDTO: UpdateBudgetGroupRequestDTO): Promise<void> {
  try {
    const { project } = await requireAdminBudgetGroup(requestDTO.groupId);

    const updated = await updateProjectBudgetGroupRepo(requestDTO.groupId, project.id, {
      name: requestDTO.name,
      // Minutes, despite the field name. See createBudgetGroupService.
      budgetMinutes: requestDTO.budgetHours,
    });

    if (!updated) {
      throw new DisplayErrorMessage("That budget group no longer exists.");
    }

    revalidateProjectViews();
  } catch (error) {
    throw handleError("updateBudgetGroupService", error);
  }
}

// -------------------------------------------------------------------
// Delete a budget group. A real delete, unlike a project or a client.
//
// A group holds no history: its member rows go with it through the
// composite foreign key, and THE TIME THOSE PEOPLE LOGGED STAYS EXACTLY
// WHERE IT IS. It simply stops being counted against a pool and reappears
// as ungrouped on the report, which is why this needs no refusal for a
// group that has been worked against.
// -------------------------------------------------------------------
export async function deleteBudgetGroupService(requestDTO: DeleteBudgetGroupRequestDTO): Promise<void> {
  try {
    const { project } = await requireAdminBudgetGroup(requestDTO.groupId);

    const deleted = await deleteProjectBudgetGroupRepo(requestDTO.groupId, project.id);

    if (deleted === 0) return;

    revalidateProjectViews();
  } catch (error) {
    throw handleError("deleteBudgetGroupService", error);
  }
}

// -------------------------------------------------------------------
// Set exactly who is in one group.
//
// EVERYBODY IN A GROUP MUST BE ON THE PROJECT. The repository deliberately
// does not check that - it would have to drop the strangers silently, and a
// tickbox that comes back unticked with no explanation is worse than a
// refusal. So it is checked here, where the person can be named.
//
// SETTING A LIST IS INHERENTLY A MOVE: one group per person per project is
// a unique index, so adding somebody who is in a sibling group takes them
// out of it. The repository does all three statements in one unit; without
// that first delete this would answer a tickbox with a constraint
// violation.
// -------------------------------------------------------------------
export async function setBudgetGroupMembersService(requestDTO: SetBudgetGroupMembersRequestDTO): Promise<void> {
  try {
    const { project } = await requireAdminBudgetGroup(requestDTO.groupId);

    const members = await getProjectMembersRepo(project.id);
    const memberById = new Map(members.map((member) => [member.userId, member]));

    const strangers = requestDTO.userIds.filter((userId) => !memberById.has(userId));

    if (strangers.length > 0) {
      // Not named, for the reason resolveAssignableUsers gives: an id that
      // is not on the project did not come from this screen, and reporting
      // which of a guessed set exists is an oracle.
      throw new DisplayErrorMessage(
        "Somebody in that group is not on this project. Add them to the project first, then put them in the group.",
      );
    }

    await setProjectBudgetGroupMembersRepo(requestDTO.groupId, project.id, requestDTO.userIds);

    revalidateProjectViews();
  } catch (error) {
    throw handleError("setBudgetGroupMembersService", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// PHASES
// ===================================================================
//
// A phase is a heading with an order - the level Jira did not have - and a
// project's board is one board per phase.
//
// ADMIN OR THE PROJECT'S LEAD, which is the one place in this file that is
// not admin-only. See the header for the reasoning: the admin-only list is
// clients, projects, members and budget groups, and a lead who may create a
// task but not the heading to put it under is a half-power nobody asked
// for. Every function resolves the phase's own project first and authorises
// against that.
//
// AND NONE OF THEM WORKS ON AN ARCHIVED PROJECT. All four go through
// requireProjectStructureAccess, which refuses one and names the act; the
// reasoning is in the file header, under archived projects. Each caller
// passes the phrase for its own act rather than a generic one, because
// "adding a phase to it is no longer possible" is a sentence and "that is
// no longer possible" is a shrug.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Resolve a phase, the project it is in, and whether the caller may
// restructure it. The phase id came from the browser; the project id comes
// off the row, and every write below carries both so a phase belonging to
// somebody else's project matches nothing.
//
// SESSION FIRST, THEN THE ROW, THEN THE ROW'S PROJECT. Nothing was ever
// returned to an anonymous caller - requireProjectStructureAccess is still
// what decides - but reading the phase before resolving the session spends
// a query on somebody who has not proved they are signed in, and the
// session is the cheapest of the three to answer. The resolved user is
// handed down so it is not resolved twice; see requireProjectAccess.
// -------------------------------------------------------------------
async function requirePhaseForStructure(
  phaseId: string,
  act: string,
): Promise<{ access: ProjectAccess; phase: Phase }> {
  const user = await requireUser();

  const phase = await getPhaseRepo(phaseId);

  if (!phase) {
    throw new DisplayErrorMessage("That phase no longer exists.");
  }

  const access = await requireProjectStructureAccess(phase.projectId, act, user);

  return { access, phase };
}

// Add a phase at the end of the project's list. `position` is derived in
// the insert, because reorder is the only thing that decides an order.
export async function createPhaseService(requestDTO: CreatePhaseRequestDTO): Promise<string> {
  try {
    const access = await requireProjectStructureAccess(requestDTO.projectId, "adding a phase to it");

    const now = new Date();

    const phase = await addPhaseRepo({
      id: generateId(),
      projectId: access.project.id,
      name: requestDTO.name,
      createdAt: now,
      updatedAt: now,
    });

    revalidateProjectViews();

    return phase.id;
  } catch (error) {
    throw handleError("createPhaseService", error);
  }
}

export async function renamePhaseService(requestDTO: RenamePhaseRequestDTO): Promise<void> {
  try {
    const { access, phase } = await requirePhaseForStructure(requestDTO.phaseId, "renaming one of its phases");

    const renamed = await renamePhaseRepo(phase.id, access.project.id, requestDTO.name);

    if (!renamed) {
      throw new DisplayErrorMessage("That phase no longer exists.");
    }

    revalidateProjectViews();
  } catch (error) {
    throw handleError("renamePhaseService", error);
  }
}

// -------------------------------------------------------------------
// Reorder a project's phases.
//
// THE FULL ORDERED LIST, and the repository refuses anything that is not
// exactly the project's own phases, each once - inside the same transaction
// that writes them, so a phase created in another tab cannot sneak past the
// check. Undefined back is that refusal, and it is an ordinary outcome
// rather than a fault: a second tab holding a stale board is the common
// case, and the answer is to refresh.
// -------------------------------------------------------------------
export async function reorderPhasesService(requestDTO: ReorderPhasesRequestDTO): Promise<void> {
  try {
    const access = await requireProjectStructureAccess(requestDTO.projectId, "reordering its phases");

    const reordered = await reorderPhasesForProjectRepo(access.project.id, requestDTO.phaseIds);

    if (!reordered) {
      throw new DisplayErrorMessage(
        "That order does not match this project's phases any more. Refresh the page and try again.",
      );
    }

    revalidateProjectViews();
  } catch (error) {
    throw handleError("reorderPhasesService", error);
  }
}

// -------------------------------------------------------------------
// Delete a phase, and REFUSE POLITELY when there is time logged under it.
//
// Deleting a phase cascades to its tasks, and `time_entries` holds those
// tasks ON DELETE RESTRICT - so a phase anybody has logged an hour against
// is refused by Postgres as a foreign key violation. That is billing
// history defending itself and it must not be worked around; what it must
// not do is reach somebody as a constraint error.
//
// SO IT IS ASKED FIRST, AND HANDLED ANYWAY. The read is not a lock:
// somebody can log time between the check and the delete, which is rare and
// entirely possible. On a failure the same question is asked again, and the
// refusal is only claimed if the answer says so - otherwise the original
// error is rethrown, because telling somebody their phase has time logged
// against it when the real problem was the database being unreachable sends
// them looking in the wrong place.
//
// The task count is named in the message as well, since deleting a phase
// takes its cards with it and that is the part nobody expects.
//
// AND IT REFUSES A PHASE WHOSE CARDS CARRY FILES, WHICH IS A DIFFERENT
// KIND OF REFUSAL: not the database defending itself, but this service
// declining to do something it cannot do safely yet.
//
// A POSTGRES CASCADE CANNOT DELETE AN AZURE BLOB. `tasks` is ON DELETE
// CASCADE from `phases` and `task_attachments` is ON DELETE CASCADE from
// `tasks`, so deleting a phase silently removes every attachment ROW
// beneath it and leaves the FILES in blob storage with nothing pointing at
// them. deletePhaseRepo answers with a row count and nothing else, so this
// service never learns which keys it just stranded, and there is no
// reconciliation sweep over the delivery prefix yet - so those files are
// paid for indefinitely and nothing reports them. Time entries RESTRICT,
// but a card with a client's document on it and no logged time deletes
// perfectly cleanly, which puts this on the ordinary path rather than an
// unlucky one.
//
// WHY A REFUSAL AND NOT A CLEANUP. The honest fix is a repository read
// this module does not have: deletePhaseReturningBlobKeysRepo, the exact
// inversion of deleteTaskReturningBlobKeysRepo, which exists in
// tasks.repository.ts for exactly this reason and hands its keys back for
// the caller to clear after the commit. A service may not run its own SQL,
// and composing the two project-wide reads below is enough to ASK the
// question but not to answer it safely - the keys have to be read inside
// the deleting transaction or they are read from rows that are already
// gone. So until that function lands, this refuses: a refusal is visible,
// it loses nothing, and somebody can act on it by removing the files. The
// alternative leaks a client's uploaded documents and says nothing.
//
// THE WINDOW IS NARROWED, NOT CLOSED, and pretending otherwise would be
// the dangerous comment to leave here. Two reads are not a lock, so a file
// uploaded between the check and the delete is orphaned exactly as before
// - and unlike the time-logged race there is no second question to ask
// afterwards, because that delete SUCCEEDS. Only the repository function
// above closes it.
//
// THE COST IS TWO PROJECT-WIDE READS ON A DELETE, and that is the right
// trade: they are the reads the board itself already makes, this runs when
// somebody clicks delete rather than on every render, and the per-phase
// question has no repository read of its own to ask.
// -------------------------------------------------------------------
export async function deletePhaseService(requestDTO: DeletePhaseRequestDTO): Promise<void> {
  try {
    const { access, phase } = await requirePhaseForStructure(requestDTO.phaseId, "deleting one of its phases");

    // Together in one pass, because a phase that is refused for time is
    // usually a phase with files on it too, and asking twice in sequence
    // would put two round trips in front of the commonest refusal.
    const [logged, projectTasks, attachmentCounts] = await Promise.all([
      getPhaseTimeLoggedRepo(phase.id, access.project.id),
      getProjectBoardTasksRepo(access.project.id),
      getAttachmentCountsForProjectRepo(access.project.id),
    ]);

    // Time first: it is the refusal the database would enforce anyway, and
    // the one somebody is most likely to have expected.
    const refusal = phaseDeletionRefusal(phase.name, logged);

    if (refusal) throw new DisplayErrorMessage(refusal);

    const fileRefusal = phaseAttachmentRefusal(
      phase.name,
      attachmentsUnderPhase(phase.id, projectTasks, attachmentCounts),
    );

    if (fileRefusal) throw new DisplayErrorMessage(fileRefusal);

    try {
      await deletePhaseRepo(phase.id, access.project.id);
    } catch (error) {
      const raced = phaseDeletionRefusal(phase.name, await getPhaseTimeLoggedRepo(phase.id, access.project.id));

      if (raced) throw new DisplayErrorMessage(raced);

      throw error;
    }

    revalidateProjectViews();
  } catch (error) {
    throw handleError("deletePhaseService", error);
  }
}
