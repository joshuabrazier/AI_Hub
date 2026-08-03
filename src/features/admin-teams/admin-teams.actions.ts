"use server";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  addTeamMemberService,
  createTeamService,
  getTeamDetailService,
  getTeamsService,
  removeTeamMemberService,
  updateTeamMemberRoleService,
  updateTeamService,
} from "./admin-teams.service";
import {
  AddTeamMemberRequestDTO,
  AddTeamMemberSchema,
  CreateTeamRequestDTO,
  CreateTeamSchema,
  GetTeamDetailRequestDTO,
  GetTeamDetailSchema,
  RemoveTeamMemberRequestDTO,
  RemoveTeamMemberSchema,
  TeamDetailResponseDTO,
  TeamResponseDTO,
  UpdateTeamMemberRoleRequestDTO,
  UpdateTeamMemberRoleSchema,
  UpdateTeamRequestDTO,
  UpdateTeamSchema,
} from "./admin-teams.types";

// -------------------------------------------------------------------
// Admin team actions
//
// Each one validates its input and hands off to the service. The role check
// here is the outer gate only - the service repeats it, because an action is
// not the only thing that can call a service.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Get Teams
// -------------------------------------------------------------------
export async function getTeamsAction(): Promise<ServerApiResponse<TeamResponseDTO[]>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const teams = await getTeamsService();

    return {
      success: true,
      data: teams,
    } satisfies ServerApiResponse<TeamResponseDTO[]>;
  } catch (error) {
    return handleServerApiError("getTeamsAction", error);
  }
}

// -------------------------------------------------------------------
// Get Team Detail (one team, its members, and who can still be added)
// -------------------------------------------------------------------
export async function getTeamDetailAction(
  requestDTO: GetTeamDetailRequestDTO,
): Promise<ServerApiResponse<TeamDetailResponseDTO>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(GetTeamDetailSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const detail = await getTeamDetailService(validatedRequest.data.teamId);

    return {
      success: true,
      data: detail,
    } satisfies ServerApiResponse<TeamDetailResponseDTO>;
  } catch (error) {
    return handleServerApiError("getTeamDetailAction", error);
  }
}

// -------------------------------------------------------------------
// Create Team
// -------------------------------------------------------------------
export async function createTeamAction(requestDTO: CreateTeamRequestDTO): Promise<ServerApiResponse<string>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(CreateTeamSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const teamId = await createTeamService(validatedRequest.data);

    return {
      success: true,
      data: teamId,
    } satisfies ServerApiResponse<string>;
  } catch (error) {
    return handleServerApiError("createTeamAction", error);
  }
}

// -------------------------------------------------------------------
// Update Team
// -------------------------------------------------------------------
export async function updateTeamAction(
  requestDTO: UpdateTeamRequestDTO,
): Promise<ServerApiResponse<string | undefined>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(UpdateTeamSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const teamId = await updateTeamService(validatedRequest.data);

    return {
      success: true,
      data: teamId,
    } satisfies ServerApiResponse<string | undefined>;
  } catch (error) {
    return handleServerApiError("updateTeamAction", error);
  }
}

// -------------------------------------------------------------------
// Add Team Member (an authorization change - audited in the service)
// -------------------------------------------------------------------
export async function addTeamMemberAction(requestDTO: AddTeamMemberRequestDTO): Promise<ServerApiResponse<null>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(AddTeamMemberSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await addTeamMemberService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("addTeamMemberAction", error);
  }
}

// -------------------------------------------------------------------
// Update Team Member Role (an authorization change - audited in the service)
// -------------------------------------------------------------------
export async function updateTeamMemberRoleAction(
  requestDTO: UpdateTeamMemberRoleRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(UpdateTeamMemberRoleSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await updateTeamMemberRoleService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("updateTeamMemberRoleAction", error);
  }
}

// -------------------------------------------------------------------
// Remove Team Member (an authorization change - audited in the service)
// -------------------------------------------------------------------
export async function removeTeamMemberAction(
  requestDTO: RemoveTeamMemberRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(RemoveTeamMemberSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await removeTeamMemberService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("removeTeamMemberAction", error);
  }
}
