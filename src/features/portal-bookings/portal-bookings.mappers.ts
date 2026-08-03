import { ATTENDANCE_STATUS, SESSION_STATUS } from "@/lib/data/kysely-database-types";
import type { MemberSessionRow } from "@/lib/data/repositories/class-sessions.repository";

import type { PortalBookingDTO } from "./portal-bookings.types";

// A TIME column comes back as 'HH:MM:SS'. The seconds are always zero and are
// never displayed.
function toHoursAndMinutes(time: string): string {
  return time.slice(0, 5);
}

// -------------------------------------------------------------------
// Whether this place can still be given up.
//
// Three conditions, all read from stored state rather than from anything the
// client sent: the session is still going ahead, the member still holds the
// place, and the session has not already been.
//
// This is exported because the service applies the SAME rule again before it
// writes. One definition, used by both, is what stops the button and the write
// path drifting apart - and the write path is the one that decides.
//
// `sessionDate` and `todayIso` are both 'YYYY-MM-DD' strings from DATE
// columns, so this compares lexicographically.
// -------------------------------------------------------------------
export function isCancellableBooking(
  session: { status: string; sessionDate: string },
  attendanceStatus: string,
  todayIso: string,
): boolean {
  return (
    session.status === SESSION_STATUS.SCHEDULED &&
    attendanceStatus === ATTENDANCE_STATUS.BOOKED &&
    session.sessionDate >= todayIso
  );
}

// -------------------------------------------------------------------
// Map one of the member's own session rows to a booking.
//
// A session on a closure day keeps its stored status but carries the reason,
// so the page can say it is not running that day without the session row ever
// being rewritten.
// -------------------------------------------------------------------
export function mapDBMemberSessionToPortalBookingDTO(
  row: MemberSessionRow,
  todayIso: string,
  closureReasonByDate: Map<string, string>,
): PortalBookingDTO {
  return {
    attendeeId: row.attendeeId,
    classSessionId: row.id,
    sessionDate: row.sessionDate,
    sessionStart: toHoursAndMinutes(row.sessionStart),
    sessionEnd: toHoursAndMinutes(row.sessionEnd),
    status: row.status,
    attendanceStatus: row.attendanceStatus,
    closureReason: closureReasonByDate.get(row.sessionDate) ?? null,
    className: row.className,
    programName: row.programName,
    locationName: row.locationName,
    locationAddress: row.locationAddress,
    capacity: row.capacity,
    // Counted by the database, so it arrives as a bigint string.
    attendeeCount: Number(row.attendeeCount ?? 0),
    canCancel: isCancellableBooking(row, row.attendanceStatus, todayIso),
  };
}
