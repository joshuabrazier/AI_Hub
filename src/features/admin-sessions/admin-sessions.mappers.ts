import type { ClassSessionWithRefs } from "@/lib/data/repositories/class-sessions.repository";
import type { SessionResponseDTO } from "./admin-sessions.types";

// TIME columns come back from pg as 'HH:MM:SS'; the UI works in 'HH:MM'.
const toHHMM = (time: string) => time.slice(0, 5);

// -------------------------------------------------------------------
// Map a joined session row to the UI DTO. sessionDate stays a 'YYYY-MM-DD'
// string - it is a calendar day, not an instant.
// -------------------------------------------------------------------
export function mapToSessionResponseDTO(row: ClassSessionWithRefs): SessionResponseDTO {
  return {
    id: row.id,
    classId: row.classId,
    className: row.className,
    programName: row.programName,
    teamId: row.teamId,
    teamName: row.teamName,
    sessionDate: row.sessionDate,
    sessionStart: toHHMM(row.sessionStart),
    sessionEnd: toHHMM(row.sessionEnd),
    status: row.status,
    notes: row.notes,
    classIsActive: row.classIsActive,
  };
}
