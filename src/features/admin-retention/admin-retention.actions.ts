"use server";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { handleServerApiError } from "@/lib/handle-errors";
import { ServerApiResponse } from "@/lib/types";

import {
  DeidentifiedUser,
  getDeidentifiedUsersService,
  getRetentionCandidatesService,
  RetentionCandidate,
} from "./admin-retention.service";

// -------------------------------------------------------------------
// Data retention actions.
//
// Both are READ-ONLY. There is deliberately no action that triggers
// de-identification: it is irreversible, so the only way to run it is the
// scheduled job behind its bearer secret, never a button an admin can reach.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// The people who currently meet the inactivity rule and would be
// de-identified on the next run.
// -------------------------------------------------------------------
export async function getRetentionCandidatesAction(): Promise<ServerApiResponse<RetentionCandidate[]>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const data = await getRetentionCandidatesService();

    return { success: true, data } satisfies ServerApiResponse<RetentionCandidate[]>;
  } catch (error) {
    return handleServerApiError("getRetentionCandidatesAction", error);
  }
}

// -------------------------------------------------------------------
// People whose data has already been de-identified.
// -------------------------------------------------------------------
export async function getDeidentifiedUsersAction(): Promise<ServerApiResponse<DeidentifiedUser[]>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const data = await getDeidentifiedUsersService();

    return { success: true, data } satisfies ServerApiResponse<DeidentifiedUser[]>;
  } catch (error) {
    return handleServerApiError("getDeidentifiedUsersAction", error);
  }
}
