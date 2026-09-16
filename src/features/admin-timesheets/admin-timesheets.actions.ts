"use server";

import { revalidatePath } from "next/cache";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { upsertStaffTargetRepo } from "@/lib/data/repositories/timesheet.repository";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { handleServerApiError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import { StaffTargetRequestDTO, StaffTargetSchema } from "./admin-timesheets.types";

// -------------------------------------------------------------------
// Admin timesheet actions
// -------------------------------------------------------------------

export interface SyncNowResultDTO {
  worklogsWritten: number;
  worklogsDeleted: number;
  issuesWritten: number;
  dryRun: boolean;
  message: string;
}


// -------------------------------------------------------------------
// Save one person's target.
//
// The form speaks in days and hours; storage keeps tenths and minutes, both
// integers, so the conversion happens here at the boundary rather than being
// scattered through the UI. See migration 003 for why nothing is NUMERIC.
//
// personId is an Atlassian accountId taken from the URL. It is validated as a
// non-empty string and used as a primary key - it grants no access, because
// the admin check above already decided that, and every read is admin-scoped.
// -------------------------------------------------------------------
export async function saveStaffTargetAction(
  request: StaffTargetRequestDTO,
): Promise<ServerApiResponse<{ personId: string }>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const parsed = await validateRequest(StaffTargetSchema, request);
    if (!parsed.success) return parsed.response;

    const { personId, personName, workingDaysPerWeek, hoursPerDay, billableTargetPercent, workingWeekdays } =
      parsed.data;

    await upsertStaffTargetRepo({
      personId,
      personName: personName ?? null,
      // Rounded because the schema allows half days and half hours; storing a
      // float here would put the string-versus-number trap back.
      workingDaysTenths: Math.round(workingDaysPerWeek * 10),
      workingWeekdays,
      minutesPerDay: Math.round(hoursPerDay * 60),
      billableTargetPercent: billableTargetPercent === null ? null : Math.round(billableTargetPercent),
    });

    revalidatePath(ROUTES.ADMIN_TIMESHEETS_STAFF);
    revalidatePath(ROUTES.ADMIN_TIMESHEETS);

    return { success: true, data: { personId } };
  } catch (error) {
    return handleServerApiError("saveStaffTargetAction", error);
  }
}
