import "server-only";

import { addDays, format, parseISO } from "date-fns";
import { revalidatePath } from "next/cache";

import {
  requireAssignableLeadService,
  requireManageableSessionService,
} from "@/features/admin-classes/admin-classes.service";
import { requireManagementScope } from "@/lib/auth/session-auth-server";
import { ATTENDANCE_STATUS, UpdateClassSession } from "@/lib/data/kysely-database-types";
import {
  getSessionsInRangeForTeamsRepo,
  getSessionsInRangeRepo,
  updateClassSessionByIdRepo,
} from "@/lib/data/repositories/class-sessions.repository";
import { getClosureDaysInRangeRepo } from "@/lib/data/repositories/closure-days.repository";
import {
  getAttendanceCountsForSessionsRepo,
  getSessionAttendeeByIdRepo,
  getSessionRosterRepo,
  setAttendanceStatusRepo,
} from "@/lib/data/repositories/session-attendees.repository";
import { getActiveStaffUsersRepo } from "@/lib/data/repositories/users.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { todayInAppZone } from "@/lib/timezone";
import { toMondayIso } from "@/lib/week";

import { mapToScheduleSessionDTO } from "./admin-schedule.mappers";
import {
  RosterEntryDTO,
  ScheduleWeekData,
  SetAttendanceRequestDTO,
  SetSessionStatusRequestDTO,
  UpdateScheduleSessionRequestDTO,
} from "./admin-schedule.types";

// -------------------------------------------------------------------
// Schedule service
//
// This file previously had NO service-layer guard at all: every entry point
// relied on the action that happened to call it, and one of them decrypted
// medical data on the way out. The medical data is gone with the old model; the
// missing guards are what this rewrite puts back.
//
// Every entry point now resolves the caller from the SESSION:
//   - the week read is scoped by requireManagementScope() - admins see every
//     team's sessions, everyone else sees only their teams', and an empty scope
//     sees nothing;
//   - every mutation resolves the session's OWN class and defers to
//     requireManageableSessionService, the single definition of who may
//     administer a class.
//
// No session id, attendee id or team id from a request is ever treated as proof
// of access.
// -------------------------------------------------------------------

function revalidateScheduleViews(): void {
  revalidatePath(ROUTES.ADMIN_SCHEDULE);
  revalidatePath(ROUTES.ADMIN_SESSIONS);
  revalidatePath(ROUTES.MANAGE_SCHEDULE);
  revalidatePath(ROUTES.PORTAL_SCHEDULE);
}

// -------------------------------------------------------------------
// The sessions for the week containing `weekStartIso`, plus the staff pool for
// the detail dialog's lead picker.
// -------------------------------------------------------------------
export async function getScheduleWeekService(weekStartIso: string): Promise<ScheduleWeekData> {
  try {
    const scope = await requireManagementScope();

    // The app's own calendar day, which decides which of these dates are
    // history. A server clock either side of midnight would draw that line on a
    // different day than the rest of the app sees - so it anchors the week
    // fallback too, not just the dimming.
    const today = todayInAppZone();

    const start = toMondayIso(weekStartIso, today);
    const end = format(addDays(parseISO(start), 6), "yyyy-MM-dd");

    const [rows, staff, closureDays] = await Promise.all([
      // Admins are unrestricted; everyone else gets only their teams' sessions,
      // and an empty scope gets nothing rather than everything.
      scope.isUnrestricted
        ? getSessionsInRangeRepo(start, end, today)
        : getSessionsInRangeForTeamsRepo(scope.teamIds, start, end, today),
      getActiveStaffUsersRepo(),
      getClosureDaysInRangeRepo(start, end),
    ]);

    const counts = await getAttendanceCountsForSessionsRepo(rows.map((row) => row.id));
    const countBySession = new Map(counts.map((count) => [count.classSessionId, count]));
    // Keyed by the 'YYYY-MM-DD' string, so no date arithmetic is involved.
    const closureReasonByDate = new Map(closureDays.map((day) => [day.dayDate, day.reason]));

    return {
      weekStartIso: start,
      todayIso: today,
      sessions: rows.map((row) => {
        const count = countBySession.get(row.id);
        return mapToScheduleSessionDTO(
          row,
          count?.total ?? 0,
          count?.cancelled ?? 0,
          closureReasonByDate.get(row.sessionDate) ?? null,
        );
      }),
      // The whole day's closure travels separately from the sessions, because
      // the lane states it even on a day that has none.
      closureDays: closureDays.map((day) => ({ dateIso: day.dayDate, reason: day.reason })),
      leadOptions: staff.map((user) => ({ value: user.id, label: user.name })),
    };
  } catch (error) {
    throw handleError("getScheduleWeekService", error);
  }
}

// -------------------------------------------------------------------
// Set a session's status (cancel / restore / complete).
// -------------------------------------------------------------------
export async function setSessionStatusService(
  requestDTO: SetSessionStatusRequestDTO,
): Promise<string | undefined> {
  try {
    await requireManageableSessionService(requestDTO.id);

    const update: UpdateClassSession = { status: requestDTO.status, updatedAt: new Date() };

    const session = await updateClassSessionByIdRepo(requestDTO.id, update);

    revalidateScheduleViews();

    return session?.id;
  } catch (error) {
    throw handleError("setSessionStatusService", error);
  }
}

// -------------------------------------------------------------------
// Edit a session's date / time / status / lead / notes.
// -------------------------------------------------------------------
export async function updateScheduleSessionService(
  requestDTO: UpdateScheduleSessionRequestDTO,
): Promise<string | undefined> {
  try {
    const { classRow } = await requireManageableSessionService(requestDTO.id);

    // A session belongs inside its class's dates, whichever screen moves it.
    // Both sides are 'YYYY-MM-DD', so this compares lexicographically.
    if (requestDTO.sessionDate < classRow.startDate || requestDTO.sessionDate > classRow.endDate) {
      throw new DisplayErrorMessage("The date must fall within the class's start and end dates.");
    }

    // The lead comes from the client's picker, so it is re-checked: only an
    // active staff account may be put in front of a session.
    await requireAssignableLeadService(requestDTO.leadUserId);

    const update: UpdateClassSession = {
      sessionDate: requestDTO.sessionDate,
      sessionStart: requestDTO.sessionStart,
      sessionEnd: requestDTO.sessionEnd,
      status: requestDTO.status,
      leadUserId: requestDTO.leadUserId,
      notes: requestDTO.notes.trim() === "" ? null : requestDTO.notes,
      updatedAt: new Date(),
    };

    const session = await updateClassSessionByIdRepo(requestDTO.id, update);

    revalidateScheduleViews();

    return session?.id;
  } catch (error) {
    throw handleError("updateScheduleSessionService", error);
  }
}

// -------------------------------------------------------------------
// The roster for one session: who is on it and how each of them stands.
//
// There is no medical information here any more - the old version decrypted a
// swimmer's conditions on the way out, and neither swimmers nor medical data
// exist in this model.
// -------------------------------------------------------------------
export async function getSessionRosterService(classSessionId: string): Promise<RosterEntryDTO[]> {
  try {
    await requireManageableSessionService(classSessionId);

    const rows = await getSessionRosterRepo(classSessionId);

    return rows.map((row) => ({
      attendeeId: row.attendeeId,
      userId: row.userId,
      userName: row.userName,
      status: row.status,
    }));
  } catch (error) {
    throw handleError("getSessionRosterService", error);
  }
}

// -------------------------------------------------------------------
// Mark somebody attended / absent / booked for a session.
// -------------------------------------------------------------------
export async function setAttendanceStatusService(requestDTO: SetAttendanceRequestDTO): Promise<void> {
  try {
    // Turn a member away before anything is read, so an attendee id cannot be
    // used to probe for what exists.
    await requireManagementScope();

    // An attendee id proves nothing on its own. Resolve the roster row, then the
    // session it belongs to, then the class that authorizes acting on it - the
    // whole chain, from the row rather than from the request.
    const attendee = await getSessionAttendeeByIdRepo(requestDTO.attendeeId);

    if (!attendee) {
      throw new DisplayErrorMessage("That person is no longer on this roster.");
    }

    await requireManageableSessionService(attendee.classSessionId);

    // A place the member cancelled themselves is theirs to give up and theirs to
    // take back. Marking it here would quietly re-occupy a place they freed.
    if (attendee.attendanceStatus === ATTENDANCE_STATUS.CANCELLED) {
      throw new DisplayErrorMessage("That place was cancelled by the member, so it can't be marked.");
    }

    await setAttendanceStatusRepo(requestDTO.attendeeId, requestDTO.status);

    revalidateScheduleViews();
  } catch (error) {
    throw handleError("setAttendanceStatusService", error);
  }
}
