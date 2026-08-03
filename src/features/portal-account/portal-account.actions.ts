"use server";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import { getPortalAccountService, updatePortalAccountService } from "./portal-account.service";
import {
  PortalAccountResponseDTO,
  UpdatePortalAccountRequestDTO,
  UpdatePortalAccountSchema,
} from "./portal-account.types";

// -------------------------------------------------------------------
// Member portal account actions
//
// Each one validates its input and hands off to the service. The role check
// here is the outer gate only - the service repeats it, because an action is
// not the only thing that can call a service.
//
// Neither action takes a user id. The account being read or written is always
// the session's, resolved inside the service.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Get the signed-in member's own account details.
// -------------------------------------------------------------------
export async function getPortalAccountAction(): Promise<ServerApiResponse<PortalAccountResponseDTO>> {
  try {
    await requireUserRole([USER_ROLES.MEMBER]);

    const account = await getPortalAccountService();

    return {
      success: true,
      data: account,
    } satisfies ServerApiResponse<PortalAccountResponseDTO>;
  } catch (error) {
    return handleServerApiError("getPortalAccountAction", error);
  }
}

// -------------------------------------------------------------------
// Update the signed-in member's own account details.
// -------------------------------------------------------------------
export async function updatePortalAccountAction(
  requestDTO: UpdatePortalAccountRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUserRole([USER_ROLES.MEMBER]);

    const validatedRequest = await validateRequest(UpdatePortalAccountSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await updatePortalAccountService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("updatePortalAccountAction", error);
  }
}
