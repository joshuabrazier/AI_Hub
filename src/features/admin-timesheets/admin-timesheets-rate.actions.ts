"use server";

import { revalidatePath } from "next/cache";

import { handleServerApiError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import { deleteStaffRateService, saveStaffRateService } from "./admin-timesheets-rate.service";
import {
  DeleteStaffRateSchema,
  SaveStaffRateSchema,
  type DeleteStaffRateRequestDTO,
  type SaveStaffRateInputDTO,
} from "./admin-timesheets-rate.types";

// -------------------------------------------------------------------
// Rate actions. Both services require ADMIN themselves.
//
// 'layout' revalidates reach the dynamic /staff/[personId] child, which is
// where rates are edited - a page-typed revalidate does not.
//
// Every timesheet screen values its hours from these rows, so all of them are
// stale once a rate moves. Revalidating the two layouts covers the four views
// plus the person pages under them.
// -------------------------------------------------------------------
function revalidateTimesheets(): void {
  revalidatePath(ROUTES.ADMIN_TIMESHEETS, "layout");
  revalidatePath(ROUTES.ADMIN_TIMESHEETS_STAFF, "layout");
}

export async function saveStaffRateAction(
  request: SaveStaffRateInputDTO,
): Promise<ServerApiResponse<{ personId: string }>> {
  try {
    const parsed = await validateRequest(SaveStaffRateSchema, request);
    if (!parsed.success) return parsed.response;

    await saveStaffRateService(parsed.data);

    revalidateTimesheets();

    return { success: true, data: { personId: parsed.data.personId } };
  } catch (error) {
    return handleServerApiError("saveStaffRateAction", error);
  }
}

export async function deleteStaffRateAction(
  request: DeleteStaffRateRequestDTO,
): Promise<ServerApiResponse<{ id: string }>> {
  try {
    const parsed = await validateRequest(DeleteStaffRateSchema, request);
    if (!parsed.success) return parsed.response;

    await deleteStaffRateService(parsed.data.id);

    revalidateTimesheets();

    return { success: true, data: { id: parsed.data.id } };
  } catch (error) {
    return handleServerApiError("deleteStaffRateAction", error);
  }
}
