"use server";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import { cancelBookingService, getPortalBookingsService } from "./portal-bookings.service";
import { CancelBookingRequestDTO, CancelBookingSchema, PortalBookingsResponseDTO } from "./portal-bookings.types";

// -------------------------------------------------------------------
// Member portal booking actions
//
// Each one validates its input and hands off to the service. The role check
// here is the outer gate only - the service repeats it, because an action is
// not the only thing that can call a service.
//
// The attendee id in the cancel request is shape-checked here and nothing
// more. Whether the caller may act on it is decided in the service, against
// the session.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Get the signed-in member's own upcoming bookings.
// -------------------------------------------------------------------
export async function getPortalBookingsAction(): Promise<ServerApiResponse<PortalBookingsResponseDTO>> {
  try {
    await requireUserRole([USER_ROLES.MEMBER]);

    const bookings = await getPortalBookingsService();

    return {
      success: true,
      data: bookings,
    } satisfies ServerApiResponse<PortalBookingsResponseDTO>;
  } catch (error) {
    return handleServerApiError("getPortalBookingsAction", error);
  }
}

// -------------------------------------------------------------------
// Cancel one of the signed-in member's own booked places.
// -------------------------------------------------------------------
export async function cancelBookingAction(requestDTO: CancelBookingRequestDTO): Promise<ServerApiResponse<null>> {
  try {
    await requireUserRole([USER_ROLES.MEMBER]);

    const validatedRequest = await validateRequest(CancelBookingSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await cancelBookingService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("cancelBookingAction", error);
  }
}
