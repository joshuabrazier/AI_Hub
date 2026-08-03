import "server-only";

import { generateId } from "better-auth";

import {
  ATTENDANCE_STATUS,
  NewClassSession,
  NewSessionAttendee,
  SESSION_STATUS,
} from "@/lib/data/kysely-database-types";

import type { SessionInput } from "./admin-classes.types";

// -------------------------------------------------------------------
// Build the NewClassSession rows for a class from a list of dated slots.
// Every session is SCHEDULED and carries the class's lead. Shared by class
// create and the edit-time session regeneration so their session shape cannot
// drift apart.
// -------------------------------------------------------------------
export function buildNewClassSessions(params: {
  classId: string;
  leadUserId: string | null;
  sessions: SessionInput[];
  now: Date;
}): NewClassSession[] {
  const { classId, leadUserId, sessions, now } = params;

  return sessions.map((session) => ({
    id: generateId(),
    classId,
    leadUserId,
    sessionDate: session.sessionDate,
    sessionStart: session.sessionStart,
    sessionEnd: session.sessionEnd,
    status: SESSION_STATUS.SCHEDULED,
    notes: null,
    createdAt: now,
    updatedAt: now,
  }));
}

// -------------------------------------------------------------------
// Build the BOOKED session_attendees rows for a set of users across a set of
// sessions (the cartesian product). Shared by joining a class and by session
// regeneration, so the roster-booking shape stays consistent.
//
// Rosters are users now: there is no swimmer between a person and their place.
// -------------------------------------------------------------------
export function buildBookedAttendance(params: {
  sessionIds: string[];
  userIds: string[];
  now: Date;
}): NewSessionAttendee[] {
  const { sessionIds, userIds, now } = params;

  return sessionIds.flatMap((classSessionId) =>
    userIds.map((userId) => ({
      id: generateId(),
      classSessionId,
      userId,
      attendanceStatus: ATTENDANCE_STATUS.BOOKED,
      createdAt: now,
      updatedAt: now,
    })),
  );
}
