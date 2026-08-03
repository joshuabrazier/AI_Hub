import type { ClosureDay } from "@/lib/data/kysely-database-types";
import type { ClosureDayDTO } from "./admin-closure-days.types";

// -------------------------------------------------------------------
// Map a DB closure day to its UI DTO.
// -------------------------------------------------------------------
export function mapClosureDayToDTO(row: ClosureDay): ClosureDayDTO {
  return {
    id: row.id,
    dayDate: row.dayDate,
    reason: row.reason,
  };
}
