"use server";

import { requireUser } from "@/lib/auth/session-auth-server";
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
// Account actions, for whoever is signed in
//
// Each one validates its input and hands off to the service. The check here is
// the outer gate only - the service repeats it, because an action is not the
// only thing that can call a service.
//
// requireUser RATHER THAN A ROLE, matching the service. These were
// requireUserRole([MEMBER]), which would have refused an administrator's own
// save the moment the page was mounted in the admin area - a screen that reads
// fine and then rejects the button.
//
// Neither action takes a user id. The account being read or written is always
// the session's, resolved inside the service.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Get the signed-in person's own account details.
// -------------------------------------------------------------------
export async function getPortalAccountAction(): Promise<ServerApiResponse<PortalAccountResponseDTO>> {
  try {
    await requireUser();

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
// Update the signed-in person's own account details.
// -------------------------------------------------------------------
export async function updatePortalAccountAction(
  requestDTO: UpdatePortalAccountRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(UpdatePortalAccountSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await updatePortalAccountService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("updatePortalAccountAction", error);
  }
}
