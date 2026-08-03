import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import {
  ATTENDANCE_STATUS,
  AttendanceStatus,
  NewSessionAttendee,
  PLACE_TAKING_ATTENDANCE_STATUSES,
  SessionAttendee,
} from "../kysely-database-types";

// Spread once at module scope: Kysely's `in` takes a plain array, and every
// count below shares this list. Cancelled attendees are absent from it, which
// is what frees their place.
const PLACE_TAKING_STATUSES = [...PLACE_TAKING_ATTENDANCE_STATUSES];

// One person's roster line for a session.
export type RosterEntry = {
  attendeeId: string;
  userId: string;
  userName: string;
  status: AttendanceStatus;
};

// -------------------------------------------------------------------
// The roster (people + attendance status) for one session. Cancelled places
// are kept on the roster (shown with a "Cancelled" badge) so staff can see who
// has dropped out - they just do not count towards capacity.
// -------------------------------------------------------------------
export async function getSessionRosterRepo(classSessionId: string): Promise<RosterEntry[]> {
  try {
    return await database
      .selectFrom("sessionAttendees as sa")
      .innerJoin("users as u", "u.id", "sa.userId")
      .where("sa.classSessionId", "=", classSessionId)
      .select(["sa.id as attendeeId", "u.id as userId", "u.name as userName", "sa.attendanceStatus as status"])
      .orderBy("u.name")
      .execute();
  } catch (error) {
    throw handleError("getSessionRosterRepo", error);
  }
}

// -------------------------------------------------------------------
// One roster row by id. Carries its userId, so a service can confirm the row
// belongs to the signed-in member before letting them change it.
//
// Takes the optional db like the mutations it guards: a service doing
// check-then-mutate has to run the check on the SAME connection, or it reads
// outside its own transaction - blind to its uncommitted writes and taking no
// part in the row locking that keeps the decision true until commit.
// -------------------------------------------------------------------
export async function getSessionAttendeeByIdRepo(
  id: string,
  db: DBClient = database,
): Promise<SessionAttendee | undefined> {
  try {
    return await db.selectFrom("sessionAttendees").selectAll().where("id", "=", id).executeTakeFirst();
  } catch (error) {
    throw handleError("getSessionAttendeeByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// Bulk-insert roster rows - e.g. when someone joins a class and gets booked
// into every scheduled session of it. No-op if empty.
// -------------------------------------------------------------------
export async function bulkCreateAttendanceRepo(rows: NewSessionAttendee[], db: DBClient = database): Promise<void> {
  try {
    if (rows.length === 0) return;
    // Ignore rows that already exist (e.g. someone rejoining a class whose
    // sessions still hold their recorded attendance).
    await db
      .insertInto("sessionAttendees")
      .values(rows)
      .onConflict((oc) => oc.columns(["classSessionId", "userId"]).doNothing())
      .execute();
  } catch (error) {
    throw handleError("bulkCreateAttendanceRepo", error);
  }
}

// -------------------------------------------------------------------
// Set someone's attendance status for a session.
// -------------------------------------------------------------------
export async function setAttendanceStatusRepo(
  attendeeId: string,
  status: AttendanceStatus,
  db: DBClient = database,
): Promise<void> {
  try {
    await db
      .updateTable("sessionAttendees")
      .set({ attendanceStatus: status, updatedAt: new Date() })
      .where("id", "=", attendeeId)
      .execute();
  } catch (error) {
    throw handleError("setAttendanceStatusRepo", error);
  }
}

// -------------------------------------------------------------------
// When someone leaves a class, remove their still-"booked" roster rows for
// that class's UPCOMING sessions ('YYYY-MM-DD' onward). Recorded history
// (attended/absent) and cancellations are preserved.
//
// The date bound is what makes that claim true. A past session nobody got
// round to marking still holds 'booked' rows, and deleting those would erase
// the member from a roster that has already been run - rewriting history
// rather than cancelling a place. `fromDate` comes from the caller in the
// app's time zone, matching setLeadUserForUpcomingSessionsRepo.
// -------------------------------------------------------------------
export async function deleteBookedAttendanceForClassMemberRepo(
  classId: string,
  userId: string,
  fromDate: string,
  db: DBClient = database,
): Promise<void> {
  try {
    await db
      .deleteFrom("sessionAttendees")
      .where("userId", "=", userId)
      .where("attendanceStatus", "=", ATTENDANCE_STATUS.BOOKED)
      .where(
        "classSessionId",
        "in",
        db
          .selectFrom("classSessions")
          .select("id")
          .where("classId", "=", classId)
          .where("sessionDate", ">=", fromDate),
      )
      .execute();
  } catch (error) {
    throw handleError("deleteBookedAttendanceForClassMemberRepo", error);
  }
}

// -------------------------------------------------------------------
// Per-session counts for the schedule: `total` is the roster size that
// occupies capacity, and `cancelled` is how many people have cancelled - so
// the schedule can flag a session that is below capacity because people
// dropped out rather than because it never filled.
// -------------------------------------------------------------------
export async function getAttendanceCountsForSessionsRepo(
  sessionIds: string[],
): Promise<{ classSessionId: string; total: number; cancelled: number }[]> {
  try {
    if (sessionIds.length === 0) return [];

    const rows = await database
      .selectFrom("sessionAttendees")
      .where("classSessionId", "in", sessionIds)
      .select((eb) => [
        "classSessionId",
        eb.fn.count<string>("id").filterWhere("attendanceStatus", "in", PLACE_TAKING_STATUSES).as("total"),
        eb.fn
          .count<string>("id")
          .filterWhere("attendanceStatus", "=", ATTENDANCE_STATUS.CANCELLED)
          .as("cancelled"),
      ])
      .groupBy("classSessionId")
      .execute();

    return rows.map((row) => ({
      classSessionId: row.classSessionId,
      total: Number(row.total),
      cancelled: Number(row.cancelled),
    }));
  } catch (error) {
    throw handleError("getAttendanceCountsForSessionsRepo", error);
  }
}

// -------------------------------------------------------------------
// How many places one session currently has taken (cancelled places excluded,
// so they are available again). The check before booking someone in.
// -------------------------------------------------------------------
export async function countPlaceTakingAttendeesRepo(
  classSessionId: string,
  db: DBClient = database,
): Promise<number> {
  try {
    const row = await db
      .selectFrom("sessionAttendees")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("classSessionId", "=", classSessionId)
      .where("attendanceStatus", "in", PLACE_TAKING_STATUSES)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  } catch (error) {
    throw handleError("countPlaceTakingAttendeesRepo", error);
  }
}
