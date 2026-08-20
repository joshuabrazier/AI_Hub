"use server";

import { revalidatePath } from "next/cache";

import { handleServerApiError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  createTimesheetReportService,
  deleteTimesheetReportService,
  EmptyPeriodError,
} from "./admin-timesheets-report.service";
import {
  CreateTimesheetReportSchema,
  DeleteTimesheetReportSchema,
  type CreateTimesheetReportRequestDTO,
  type DeleteTimesheetReportRequestDTO,
} from "./admin-timesheets-report.types";

// -------------------------------------------------------------------
// Saved report actions.
//
// No role check in either: both services require ADMIN themselves, because an
// action is not the only thing that can call one. A second check here would
// imply the service's own was optional.
// -------------------------------------------------------------------

export async function createTimesheetReportAction(
  request: CreateTimesheetReportRequestDTO,
): Promise<ServerApiResponse<{ id: string | null; unavailable?: true }>> {
  try {
    const parsed = await validateRequest(CreateTimesheetReportSchema, request);
    if (!parsed.success) return parsed.response;

    const { title, ...filters } = parsed.data;

    const result = await createTimesheetReportService(title, filters);

    if ("unavailable" in result) {
      return { success: true, data: { id: null, unavailable: true } };
    }

    revalidatePath(ROUTES.ADMIN_TIMESHEETS_REPORTS, "layout");

    return { success: true, data: { id: result.id } };
  } catch (error) {
    // An empty period is a normal answer, not a fault. Returned as a form
    // error so the dialog says what happened instead of showing a stack-shaped
    // "something went wrong" for a period that simply has no time in it.
    if (error instanceof EmptyPeriodError) {
      return { success: false, formError: error.message };
    }

    return handleServerApiError("createTimesheetReportAction", error);
  }
}

export async function deleteTimesheetReportAction(
  request: DeleteTimesheetReportRequestDTO,
): Promise<ServerApiResponse<{ id: string }>> {
  try {
    const parsed = await validateRequest(DeleteTimesheetReportSchema, request);
    if (!parsed.success) return parsed.response;

    await deleteTimesheetReportService(parsed.data.id);

    revalidatePath(ROUTES.ADMIN_TIMESHEETS_REPORTS, "layout");

    return { success: true, data: { id: parsed.data.id } };
  } catch (error) {
    return handleServerApiError("deleteTimesheetReportAction", error);
  }
}
