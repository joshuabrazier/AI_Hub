import "server-only";

import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { NewLocation, UpdateLocation, USER_ROLES } from "@/lib/data/kysely-database-types";
import {
  createLocationRepo,
  getLocationsRepo,
  updateLocationByIdRepo,
} from "@/lib/data/repositories/locations.repository";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import { mapDBLocationToLocationResponseDTO } from "./admin-locations.mappers";
import { CreateLocationRequestDTO, LocationResponseDTO, UpdateLocationRequestDTO } from "./admin-locations.types";

// -------------------------------------------------------------------
// Admin locations service
//
// Venues are platform-level configuration, shared by every team's classes, so
// this whole file is admin-only. The guard is repeated in each entry point
// rather than left to the action: a service that trusts its caller is only as
// safe as the least careful caller it ever acquires.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Get locations. Returns a list of LocationResponseDTO.
// -------------------------------------------------------------------
export async function getLocationsService(): Promise<LocationResponseDTO[]> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const locations = await getLocationsRepo();

    return locations.map(mapDBLocationToLocationResponseDTO);
  } catch (error) {
    throw handleError("getLocationsService", error);
  }
}

// -------------------------------------------------------------------
// Create Location
// -------------------------------------------------------------------
export async function createLocationService(requestDTO: CreateLocationRequestDTO): Promise<string> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const now = new Date();

    const newLocation: NewLocation = {
      id: generateId(),
      name: requestDTO.name,
      address: requestDTO.address,
      isActive: requestDTO.isActive,
      createdAt: now,
      updatedAt: now,
    };

    const location = await createLocationRepo(newLocation);

    revalidatePath(ROUTES.ADMIN_LOCATIONS);
    // The class form's venue picker is built from this list.
    revalidatePath(ROUTES.ADMIN_CLASSES);

    return location.id;
  } catch (error) {
    throw handleError("createLocationService", error);
  }
}

// -------------------------------------------------------------------
// Update Location. Retiring one is isActive = false, never a delete - classes
// reference venues, so deleting would strand them.
// -------------------------------------------------------------------
export async function updateLocationService(requestDTO: UpdateLocationRequestDTO): Promise<string | undefined> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const updateLocation: UpdateLocation = {
      name: requestDTO.name,
      address: requestDTO.address,
      isActive: requestDTO.isActive,
      updatedAt: new Date(),
    };

    const location = await updateLocationByIdRepo(requestDTO.id, updateLocation);

    revalidatePath(ROUTES.ADMIN_LOCATIONS);
    revalidatePath(ROUTES.ADMIN_CLASSES);

    return location?.id;
  } catch (error) {
    throw handleError("updateLocationService", error);
  }
}
