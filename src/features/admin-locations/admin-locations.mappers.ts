import type { Location } from "@/lib/data/kysely-database-types";
import type { LocationResponseDTO } from "./admin-locations.types";

// -------------------------------------------------------------------
// Map DB Location to Location Response DTO
// -------------------------------------------------------------------
export function mapDBLocationToLocationResponseDTO(location: Location): LocationResponseDTO {
  return {
    id: location.id,
    name: location.name,
    address: location.address,
    isActive: location.isActive,
  };
}
