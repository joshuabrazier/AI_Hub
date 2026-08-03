import { SESSION_STATUS, type SessionStatus } from "@/lib/data/kysely-database-types";
import type { MemberSessionRow } from "@/lib/data/repositories/class-sessions.repository";

import type { PortalScheduleSessionDTO } from "./portal-schedule.types";

// A TIME column comes back as 'HH:MM:SS'. The seconds are always zero and are
// never displayed, so they are dropped once, here, rather than at each label.
function toHoursAndMinutes(time: string): string {
  return time.slice(0, 5);
}

// -------------------------------------------------------------------
// The status to show for a session.
//
// A session whose date has passed reads as completed even if nobody got round
// to marking it, because to the member it is simply over. A cancelled session
// stays cancelled: it did not happen, and saying "completed" would be a lie
// that hides the cancellation.
//
// Both dates are 'YYYY-MM-DD' strings from DATE columns, so this is a
// lexicographic comparison and neither becomes a Date.
// -------------------------------------------------------------------
export function resolveDisplayStatus(
  status: SessionStatus,
  sessionDate: string,
  todayIso: string,
): SessionStatus {
  if (status === SESSION_STATUS.CANCELLED) return status;

  return sessionDate < todayIso ? SESSION_STATUS.COMPLETED : status;
}

// -------------------------------------------------------------------
// Map one of the member's own session rows to the schedule DTO.
//
// `closureReasonByDate` carries the closure days that overlap the range being
// mapped. A session on one of those dates is shown as cancelled with its
// reason - the stored session rows are never rewritten, so removing the
// closure day puts the session straight back on the schedule.
// -------------------------------------------------------------------
export function mapDBMemberSessionToPortalScheduleSessionDTO(
  row: MemberSessionRow,
  todayIso: string,
  closureReasonByDate: Map<string, string>,
): PortalScheduleSessionDTO {
  const closureReason = closureReasonByDate.get(row.sessionDate) ?? null;

  return {
    id: row.id,
    sessionDate: row.sessionDate,
    sessionStart: toHoursAndMinutes(row.sessionStart),
    sessionEnd: toHoursAndMinutes(row.sessionEnd),
    status: closureReason
      ? SESSION_STATUS.CANCELLED
      : resolveDisplayStatus(row.status, row.sessionDate, todayIso),
    closureReason,
    className: row.className,
    programName: row.programName,
    locationName: row.locationName,
    locationAddress: row.locationAddress,
    capacity: row.capacity,
    // Counted by the database, so it arrives as a bigint string.
    attendeeCount: Number(row.attendeeCount ?? 0),
    attendanceStatus: row.attendanceStatus,
  };
}
