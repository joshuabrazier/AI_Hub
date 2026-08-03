import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import {
  ATTENDANCE_STATUS,
  AttendanceStatus,
  ClassSession,
  NewClassSession,
  PLACE_TAKING_ATTENDANCE_STATUSES,
  SESSION_STATUS,
  SessionStatus,
  UpdateClassSession,
} from "../kysely-database-types";

// Spread once at module scope: Kysely's `in` takes a plain array, and every
// capacity count below shares this list. Cancelled attendees are absent from
// it, which is what frees their place.
const PLACE_TAKING_STATUSES = [...PLACE_TAKING_ATTENDANCE_STATUSES];

// A session joined with its class and program names for display, plus the
// owning team and whether its class is active (a session of an inactive class
// shows as inactive).
export type ClassSessionWithRefs = ClassSession & {
  className: string;
  programName: string;
  teamId: string | null;
  teamName: string | null;
  classIsActive: boolean;
};

// A session joined with the details the staff weekly schedule needs. teamId
// travels with the row so a manager view can be scoped to their teams.
export type ScheduleSessionRow = ClassSession & {
  className: string;
  programName: string;
  locationName: string;
  leadUserName: string | null;
  capacity: number;
  teamId: string | null;
};

// One of the signed-in member's own sessions - the row shape behind the
// member-facing schedule. `attendeeId` is their own session_attendees row, so
// they can cancel or restore their place. `attendeeCount` is the whole
// session's place-taking roster size, so a member can see when a class is full.
export type MemberSessionRow = {
  id: string; // class_session id
  sessionDate: string; // YYYY-MM-DD
  sessionStart: string; // HH:MM:SS
  sessionEnd: string; // HH:MM:SS
  status: SessionStatus;
  className: string;
  programName: string;
  locationName: string;
  locationAddress: string;
  capacity: number;
  attendeeCount: string | number | null;
  attendeeId: string;
  attendanceStatus: AttendanceStatus;
};

// -------------------------------------------------------------------
// Get all sessions across every class, joined with class + program names,
// the owning team and the class's active flag. Ordered by date.
// -------------------------------------------------------------------
export async function getAllClassSessionsRepo(): Promise<ClassSessionWithRefs[]> {
  try {
    return await database
      .selectFrom("classSessions as cs")
      .innerJoin("classes as c", "c.id", "cs.classId")
      .innerJoin("programs as p", "p.id", "c.programId")
      .leftJoin("teams as t", "t.id", "c.teamId")
      .selectAll("cs")
      .select([
        "c.name as className",
        "p.name as programName",
        "c.teamId as teamId",
        "t.name as teamName",
        "c.isActive as classIsActive",
      ])
      .orderBy("cs.sessionDate")
      .execute();
  } catch (error) {
    throw handleError("getAllClassSessionsRepo", error);
  }
}

// -------------------------------------------------------------------
// Shared select for the staff schedule queries below.
//
// Deactivating a class hides its sessions, and reactivating it brings them
// back (the sessions themselves are never mutated) - but only its UPCOMING
// ones. A plain `c.isActive = true` filter could not stay: isActive is not
// purely a manual flag, deactivateEndedClassesRepo flips it automatically once
// a class's end date has passed, so filtering on it alone blanked last week's
// schedule the moment a class ended, attendance records and all. Sessions
// dated before `today` are history and always show; hiding an inactive class
// only applies from today onward, where it means "stop scheduling this".
//
// `today` is supplied by the caller rather than derived here, exactly as in
// classes.repository.ts: the app resolves the current calendar day in its own
// time zone (todayInAppZone), and a server clock reading either side of
// midnight would draw the history boundary on a different day than the rest of
// the app sees.
// -------------------------------------------------------------------
const scheduleSessionsBaseQuery = (today: string) =>
  database
    .selectFrom("classSessions as cs")
    .innerJoin("classes as c", "c.id", "cs.classId")
    .innerJoin("programs as p", "p.id", "c.programId")
    .innerJoin("locations as l", "l.id", "c.locationId")
    .leftJoin("users as u", "u.id", "cs.leadUserId")
    // sessionDate is a DATE column and `today` is a 'YYYY-MM-DD' string, so
    // this compares lexicographically. Neither becomes a Date.
    .where((eb) => eb.or([eb("c.isActive", "=", true), eb("cs.sessionDate", "<", today)]))
    .selectAll("cs")
    .select([
      "c.name as className",
      "p.name as programName",
      "l.name as locationName",
      "c.capacity as capacity",
      "c.teamId as teamId",
      "u.name as leadUserName",
    ]);

// -------------------------------------------------------------------
// All sessions within an inclusive date range ('YYYY-MM-DD'), joined with
// class / program / location / lead names and capacity. Used by the staff
// weekly schedule. Ordered by date then start time. `today` is the app-zone
// calendar day, which decides which of these dates count as history.
// -------------------------------------------------------------------
export async function getSessionsInRangeRepo(
  startDate: string,
  endDate: string,
  today: string,
): Promise<ScheduleSessionRow[]> {
  try {
    return await scheduleSessionsBaseQuery(today)
      .where("cs.sessionDate", ">=", startDate)
      .where("cs.sessionDate", "<=", endDate)
      .orderBy("cs.sessionDate")
      .orderBy("cs.sessionStart")
      .execute();
  } catch (error) {
    throw handleError("getSessionsInRangeRepo", error);
  }
}

// -------------------------------------------------------------------
// The same range query, narrowed to the classes of the given teams.
//
// `teamIds` is the caller's full team set, resolved from the SESSION - team
// membership is many-to-many, so it is always a list. An empty list means the
// caller manages no teams, which returns nothing rather than everything.
// Sessions of team-less (admin-only) classes never appear here.
// -------------------------------------------------------------------
export async function getSessionsInRangeForTeamsRepo(
  teamIds: string[],
  startDate: string,
  endDate: string,
  today: string,
): Promise<ScheduleSessionRow[]> {
  try {
    if (teamIds.length === 0) return [];

    return await scheduleSessionsBaseQuery(today)
      .where("c.teamId", "in", teamIds)
      .where("cs.sessionDate", ">=", startDate)
      .where("cs.sessionDate", "<=", endDate)
      .orderBy("cs.sessionDate")
      .orderBy("cs.sessionStart")
      .execute();
  } catch (error) {
    throw handleError("getSessionsInRangeForTeamsRepo", error);
  }
}

// -------------------------------------------------------------------
// Shared select for the member-facing session queries below. Scoped to the
// signed-in user's own roster rows, which is what makes these IDOR-safe.
//
// `today` splits history from what is still ahead, for the same reason as
// scheduleSessionsBaseQuery above: an inactive class hides only its upcoming
// sessions, so a member keeps seeing the sessions they already attended after
// their class ends and deactivateEndedClassesRepo retires it. Supplied by the
// caller in the app's time zone.
// -------------------------------------------------------------------
const memberSessionsBaseQuery = (userId: string, today: string) =>
  database
    .selectFrom("sessionAttendees as sa")
    .innerJoin("classSessions as cs", "cs.id", "sa.classSessionId")
    .innerJoin("classes as c", "c.id", "cs.classId")
    .innerJoin("programs as p", "p.id", "c.programId")
    .innerJoin("locations as l", "l.id", "c.locationId")
    // Only this user's own places. The userId predicate IS the authorization
    // check here, not a filter - it is what stops one member reading another's
    // schedule.
    .where("sa.userId", "=", userId)
    .where((eb) => eb.or([eb("c.isActive", "=", true), eb("cs.sessionDate", "<", today)]))
    .select((eb) => [
      "cs.id as id",
      "cs.sessionDate as sessionDate",
      "cs.sessionStart as sessionStart",
      "cs.sessionEnd as sessionEnd",
      "cs.status as status",
      "c.name as className",
      "p.name as programName",
      "l.name as locationName",
      "l.address as locationAddress",
      "c.capacity as capacity",
      "sa.id as attendeeId",
      "sa.attendanceStatus as attendanceStatus",
      // Roster size for the session across everyone, for the "full" flag.
      // Cancelled places are excluded so a freed place shows as available.
      eb
        .selectFrom("sessionAttendees as cnt")
        .whereRef("cnt.classSessionId", "=", "cs.id")
        .where("cnt.attendanceStatus", "in", PLACE_TAKING_STATUSES)
        .select((e2) => e2.fn.countAll<string>().as("c"))
        .as("attendeeCount"),
    ]);

// -------------------------------------------------------------------
// A member's booked sessions within an inclusive date range ('YYYY-MM-DD').
// Powers the member's weekly schedule. Every status is returned (cancelled
// sessions are shown struck through) so members see when a session is off.
// `today` is the app-zone calendar day, which decides which of these dates
// count as history.
// -------------------------------------------------------------------
export async function getUserSessionsInRangeRepo(
  userId: string,
  startDate: string,
  endDate: string,
  today: string,
): Promise<MemberSessionRow[]> {
  try {
    return await memberSessionsBaseQuery(userId, today)
      .where("cs.sessionDate", ">=", startDate)
      .where("cs.sessionDate", "<=", endDate)
      .orderBy("cs.sessionDate")
      .orderBy("cs.sessionStart")
      .execute();
  } catch (error) {
    throw handleError("getUserSessionsInRangeRepo", error);
  }
}

// -------------------------------------------------------------------
// A member's upcoming scheduled sessions from `fromDate` onward (bounded by
// `rowLimit` rows). Powers the dashboard's "next sessions". Cancelled and
// completed sessions are excluded - only what is still ahead.
// -------------------------------------------------------------------
export async function getUserUpcomingSessionRowsRepo(
  userId: string,
  fromDate: string,
  rowLimit: number,
): Promise<MemberSessionRow[]> {
  try {
    // Nothing before `fromDate` is returned, so fromDate is this query's own
    // history boundary - there is no separate `today` to take.
    return await memberSessionsBaseQuery(userId, fromDate)
      .where("cs.status", "=", SESSION_STATUS.SCHEDULED)
      // A place the member cancelled is not one of their upcoming sessions.
      .where("sa.attendanceStatus", "in", PLACE_TAKING_STATUSES)
      .where("cs.sessionDate", ">=", fromDate)
      .orderBy("cs.sessionDate")
      .orderBy("cs.sessionStart")
      .limit(rowLimit)
      .execute();
  } catch (error) {
    throw handleError("getUserUpcomingSessionRowsRepo", error);
  }
}

// -------------------------------------------------------------------
// Get a single session by id. Undefined if it does not exist. Carries its
// classId, so a service can resolve the owning team before acting on it.
// -------------------------------------------------------------------
export async function getClassSessionByIdRepo(id: string, db: DBClient = database): Promise<ClassSession | undefined> {
  try {
    return await db.selectFrom("classSessions").selectAll().where("id", "=", id).executeTakeFirst();
  } catch (error) {
    throw handleError("getClassSessionByIdRepo", error);
  }
}

// A class's session as edited in the class dialog (id + date/time), plus a
// count of its recorded attendance so the dialog can warn before a
// regeneration would discard it. A cancelled place is the member's own
// decision rather than recorded attendance, so it does not count here.
export type ClassSessionEditRow = Pick<ClassSession, "id" | "sessionDate" | "sessionStart" | "sessionEnd"> & {
  markedCount: string | number | null;
};

// -------------------------------------------------------------------
// A class's sessions (id + date/time + recorded-attendance count), ordered by
// date then start. Populates the editable session list in the edit dialog.
// -------------------------------------------------------------------
export async function getSessionsByClassRepo(classId: string): Promise<ClassSessionEditRow[]> {
  try {
    return await database
      .selectFrom("classSessions as cs")
      .select((eb) => [
        "cs.id",
        "cs.sessionDate",
        "cs.sessionStart",
        "cs.sessionEnd",
        eb
          .selectFrom("sessionAttendees as sa")
          .whereRef("sa.classSessionId", "=", "cs.id")
          .where("sa.attendanceStatus", "in", [ATTENDANCE_STATUS.ATTENDED, ATTENDANCE_STATUS.ABSENT])
          .select((e2) => e2.fn.countAll<string>().as("c"))
          .as("markedCount"),
      ])
      .where("cs.classId", "=", classId)
      .orderBy("cs.sessionDate")
      .orderBy("cs.sessionStart")
      .execute();
  } catch (error) {
    throw handleError("getSessionsByClassRepo", error);
  }
}

// -------------------------------------------------------------------
// Ids of a class's scheduled sessions - the sessions a newly-joined member
// should be booked into (completed/cancelled ones are skipped).
// -------------------------------------------------------------------
export async function getScheduledSessionIdsByClassRepo(classId: string, db: DBClient = database): Promise<string[]> {
  try {
    const rows = await db
      .selectFrom("classSessions")
      .select("id")
      .where("classId", "=", classId)
      .where("status", "=", SESSION_STATUS.SCHEDULED)
      .execute();
    return rows.map((row) => row.id);
  } catch (error) {
    throw handleError("getScheduledSessionIdsByClassRepo", error);
  }
}

// -------------------------------------------------------------------
// All of a class's session ids (any status). Used to reconcile the edited
// session list against what exists.
// -------------------------------------------------------------------
export async function getAllSessionIdsByClassRepo(classId: string, db: DBClient = database): Promise<string[]> {
  try {
    const rows = await db.selectFrom("classSessions").select("id").where("classId", "=", classId).execute();
    return rows.map((row) => row.id);
  } catch (error) {
    throw handleError("getAllSessionIdsByClassRepo", error);
  }
}

// -------------------------------------------------------------------
// Create a single session (manual add on the Sessions tab).
// -------------------------------------------------------------------
export async function createClassSessionRepo(
  session: NewClassSession,
  db: DBClient = database,
): Promise<ClassSession> {
  try {
    return await db.insertInto("classSessions").values(session).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("createClassSessionRepo", error);
  }
}

// -------------------------------------------------------------------
// Bulk-create sessions (used when a class generates its occurrences across
// its start/end date range). No-op if empty.
// -------------------------------------------------------------------
export async function createClassSessionsRepo(sessions: NewClassSession[], db: DBClient = database): Promise<void> {
  try {
    if (sessions.length === 0) return;

    await db.insertInto("classSessions").values(sessions).execute();
  } catch (error) {
    throw handleError("createClassSessionsRepo", error);
  }
}

// -------------------------------------------------------------------
// Reassign the lead staff member on a class's upcoming sessions ('YYYY-MM-DD'
// onward). Used when a class's lead changes without a schedule change, so
// future sessions follow the new lead while past sessions keep whoever ran
// them. `fromDate` comes from the caller, in the app's time zone.
// -------------------------------------------------------------------
export async function setLeadUserForUpcomingSessionsRepo(
  classId: string,
  leadUserId: string | null,
  fromDate: string,
  db: DBClient = database,
): Promise<void> {
  try {
    await db
      .updateTable("classSessions")
      .set({ leadUserId, updatedAt: new Date() })
      .where("classId", "=", classId)
      .where("sessionDate", ">=", fromDate)
      .execute();
  } catch (error) {
    throw handleError("setLeadUserForUpcomingSessionsRepo", error);
  }
}

// -------------------------------------------------------------------
// Update a session by id. Undefined if the id does not exist.
// -------------------------------------------------------------------
export async function updateClassSessionByIdRepo(
  id: string,
  updateSession: UpdateClassSession,
  db: DBClient = database,
): Promise<ClassSession | undefined> {
  try {
    // Updateable<ClassSessions> allows id and createdAt. A patch carrying an id
    // would rewrite the primary key of the row the WHERE matched, orphaning the
    // session_attendees rows that hold its attendance. Neither column is ever
    // legitimately patched, so drop both before the spread.
    const patch: UpdateClassSession = { ...updateSession };
    delete patch.id;
    delete patch.createdAt;

    return await db
      .updateTable("classSessions")
      // Nothing stamps updated_at in the database, so the repository does it.
      .set({ ...patch, updatedAt: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateClassSessionByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// Delete sessions by id (their session_attendees cascade). No-op if empty.
// -------------------------------------------------------------------
export async function deleteSessionsByIdsRepo(ids: string[], db: DBClient = database): Promise<void> {
  try {
    if (ids.length === 0) return;
    await db.deleteFrom("classSessions").where("id", "in", ids).execute();
  } catch (error) {
    throw handleError("deleteSessionsByIdsRepo", error);
  }
}
