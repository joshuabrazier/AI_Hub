"use server";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  createClosureDayService,
  deleteClosureDayService,
  getClosureDaysService,
} from "./admin-closure-days.service";
import {
  ClosureDayDTO,
  CreateClosureDayRequestDTO,
  CreateClosureDaySchema,
  DeleteClosureDayRequestDTO,
  DeleteClosureDaySchema,
} from "./admin-closure-days.types";

// -------------------------------------------------------------------
// Get closure days
// -------------------------------------------------------------------
export async function getClosureDaysAction(): Promise<ServerApiResponse<ClosureDayDTO[]>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const days = await getClosureDaysService();

    return { success: true, data: days } satisfies ServerApiResponse<ClosureDayDTO[]>;
  } catch (error) {
    return handleServerApiError("getClosureDaysAction", error);
  }
}

// -------------------------------------------------------------------
// Add a closure day
// -------------------------------------------------------------------
export async function createClosureDayAction(
  requestDTO: CreateClosureDayRequestDTO,
): Promise<ServerApiResponse<string>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(CreateClosureDaySchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const id = await createClosureDayService(validatedRequest.data);

    return { success: true, data: id } satisfies ServerApiResponse<string>;
  } catch (error) {
    return handleServerApiError("createClosureDayAction", error);
  }
}

// -------------------------------------------------------------------
// Remove a closure day
// -------------------------------------------------------------------
export async function deleteClosureDayAction(
  requestDTO: DeleteClosureDayRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(DeleteClosureDaySchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await deleteClosureDayService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("deleteClosureDayAction", error);
  }
}
