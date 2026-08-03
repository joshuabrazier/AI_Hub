"use server";

import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { ServerApiResponse } from "@/lib/types";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { handleServerApiError } from "@/lib/handle-errors";

import { AuditLogEntryDTO } from "./admin-activity.types";
import { getAuditLogService } from "./admin-activity.service";

// -------------------------------------------------------------------
// Get the recent audit trail for the admin Activity screen (admin only).
// -------------------------------------------------------------------
export async function getAuditLogAction(): Promise<ServerApiResponse<AuditLogEntryDTO[]>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const entries = await getAuditLogService();

    return {
      success: true,
      data: entries,
    } satisfies ServerApiResponse<AuditLogEntryDTO[]>;
  } catch (error) {
    return handleServerApiError("getAuditLogAction", error);
  }
}
