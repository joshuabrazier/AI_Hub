"use server";

import { revalidatePath } from "next/cache";

import { handleServerApiError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import { generateTimesheetSummaryService } from "./admin-timesheets-ai.service";
import {
  GenerateTimesheetSummarySchema,
  type GenerateTimesheetSummaryRequestDTO,
  type TimesheetSummaryDTO,
} from "./admin-timesheets-ai.types";

// -------------------------------------------------------------------
// Generate a period summary.
//
// No role check here beyond what the service does, and that is deliberate
// rather than an omission: generateTimesheetSummaryService requires ADMIN
// itself, because a page can call it directly and an action is not the only
// way in. Adding a second check here would suggest the service's own was
// optional.
//
// The summary comes back in the response rather than being read from a
// revalidated page, so the panel can show it immediately. The revalidate is
// for the OTHER screens: both timesheet views cache their own summary and
// either may now be looking at a row this call replaced.
// -------------------------------------------------------------------
export async function generateTimesheetSummaryAction(
  request: GenerateTimesheetSummaryRequestDTO,
): Promise<ServerApiResponse<TimesheetSummaryDTO>> {
  try {
    const parsed = await validateRequest(GenerateTimesheetSummarySchema, request);
    if (!parsed.success) return parsed.response;

    const { scope, ...filters } = parsed.data;

    const summary = await generateTimesheetSummaryService(scope, filters);

    // 'layout' rather than the bare path: the staff view has a dynamic child
    // per person, and a page-typed revalidate does not reach it.
    revalidatePath(ROUTES.ADMIN_TIMESHEETS, "layout");
    revalidatePath(ROUTES.ADMIN_TIMESHEETS_STAFF, "layout");

    return { success: true, data: summary };
  } catch (error) {
    return handleServerApiError("generateTimesheetSummaryAction", error);
  }
}
