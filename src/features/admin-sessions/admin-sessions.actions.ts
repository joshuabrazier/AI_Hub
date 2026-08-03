"use server";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { STAFF_ROLES } from "@/lib/data/kysely-database-types";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  CreateClassSessionRequestDTO,
  CreateClassSessionSchema,
  SessionsPageData,
  UpdateClassSessionRequestDTO,
  UpdateClassSessionSchema,
} from "./admin-sessions.types";
import {
  createClassSessionService,
  getSessionsPageDataService,
  updateClassSessionService,
} from "./admin-sessions.service";

// -------------------------------------------------------------------
// Session actions
//
// The role check here is the OUTER gate only - it keeps members out. Which
// sessions the caller may see or touch is decided in the service, from the
// session, against the owning team of the session's class.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Get Sessions (Sessions tab)
// -------------------------------------------------------------------
export async function getSessionsPageAction(): Promise<ServerApiResponse<SessionsPageData>> {
  try {
    await requireUserRole(STAFF_ROLES);

    const data = await getSessionsPageDataService();

    return {
      success: true,
      data,
    } satisfies ServerApiResponse<SessionsPageData>;
  } catch (error) {
    return handleServerApiError("getSessionsPageAction", error);
  }
}

// -------------------------------------------------------------------
// Create Session
// -------------------------------------------------------------------
export async function createClassSessionAction(
  requestDTO: CreateClassSessionRequestDTO,
): Promise<ServerApiResponse<string>> {
  try {
    await requireUserRole(STAFF_ROLES);

    const validatedRequest = await validateRequest(CreateClassSessionSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const sessionId = await createClassSessionService(validatedRequest.data);

    return {
      success: true,
      data: sessionId,
    } satisfies ServerApiResponse<string>;
  } catch (error) {
    return handleServerApiError("createClassSessionAction", error);
  }
}

// -------------------------------------------------------------------
// Update Session
// -------------------------------------------------------------------
export async function updateClassSessionAction(
  requestDTO: UpdateClassSessionRequestDTO,
): Promise<ServerApiResponse<string | undefined>> {
  try {
    await requireUserRole(STAFF_ROLES);

    const validatedRequest = await validateRequest(UpdateClassSessionSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const sessionId = await updateClassSessionService(validatedRequest.data);

    return {
      success: true,
      data: sessionId,
    } satisfies ServerApiResponse<string | undefined>;
  } catch (error) {
    return handleServerApiError("updateClassSessionAction", error);
  }
}
