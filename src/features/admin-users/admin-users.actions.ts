"use server";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  addAdminUserInvitationService,
  cancelAdminInvitationService,
  getAdminUsersService,
  getInvitableTeamsService,
  resetUserTwoFactorService,
  updateAdminUserService,
} from "./admin-users.service";
import {
  AddAdminUserInvitationRequestDTO,
  AddAdminUserInvitationSchema,
  AdminUserResponseDTO,
  CancelAdminUserInvitationRequestDTO,
  CancelAdminUserInvitationSchema,
  InvitableTeamDTO,
  ResetUserTwoFactorRequestDTO,
  ResetUserTwoFactorSchema,
  UpdateAdminUserRequestDTO,
  UpdateAdminUserSchema,
} from "./admin-users.types";

// -------------------------------------------------------------------
// Admin Users actions.
//
// Each one guards, validates with Zod, then calls a service that guards again.
// The service call always takes the VALIDATED data, never the raw request:
// passing the raw object through would make the schema decorative, since Zod
// strips unknown keys and coerces nothing unless its output is what is used.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Everyone with an account, plus pending invitations (admin only).
// -------------------------------------------------------------------
export async function getAdminUsersAction(): Promise<ServerApiResponse<AdminUserResponseDTO[]>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const users = await getAdminUsersService();

    return { success: true, data: users } satisfies ServerApiResponse<AdminUserResponseDTO[]>;
  } catch (error) {
    return handleServerApiError("getAdminUsersAction", error);
  }
}

// -------------------------------------------------------------------
// The teams an invitation can place somebody into (admin only).
// -------------------------------------------------------------------
export async function getInvitableTeamsAction(): Promise<ServerApiResponse<InvitableTeamDTO[]>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const teams = await getInvitableTeamsService();

    return { success: true, data: teams } satisfies ServerApiResponse<InvitableTeamDTO[]>;
  } catch (error) {
    return handleServerApiError("getInvitableTeamsAction", error);
  }
}

// -------------------------------------------------------------------
// Update a user's role / active status (admin only).
// -------------------------------------------------------------------
export async function updateAdminUserAction(
  requestDTO: UpdateAdminUserRequestDTO,
): Promise<ServerApiResponse<string | undefined>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(UpdateAdminUserSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const userId = await updateAdminUserService(validatedRequest.data);

    return { success: true, data: userId } satisfies ServerApiResponse<string | undefined>;
  } catch (error) {
    return handleServerApiError("updateAdminUserAction", error);
  }
}

// -------------------------------------------------------------------
// Clear somebody's app-level second factor so they can enrol again
// (admin only).
//
// For the person who deleted their authenticator app or lost the phone
// and never saved their backup codes. There is deliberately no
// self-service equivalent - one would be a way around the factor - so
// this is the only route back, and it is audited naming both parties.
// -------------------------------------------------------------------
export async function resetUserTwoFactorAction(
  requestDTO: ResetUserTwoFactorRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(ResetUserTwoFactorSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await resetUserTwoFactorService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("resetUserTwoFactorAction", error);
  }
}

// -------------------------------------------------------------------
// Cancel a pending invitation (admin only).
// -------------------------------------------------------------------
export async function cancelAdminInvitationAction(
  requestDTO: CancelAdminUserInvitationRequestDTO,
): Promise<ServerApiResponse<string | undefined>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(CancelAdminUserInvitationSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const userInvitationId = await cancelAdminInvitationService(validatedRequest.data);

    return { success: true, data: userInvitationId } satisfies ServerApiResponse<string | undefined>;
  } catch (error) {
    return handleServerApiError("cancelAdminInvitationAction", error);
  }
}

// -------------------------------------------------------------------
// Invite somebody (admin only).
//
// The inviter is taken from the guard's return value - the session - so the
// invitation records who actually sent it.
// -------------------------------------------------------------------
export async function addAdminUserInvitationAction(
  requestDTO: AddAdminUserInvitationRequestDTO,
): Promise<ServerApiResponse<string | undefined>> {
  try {
    const user = await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(AddAdminUserInvitationSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const userInvitationId = await addAdminUserInvitationService(validatedRequest.data, user.id);

    return { success: true, data: userInvitationId } satisfies ServerApiResponse<string | undefined>;
  } catch (error) {
    return handleServerApiError("addAdminUserInvitationAction", error);
  }
}
