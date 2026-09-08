"use server";

import { requireUser } from "@/lib/auth/session-auth-server";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  addProjectMemberService,
  archiveProjectService,
  createBudgetGroupService,
  createClientService,
  createPhaseService,
  createProjectService,
  deactivateClientService,
  deleteBudgetGroupService,
  deletePhaseService,
  markProjectBudgetAssignedService,
  removeProjectMemberService,
  renamePhaseService,
  reorderPhasesService,
  setBudgetGroupMembersService,
  setProjectMembersService,
  updateBudgetGroupService,
  updateClientService,
  updateProjectMemberService,
  updateProjectService,
} from "./delivery-setup.service";
import {
  AddProjectMemberRequest,
  AddProjectMemberSchema,
  ArchiveProjectRequest,
  ArchiveProjectSchema,
  CreateBudgetGroupRequestDTO,
  CreateBudgetGroupSchema,
  CreateClientRequestDTO,
  CreateClientSchema,
  CreatePhaseRequestDTO,
  CreatePhaseSchema,
  CreateProjectRequestDTO,
  CreateProjectSchema,
  DeactivateClientRequest,
  DeactivateClientSchema,
  DeleteBudgetGroupRequestDTO,
  DeleteBudgetGroupSchema,
  DeletePhaseRequestDTO,
  DeletePhaseSchema,
  MarkProjectBudgetAssignedRequestDTO,
  MarkProjectBudgetAssignedSchema,
  RemoveProjectMemberRequest,
  RemoveProjectMemberSchema,
  RenamePhaseRequestDTO,
  RenamePhaseSchema,
  ReorderPhasesRequestDTO,
  ReorderPhasesSchema,
  SetBudgetGroupMembersRequestDTO,
  SetBudgetGroupMembersSchema,
  SetProjectMembersRequestDTO,
  SetProjectMembersSchema,
  UpdateBudgetGroupRequestDTO,
  UpdateBudgetGroupSchema,
  UpdateClientRequestDTO,
  UpdateClientSchema,
  UpdateProjectMemberRequest,
  UpdateProjectMemberSchema,
  UpdateProjectRequestDTO,
  UpdateProjectSchema,
} from "./delivery.types";

// -------------------------------------------------------------------
// ===================================================================
// DELIVERY SETUP ACTIONS
// ===================================================================
//
// Clients, projects, membership, budget groups and phases. Each one
// validates its input against the committed schema and hands off to the
// service. NOTHING HERE DECIDES ANYTHING.
//
// THE requireUser IS THE OUTER GATE ONLY. Every service below opens with
// its own guard - requireUserRole([ADMIN]) for clients, projects,
// membership and budget groups, and admin-or-lead resolved off a
// `project_members` row for the phases - and re-resolves the row against
// the session before touching it. An action is not the only caller a
// service has, so the gate that matters is the one inside it.
//
// WHY NOT THE ROLE CHECK HERE, when admin-teams.actions.ts does exactly
// that: this file's mutations do not share one gate. Clients and projects
// are admin-only; the four phase mutations are admin OR the project's
// lead, which cannot be known without reading a membership row. Copying
// half of that into the action would put two thirds of an authorization
// rule in a second place and leave the phase actions guarded by a check
// that is not their check. requireUser is the honest outer gate: signed
// in, profile complete, second factor satisfied if the app asks for one.
//
// NO revalidatePath HERE EITHER. Every service that writes calls
// revalidateProjectViews or revalidateClientViews itself, covering all
// three areas the projects screens are mounted in. A second call here
// would refresh the same paths twice per save, and would silently be the
// only refresh a service-only caller did NOT get.
//
// HOURS IN, MINUTES ON. `budgetHours` on the two budget group schemas is
// converted by plannedHoursField during validateRequest, so what reaches
// the service already holds MINUTES. That is why every parameter below is
// typed against the REQUEST DTO and never the Input DTO - see the note in
// delivery.types.ts: an Input DTO names the shape a FORM holds, and on any
// coerced field its compile-time type is `unknown`, so typing an action
// against one would accept anything and prove nothing.
//
// THERE ARE NO READ ACTIONS IN THIS FILE, deliberately. Every read the
// setup screens need - the client list, the client picker, a project's
// detail, its budget groups, "my projects" - is fetched by a server
// component that renders it, so an action would be a second entry point
// to the same data for no gain. The one read that would earn one is
// getClientDetailService, because the client LIST leaves notes out on
// purpose and an edit dialog opened from it has nowhere to get them; it is
// still left out, because that service answers notFound() for a missing
// id. That is right for a page read and wrong for a fetch-on-demand
// caller: notFound() thrown inside an action escapes through
// unstable_rethrow and replaces the SCREEN with the not-found page, so a
// client somebody else has just retired would look like a broken app
// rather than a stale dialog. It needs a write-shaped refusal in the
// service before an action could expose it, and that is a finding about
// the service rather than something to work around here.
//
// THE FIVE NARROW MUTATIONS ARE NOW HERE - retire a client, archive a
// project, and add, change or remove ONE member. They were absent while
// their request shapes were placeholder types declared inside the service
// with no validator; delivery.types.ts now carries a schema for each, so
// there is something to validate at the boundary and nothing left to
// declare in this file.
//
// THEY OVERLAP THE WHOLE-FORM MUTATIONS ON PURPOSE. updateClientAction can
// already retire through `isActive` and updateProjectAction can already
// archive through `status`, and setProjectMembersAction posts the whole
// member set - but each of those carries every other field with it, so a
// form read ten minutes ago reverts somebody else's edit as a side effect
// of a button that says "deactivate", or drops the nine members it was not
// told about. A request naming ONE thing cannot do that. Which one a
// screen should use is a question about what the person pressed, not about
// what is cheapest to send.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// ===================================================================
// CLIENTS
// ===================================================================
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Create a client from the client screen.
//
// Returns the new id so the caller can open it. A name that already
// exists comes back as a refusal in `formError`, not as a reused client:
// the create-or-reuse behaviour belongs to the project setup flow, and
// the service explains why the two forms differ.
// -------------------------------------------------------------------
export async function createClientAction(requestDTO: CreateClientRequestDTO): Promise<ServerApiResponse<string>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(CreateClientSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const clientId = await createClientService(validatedRequest.data);

    return { success: true, data: clientId } satisfies ServerApiResponse<string>;
  } catch (error) {
    return handleServerApiError("createClientAction", error);
  }
}

// -------------------------------------------------------------------
// Rename a client, edit its notes, or retire and restore it.
//
// `isActive` is the soft delete and it travels on this form, so this is
// also the retire and the restore path. There is no delete to add: a
// project holds its client ON DELETE RESTRICT so that removing one cannot
// take billing history with it.
// -------------------------------------------------------------------
export async function updateClientAction(requestDTO: UpdateClientRequestDTO): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(UpdateClientSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await updateClientService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("updateClientAction", error);
  }
}

// -------------------------------------------------------------------
// Retire a client, and nothing else about it.
//
// The narrow version of the `isActive` field on the form above, for the
// button that only means "we have stopped working with them". A retired
// client is out of every picker and off the default list; nothing is
// deleted, because projects hold their client ON DELETE RESTRICT so that
// removing one cannot take billing history with it.
//
// A client already retired comes back successful with nothing recorded -
// two tabs racing produce exactly that, and the service says so.
// -------------------------------------------------------------------
export async function deactivateClientAction(requestDTO: DeactivateClientRequest): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(DeactivateClientSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await deactivateClientService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("deactivateClientAction", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// PROJECTS
// ===================================================================
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Create a project, and its client if that is what the combobox asked
// for. The union in `client` is what makes "picked one" and "typed a new
// name" impossible to confuse; the service resolves it.
//
// The new project has no members, no phases and no budget groups, so the
// caller runs setProjectMembersAction and the phase and group actions
// next. Returns the id it needs to do that.
// -------------------------------------------------------------------
export async function createProjectAction(requestDTO: CreateProjectRequestDTO): Promise<ServerApiResponse<string>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(CreateProjectSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const projectId = await createProjectService(validatedRequest.data);

    return { success: true, data: projectId } satisfies ServerApiResponse<string>;
  } catch (error) {
    return handleServerApiError("createProjectAction", error);
  }
}

// -------------------------------------------------------------------
// Edit a project: title, description, billable, status.
//
// `status` is on the schema and `archived` is one of its values, so this
// CAN archive - but the edit form is not the archive button, and
// archiveProjectAction below is. The client is deliberately absent from
// both: moving a project to another client would re-attribute every hour
// already logged against it.
// -------------------------------------------------------------------
export async function updateProjectAction(requestDTO: UpdateProjectRequestDTO): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(UpdateProjectSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await updateProjectService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("updateProjectAction", error);
  }
}

// -------------------------------------------------------------------
// Archive a project. THE SOFT DELETE, and there is no hard one to add:
// time entries hold their task ON DELETE RESTRICT, so a project with any
// hours logged against it cannot be removed, and one without them still
// should not be - "we did not end up doing this" is part of the record.
//
// Membership survives it, so restoring the project brings back the team
// that was on it. Restoring is updateProjectAction with a live status:
// there is no unarchive action, because coming back is a decision about
// which status a project should have now rather than the undo of this one.
// -------------------------------------------------------------------
export async function archiveProjectAction(requestDTO: ArchiveProjectRequest): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(ArchiveProjectSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await archiveProjectService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("archiveProjectAction", error);
  }
}

// -------------------------------------------------------------------
// Stop the one-time "assign your budget" nudge.
//
// Idempotent by construction - the repository only writes the timestamp
// while it is still null - so a second click, or two tabs finishing setup
// together, is a no-op rather than an error worth reporting.
// -------------------------------------------------------------------
export async function markProjectBudgetAssignedAction(
  requestDTO: MarkProjectBudgetAssignedRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(MarkProjectBudgetAssignedSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await markProjectBudgetAssignedService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("markProjectBudgetAssignedAction", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// PROJECT MEMBERSHIP
// ===================================================================
//
// AN AUTHORIZATION CHANGE. A membership row is what lets somebody see a
// project at all, `isLead` is what lets them change its structure, and
// `rateBand` is what the client is charged for their hours. The service
// checks every account is assignable, writes the set in one transaction
// and audits the people who moved, naming both parties.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Replace a project's WHOLE member set.
//
// The set rather than deltas, and the schema is what makes that possible:
// the failure mode of a delta is somebody removed on screen who is still
// in the table because one request of three was dropped.
// -------------------------------------------------------------------
export async function setProjectMembersAction(
  requestDTO: SetProjectMembersRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(SetProjectMembersSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await setProjectMembersService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("setProjectMembersAction", error);
  }
}

// -------------------------------------------------------------------
// ONE PERSON AT A TIME: the three narrow membership mutations.
//
// The set above is what the setup FORM posts. These are for the places
// where the act really is about one person - the "add somebody" row, the
// band on one member, the remove button beside their name - and what they
// give that a set cannot is the thing a set is worst at: a request naming
// one person cannot drop the other nine because the form was built from a
// read taken ten minutes ago.
//
// SAME GATE AS THE SET, and it is still not here. All three services open
// with requireAdminProject, which is requireUserRole([ADMIN]) plus the
// project resolved off its own row; a project that has gone comes back as
// a sentence, not as a fault. None of the two ids either of these carries
// is proof of anything.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Put one person on a project.
//
// Somebody already on it is left EXACTLY as they were and this comes back
// successful - the service will not let a re-add quietly change the rate
// band the client is charged or hand out a lead's editing rights. Use
// updateProjectMemberAction when a change is what is meant.
// -------------------------------------------------------------------
export async function addProjectMemberAction(requestDTO: AddProjectMemberRequest): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(AddProjectMemberSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await addProjectMemberService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("addProjectMemberAction", error);
  }
}

// -------------------------------------------------------------------
// Change what one person is on a project: the lead flag, the band, both.
//
// The same four fields as the add, on a schema of its own name, because
// the two services answer differently when the row is not what they
// expected: an add that finds one does nothing, and this one says "that
// person is not on this project". Changing a band does not restate work
// already logged - the rates that reach an invoice were snapshotted onto
// each time entry when the time was logged.
// -------------------------------------------------------------------
export async function updateProjectMemberAction(
  requestDTO: UpdateProjectMemberRequest,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(UpdateProjectMemberSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await updateProjectMemberService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("updateProjectMemberAction", error);
  }
}

// -------------------------------------------------------------------
// Take one person off a project.
//
// It clears their open task assignments and their budget group place in
// the same transaction, which is the service's doing and the reason this
// is not a plain delete. Somebody who was not on the project comes back
// successful: two tabs racing produce exactly that, and there is nothing
// to undo.
// -------------------------------------------------------------------
export async function removeProjectMemberAction(
  requestDTO: RemoveProjectMemberRequest,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(RemoveProjectMemberSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await removeProjectMemberService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("removeProjectMemberAction", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// BUDGET GROUPS
// ===================================================================
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Create a pooled budget group. Returns its id, because the group is
// created before its people are picked and setBudgetGroupMembersAction
// needs it.
//
// `budgetHours` arrives as hours from the form and reaches the service as
// MINUTES, converted once by the schema. Do not multiply it again.
// -------------------------------------------------------------------
export async function createBudgetGroupAction(
  requestDTO: CreateBudgetGroupRequestDTO,
): Promise<ServerApiResponse<string>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(CreateBudgetGroupSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const groupId = await createBudgetGroupService(validatedRequest.data);

    return { success: true, data: groupId } satisfies ServerApiResponse<string>;
  } catch (error) {
    return handleServerApiError("createBudgetGroupAction", error);
  }
}

// -------------------------------------------------------------------
// Rename a group or change its pooled minutes.
//
// The group id is all this carries, which is all the form has. The
// service resolves the project off the group row rather than trusting a
// project id sent alongside it.
// -------------------------------------------------------------------
export async function updateBudgetGroupAction(
  requestDTO: UpdateBudgetGroupRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(UpdateBudgetGroupSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await updateBudgetGroupService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("updateBudgetGroupAction", error);
  }
}

// -------------------------------------------------------------------
// Delete a budget group. A real delete, unlike a project or a client: a
// group holds no history, and the time its people logged stays exactly
// where it is and reappears as ungrouped on the report.
// -------------------------------------------------------------------
export async function deleteBudgetGroupAction(
  requestDTO: DeleteBudgetGroupRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(DeleteBudgetGroupSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await deleteBudgetGroupService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("deleteBudgetGroupAction", error);
  }
}

// -------------------------------------------------------------------
// Set exactly who is in one group.
//
// The whole set again, and setting it is inherently a move: one group per
// person per project is a unique index, so ticking somebody who is in a
// sibling group takes them out of it. Somebody who is not on the project
// at all is refused in words by the service.
// -------------------------------------------------------------------
export async function setBudgetGroupMembersAction(
  requestDTO: SetBudgetGroupMembersRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(SetBudgetGroupMembersSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await setBudgetGroupMembersService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("setBudgetGroupMembersAction", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// PHASES
// ===================================================================
//
// THE FOUR ADMIN-OR-LEAD MUTATIONS. Their gate is not the role check the
// rest of this file's services make, and it is not knowable without a
// membership read, so it stays entirely in the service: a non-member gets
// notFound(), and an ordinary member of the project is told that only a
// lead or an administrator can change its phases.
// -------------------------------------------------------------------

// Add a phase at the end of the project's list. Returns its id; position
// is derived in the insert, because reorder is the only thing that
// decides an order.
export async function createPhaseAction(requestDTO: CreatePhaseRequestDTO): Promise<ServerApiResponse<string>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(CreatePhaseSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const phaseId = await createPhaseService(validatedRequest.data);

    return { success: true, data: phaseId } satisfies ServerApiResponse<string>;
  } catch (error) {
    return handleServerApiError("createPhaseAction", error);
  }
}

// Rename a phase. The phase id is all this carries; the service resolves
// the project off the row and keys the write on both.
export async function renamePhaseAction(requestDTO: RenamePhaseRequestDTO): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(RenamePhaseSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await renamePhaseService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("renamePhaseAction", error);
  }
}

// -------------------------------------------------------------------
// Reorder a project's phases, as the FULL ordered list.
//
// Idempotent: replaying the list produces the same order, so two people
// dragging at once end with the last save rather than with an interleave.
// An order that no longer matches the project's phases comes back as
// "refresh the page and try again" rather than as a fault.
// -------------------------------------------------------------------
export async function reorderPhasesAction(requestDTO: ReorderPhasesRequestDTO): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(ReorderPhasesSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await reorderPhasesService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("reorderPhasesAction", error);
  }
}

// -------------------------------------------------------------------
// Delete a phase, and its cards with it.
//
// A phase with time logged under it is refused in a sentence naming the
// hours, before Postgres refuses it as a foreign key violation. That
// refusal arrives here as an ordinary `formError`, which is why the
// caller must show it rather than treating a failed delete as a fault.
// -------------------------------------------------------------------
export async function deletePhaseAction(requestDTO: DeletePhaseRequestDTO): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(DeletePhaseSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await deletePhaseService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("deletePhaseAction", error);
  }
}
