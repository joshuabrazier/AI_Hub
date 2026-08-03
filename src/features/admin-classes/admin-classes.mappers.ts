import type { DayOfWeek } from "@/lib/data/kysely-database-types";
import type { ClassWithRefs } from "@/lib/data/repositories/classes.repository";
import type { ClassMemberEntry } from "@/lib/data/repositories/class-members.repository";

import type { ClassMemberDTO, ClassResponseDTO } from "./admin-classes.types";

// -------------------------------------------------------------------
// Map a joined class row to the UI DTO.
//
// startDate / endDate stay strings: they come from DATE columns as
// 'YYYY-MM-DD' and are rendered and compared as such.
// -------------------------------------------------------------------
export function mapToClassResponseDTO(row: ClassWithRefs, memberCount = 0): ClassResponseDTO {
  return {
    id: row.id,
    programId: row.programId,
    programName: row.programName,
    name: row.name,
    description: row.description,
    locationId: row.locationId,
    locationName: row.locationName,
    teamId: row.teamId,
    teamName: row.teamName,
    leadUserId: row.leadUserId,
    leadUserName: row.leadUserName,
    schedule: row.schedule.map((slot) => ({
      day: slot.day as DayOfWeek,
      startTime: slot.startTime,
      endTime: slot.endTime,
    })),
    capacity: row.capacity,
    memberCount,
    startDate: row.startDate,
    endDate: row.endDate,
    isActive: row.isActive,
    isRunning: row.isRunning,
    createdAt: row.createdAt.toISOString(),
  };
}

// -------------------------------------------------------------------
// Map a class membership row to the UI DTO.
// -------------------------------------------------------------------
export function mapToClassMemberDTO(entry: ClassMemberEntry): ClassMemberDTO {
  return {
    userId: entry.userId,
    name: entry.userName,
    email: entry.userEmail,
  };
}
