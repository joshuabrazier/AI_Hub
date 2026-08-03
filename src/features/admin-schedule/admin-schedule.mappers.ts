import type { ScheduleSessionRow } from "@/lib/data/repositories/class-sessions.repository";
import type { ScheduleSessionDTO, WeekSessionDTO } from "./admin-schedule.types";

const toHHMM = (time: string) => time.slice(0, 5);

// -------------------------------------------------------------------
// Map a schedule session row to the fields the shared week grid draws.
//
// Used directly by the read-only (manager) week, and built on by the admin
// mapper below, so the two weeks cannot disagree about a single field.
//
// sessionDate stays a 'YYYY-MM-DD' string; it is the key the day lanes and the
// closure-day overlay are looked up by.
// -------------------------------------------------------------------
export function mapToWeekSessionDTO(
  row: ScheduleSessionRow,
  attendeeCount = 0,
  cancelledCount = 0,
  closureReason: string | null = null,
): WeekSessionDTO {
  return {
    id: row.id,
    className: row.className,
    programName: row.programName,
    locationName: row.locationName,
    leadUserName: row.leadUserName,
    sessionDate: row.sessionDate,
    sessionStart: toHHMM(row.sessionStart),
    sessionEnd: toHHMM(row.sessionEnd),
    status: row.status,
    closureReason,
    capacity: row.capacity,
    attendeeCount,
    cancelledCount,
  };
}

// -------------------------------------------------------------------
// The same row for the ADMIN schedule, which also needs the fields its detail
// dialog edits.
// -------------------------------------------------------------------
export function mapToScheduleSessionDTO(
  row: ScheduleSessionRow,
  attendeeCount = 0,
  cancelledCount = 0,
  closureReason: string | null = null,
): ScheduleSessionDTO {
  return {
    ...mapToWeekSessionDTO(row, attendeeCount, cancelledCount, closureReason),
    classId: row.classId,
    teamId: row.teamId,
    leadUserId: row.leadUserId,
    notes: row.notes,
  };
}
