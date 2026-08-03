"use server";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { STAFF_ROLES } from "@/lib/data/kysely-database-types";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  GetScheduleWeekRequestDTO,
  GetScheduleWeekSchema,
  GetSessionRosterRequestDTO,
  GetSessionRosterSchema,
  RosterEntryDTO,
  ScheduleWeekData,
  SetAttendanceRequestDTO,
  SetAttendanceSchema,
  SetSessionStatusRequestDTO,
  SetSessionStatusSchema,
  UpdateScheduleSessionRequestDTO,
  UpdateScheduleSessionSchema,
} from "./admin-schedule.types";
import {
  getScheduleWeekService,
  getSessionRosterService,
  setAttendanceStatusService,
  setSessionStatusService,
  updateScheduleSessionService,
} from "./admin-schedule.service";

// -------------------------------------------------------------------
// Schedule actions
//
// The role check here is the OUTER gate only - it keeps members out. Which
// sessions the caller may see or touch is decided in the service, from the
// session, against the owning team of each session's class.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Get the schedule for a week (Monday-anchored).
// -------------------------------------------------------------------
export async function getScheduleWeekAction(
  requestDTO: GetScheduleWeekRequestDTO,
): Promise<ServerApiResponse<ScheduleWeekData>> {
  try {
    await requireUserRole(STAFF_ROLES);

    const validatedRequest = await validateRequest(GetScheduleWeekSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const data = await getScheduleWeekService(validatedRequest.data.weekStartIso);

    return {
      success: true,
      data,
    } satisfies ServerApiResponse<ScheduleWeekData>;
  } catch (error) {
    return handleServerApiError("getScheduleWeekAction", error);
  }
}

// -------------------------------------------------------------------
// Set a session's status (cancel / restore / complete).
// -------------------------------------------------------------------
export async function setSessionStatusAction(
  requestDTO: SetSessionStatusRequestDTO,
): Promise<ServerApiResponse<string | undefined>> {
  try {
    await requireUserRole(STAFF_ROLES);

    const validatedRequest = await validateRequest(SetSessionStatusSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const id = await setSessionStatusService(validatedRequest.data);

    return {
      success: true,
      data: id,
    } satisfies ServerApiResponse<string | undefined>;
  } catch (error) {
    return handleServerApiError("setSessionStatusAction", error);
  }
}

// -------------------------------------------------------------------
// Edit a session (date / time / status / lead / notes).
// -------------------------------------------------------------------
export async function updateScheduleSessionAction(
  requestDTO: UpdateScheduleSessionRequestDTO,
): Promise<ServerApiResponse<string | undefined>> {
  try {
    await requireUserRole(STAFF_ROLES);

    const validatedRequest = await validateRequest(UpdateScheduleSessionSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const id = await updateScheduleSessionService(validatedRequest.data);

    return {
      success: true,
      data: id,
    } satisfies ServerApiResponse<string | undefined>;
  } catch (error) {
    return handleServerApiError("updateScheduleSessionAction", error);
  }
}

// -------------------------------------------------------------------
// Get a session's roster.
// -------------------------------------------------------------------
export async function getSessionRosterAction(
  requestDTO: GetSessionRosterRequestDTO,
): Promise<ServerApiResponse<RosterEntryDTO[]>> {
  try {
    await requireUserRole(STAFF_ROLES);

    const validatedRequest = await validateRequest(GetSessionRosterSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const roster = await getSessionRosterService(validatedRequest.data.sessionId);

    return { success: true, data: roster } satisfies ServerApiResponse<RosterEntryDTO[]>;
  } catch (error) {
    return handleServerApiError("getSessionRosterAction", error);
  }
}

// -------------------------------------------------------------------
// Mark somebody's attendance for a session.
// -------------------------------------------------------------------
export async function setAttendanceStatusAction(
  requestDTO: SetAttendanceRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUserRole(STAFF_ROLES);

    const validatedRequest = await validateRequest(SetAttendanceSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await setAttendanceStatusService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("setAttendanceStatusAction", error);
  }
}
