import type { ClassWithRefs } from "@/lib/data/repositories/classes.repository";

import type { ManagedClassDTO } from "./manage-classes.types";

// -------------------------------------------------------------------
// Map a joined class row to the manager's class DTO.
//
// `memberCount` is passed in rather than looked up here so the mapper stays
// free of data access, and so the count comes from the one grouped read the
// service already made.
// -------------------------------------------------------------------
export function mapDBClassToManagedClassDTO(row: ClassWithRefs, memberCount: number): ManagedClassDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    programName: row.programName,
    locationName: row.locationName,
    teamName: row.teamName,
    leadUserName: row.leadUserName,
    // JSONB, already parsed to an array by the driver.
    schedule: row.schedule,
    // DATE columns arrive as 'YYYY-MM-DD' and stay strings all the way to the
    // screen: they are calendar days, and a Date would move them across
    // midnight on any server that is not in the app's zone.
    startDate: row.startDate,
    endDate: row.endDate,
    capacity: row.capacity,
    memberCount,
    isActive: row.isActive,
    isRunning: row.isRunning,
  };
}
