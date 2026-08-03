"use server";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import { getPortalWeekService } from "./portal-schedule.service";
import { GetPortalWeekRequestDTO, GetPortalWeekSchema, PortalWeekResponseDTO } from "./portal-schedule.types";

// -------------------------------------------------------------------
// The signed-in member's schedule for the week containing `weekStartIso`.
// Called as they page between weeks.
//
// The date is the whole request. Whose week it is comes from the session
// inside the service, so there is nothing here to point at another member.
// -------------------------------------------------------------------
export async function getPortalWeekAction(
  requestDTO: GetPortalWeekRequestDTO,
): Promise<ServerApiResponse<PortalWeekResponseDTO>> {
  try {
    await requireUserRole([USER_ROLES.MEMBER]);

    const validatedRequest = await validateRequest(GetPortalWeekSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const week = await getPortalWeekService(validatedRequest.data.weekStartIso);

    return {
      success: true,
      data: week,
    } satisfies ServerApiResponse<PortalWeekResponseDTO>;
  } catch (error) {
    return handleServerApiError("getPortalWeekAction", error);
  }
}
