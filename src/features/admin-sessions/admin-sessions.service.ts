import "server-only";

import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";

import {
  requireManageableClassService,
  requireManageableSessionService,
} from "@/features/admin-classes/admin-classes.service";
import { buildBookedAttendance } from "@/features/admin-classes/session-builders";
import { requireManagementScope } from "@/lib/auth/session-auth-server";
import { database } from "@/lib/data/kysely-database-client";
import { NewClassSession, SESSION_STATUS, UpdateClassSession } from "@/lib/data/kysely-database-types";
import { getClassMemberUserIdsByClassRepo } from "@/lib/data/repositories/class-members.repository";
import {
  createClassSessionRepo,
  getAllClassSessionsRepo,
  updateClassSessionByIdRepo,
} from "@/lib/data/repositories/class-sessions.repository";
import { getAllClassesRepo, getClassesForTeamsRepo } from "@/lib/data/repositories/classes.repository";
import { bulkCreateAttendanceRepo } from "@/lib/data/repositories/session-attendees.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { todayInAppZone } from "@/lib/timezone";

import { mapToSessionResponseDTO } from "./admin-sessions.mappers";
import { CreateClassSessionRequestDTO, SessionsPageData, UpdateClassSessionRequestDTO } from "./admin-sessions.types";

// -------------------------------------------------------------------
// Admin sessions service
//
// A session has no authority of its own: it is administered by whoever
// administers its CLASS. Every entry point here therefore resolves the owning
// class from the session's own classId and defers to
// requireManageableClassService - the single definition of that rule, which
// lives in the classes service.
//
// The list read is scoped the same way: admins are unrestricted, everyone else
// sees only sessions of their teams' classes, and an empty scope shows nothing.
// -------------------------------------------------------------------

const emptyToNull = (value: string) => (value.trim() === "" ? null : value);

function revalidateSessionViews(): void {
  revalidatePath(ROUTES.ADMIN_SESSIONS);
  revalidatePath(ROUTES.ADMIN_SCHEDULE);
  revalidatePath(ROUTES.MANAGE_SCHEDULE);
  revalidatePath(ROUTES.PORTAL_SCHEDULE);
}

// -------------------------------------------------------------------
// Sessions tab: the sessions in the caller's scope + the class dropdown.
// -------------------------------------------------------------------
export async function getSessionsPageDataService(): Promise<SessionsPageData> {
  try {
    const scope = await requireManagementScope();

    const today = todayInAppZone();

    const [sessionRows, classRows] = await Promise.all([
      getAllClassSessionsRepo(),
      scope.isUnrestricted ? getAllClassesRepo(today) : getClassesForTeamsRepo(scope.teamIds, today),
    ]);

    // Each row carries its class's owning team, so the scope filter is applied
    // to the rows themselves. A session of a team-less class belongs to admins
    // alone, and an empty scope keeps nothing - never everything.
    const teamIds = new Set(scope.teamIds);
    const sessions = scope.isUnrestricted
      ? sessionRows
      : sessionRows.filter((row) => row.teamId !== null && teamIds.has(row.teamId));

    return {
      sessions: sessions.map(mapToSessionResponseDTO),
      // Only an active class can take a new session; a retired one (or one
      // whose end date has passed) would just bloat the picker.
      classOptions: classRows
        .filter((row) => row.isActive)
        .map((row) => ({ value: row.id, label: `${row.programName} - ${row.name}` })),
    };
  } catch (error) {
    throw handleError("getSessionsPageDataService", error);
  }
}

// -------------------------------------------------------------------
// Create a single session (a one-off added to an existing class).
// -------------------------------------------------------------------
export async function createClassSessionService(requestDTO: CreateClassSessionRequestDTO): Promise<string> {
  try {
    // The class the session is being attached to is what authorizes creating it.
    const classRow = await requireManageableClassService(requestDTO.classId);

    // A one-off still has to sit inside the class's dates - a session outside
    // them is not part of the class anybody signed up to. Both sides are
    // 'YYYY-MM-DD', so this compares lexicographically.
    if (requestDTO.sessionDate < classRow.startDate || requestDTO.sessionDate > classRow.endDate) {
      throw new DisplayErrorMessage("The date must fall within the class's start and end dates.");
    }

    const now = new Date();
    const sessionId = generateId();

    const newSession: NewClassSession = {
      id: sessionId,
      classId: classRow.id,
      // Inherit the class's lead, so a manually-added session is not
      // mysteriously unstaffed. It can be reassigned from the schedule.
      leadUserId: classRow.leadUserId,
      sessionDate: requestDTO.sessionDate,
      sessionStart: requestDTO.sessionStart,
      sessionEnd: requestDTO.sessionEnd,
      status: requestDTO.status,
      notes: emptyToNull(requestDTO.notes),
      createdAt: now,
      updatedAt: now,
    };

    // A scheduled session inherits the class's current members as its roster,
    // so a manually-added session is not empty. A session created already
    // completed or cancelled gets nobody - there is nothing to book into it.
    const userIds =
      requestDTO.status === SESSION_STATUS.SCHEDULED
        ? await getClassMemberUserIdsByClassRepo(classRow.id)
        : [];

    await database.transaction().execute(async (trx) => {
      await createClassSessionRepo(newSession, trx);
      await bulkCreateAttendanceRepo(buildBookedAttendance({ sessionIds: [sessionId], userIds, now }), trx);
    });

    revalidateSessionViews();

    return sessionId;
  } catch (error) {
    throw handleError("createClassSessionService", error);
  }
}

// -------------------------------------------------------------------
// Update a session's date, time, status and notes.
//
// The class it belongs to is deliberately not updatable - see the comment on
// UpdateClassSessionSchema. Moving a session between classes would leave the
// wrong people on its roster.
// -------------------------------------------------------------------
export async function updateClassSessionService(requestDTO: UpdateClassSessionRequestDTO): Promise<string | undefined> {
  try {
    await requireManageableSessionService(requestDTO.id);

    const updateSession: UpdateClassSession = {
      sessionDate: requestDTO.sessionDate,
      sessionStart: requestDTO.sessionStart,
      sessionEnd: requestDTO.sessionEnd,
      status: requestDTO.status,
      notes: emptyToNull(requestDTO.notes),
      updatedAt: new Date(),
    };

    const session = await updateClassSessionByIdRepo(requestDTO.id, updateSession);

    revalidateSessionViews();

    return session?.id;
  } catch (error) {
    throw handleError("updateClassSessionService", error);
  }
}
