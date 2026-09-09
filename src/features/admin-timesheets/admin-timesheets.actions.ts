"use server";

import { revalidatePath } from "next/cache";

import { syncJiraWorklogsService } from "@/features/timesheet-sync/timesheet-sync.service";
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
// Refresh from Jira, now.
//
// The same sync the timer runs, triggered by hand. It takes no arguments: the
// window comes from the stored watermark, not from the caller, so there is no
// way to ask for a different range and nothing to validate. That is deliberate
// - a caller-supplied window would be a way to make the watermark jump.
//
// Safe to press repeatedly. Every write is an upsert keyed on Jira's own
// worklog id, and the watermark only advances behind writes that committed, so
// two presses land on the same rows rather than double-counting. The button
// disables itself while a run is in flight anyway.
//
// The role check is here AND in the service. An action is not the only thing
// that can call a service.
// -------------------------------------------------------------------
export async function syncTimesheetsNowAction(): Promise<ServerApiResponse<SyncNowResultDTO>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const result = await syncJiraWorklogsService();

    if (!result.ok) {
      return {
        success: false,
        formError: result.configured
          ? (result.error ?? "The sync failed. Check the server log.")
          : "Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN.",
      };
    }

    // Every timesheet view reads the same read model, so all four are stale
    // once this returns. Revalidating the layout segment covers them in one
    // call rather than four that could drift apart.
    revalidatePath(ROUTES.ADMIN_TIMESHEETS);
    revalidatePath(ROUTES.ADMIN_TIMESHEETS_CLIENTS);
    revalidatePath(ROUTES.ADMIN_TIMESHEETS_STAFF);

    // A dry run reports what it WOULD have written, so the message has to say
    // so - otherwise "17 entries updated" is a lie when JIRA_SYNC_ENABLED is
    // false and nothing was actually stored.
    const message = result.dryRun
      ? `Dry run: ${result.worklogsWritten} entries would be written. Set JIRA_SYNC_ENABLED=true to apply.`
      : result.worklogIdsSeen === 0
        ? "Already up to date. Nothing has changed in Jira since the last sync."
        : `Updated ${result.worklogsWritten} ${result.worklogsWritten === 1 ? "entry" : "entries"}` +
          (result.worklogsDeleted > 0 ? `, removed ${result.worklogsDeleted}` : "") +
          ".";

    return {
      success: true,
      data: {
        worklogsWritten: result.worklogsWritten,
        worklogsDeleted: result.worklogsDeleted,
        issuesWritten: result.issuesWritten,
        dryRun: result.dryRun,
        message,
      },
    };
  } catch (error) {
    return handleServerApiError("syncTimesheetsNowAction", error);
  }
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
