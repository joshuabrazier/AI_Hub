import z from "zod";

import { TABLE_ID_LENGTH } from "@/lib/constants";
import type { AttendanceStatus, SessionStatus } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Member portal booking DTOs
//
// A "booking" is one row of session_attendees: this member's place on one
// dated session. Cancelling it is an UPDATE to attendance_status, never a
// delete, so staff keep seeing who dropped out and the place frees up.
//
// This replaced the swim-school make-up system. There are no credits, no cap,
// no cut-off window and no re-booking into another session: a member may only
// give up a place they hold.
// -------------------------------------------------------------------
export type PortalBookingDTO = {
  // This member's own session_attendees row id, which the cancel request sends
  // back. Holding it proves nothing: the service re-resolves the row from the
  // session and refuses anything that is not the caller's own.
  attendeeId: string;
  classSessionId: string;
  // From DATE and TIME columns: 'YYYY-MM-DD' and 'HH:MM'. Compared
  // lexicographically, never converted to a Date.
  sessionDate: string;
  sessionStart: string;
  sessionEnd: string;
  status: SessionStatus;
  // This member's own status for the session.
  attendanceStatus: AttendanceStatus;
  // Set when the session falls on a closure day - it is not running that day.
  closureReason: string | null;
  className: string;
  programName: string;
  locationName: string;
  locationAddress: string;
  capacity: number;
  // The whole session's roster size, cancelled places excluded.
  attendeeCount: number;
  // Whether to offer the Cancel control. The service decides the same thing
  // again from stored state before it writes; this only keeps the interface
  // from offering something that would be refused.
  canCancel: boolean;
};

// -------------------------------------------------------------------
// What the bookings page renders: the places this member still holds, and the
// ones they have given up, over the window ahead.
// -------------------------------------------------------------------
export type PortalBookingsResponseDTO = {
  // Today in the app's time zone, and the far end of the window shown. Both
  // 'YYYY-MM-DD'.
  todayIso: string;
  horizonIso: string;
  bookings: PortalBookingDTO[];
  cancelled: PortalBookingDTO[];
};

// -------------------------------------------------------------------
// Cancelling one place.
//
// The attendee id is a lookup key and nothing more. It arrives from the
// client, so the service treats it as untrusted: it resolves the row, checks
// the row's user id against the SESSION, and answers "no such booking"
// identically whether the row is missing or belongs to somebody else.
// -------------------------------------------------------------------
export const CancelBookingSchema = z.object({
  attendeeId: z.string().min(TABLE_ID_LENGTH),
});

export type CancelBookingRequestDTO = z.infer<typeof CancelBookingSchema>;
