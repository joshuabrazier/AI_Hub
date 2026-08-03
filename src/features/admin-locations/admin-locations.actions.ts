"use server";

import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { ServerApiResponse } from "@/lib/types";
import { validateRequest } from "@/lib/server-requests";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { handleServerApiError } from "@/lib/handle-errors";

import {
  CreateLocationRequestDTO,
  CreateLocationSchema,
  LocationResponseDTO,
  UpdateLocationRequestDTO,
  UpdateLocationSchema,
} from "./admin-locations.types";
import { createLocationService, getLocationsService, updateLocationService } from "./admin-locations.service";

// -------------------------------------------------------------------
// Get Locations
// -------------------------------------------------------------------
export async function getLocationsAction(): Promise<ServerApiResponse<LocationResponseDTO[]>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const locations = await getLocationsService();

    return {
      success: true,
      data: locations,
    } satisfies ServerApiResponse<LocationResponseDTO[]>;
  } catch (error) {
    return handleServerApiError("getLocationsAction", error);
  }
}

// -------------------------------------------------------------------
// Create Location
// -------------------------------------------------------------------
export async function createLocationAction(
  requestDTO: CreateLocationRequestDTO,
): Promise<ServerApiResponse<string>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(CreateLocationSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const locationId = await createLocationService(validatedRequest.data);

    return {
      success: true,
      data: locationId,
    } satisfies ServerApiResponse<string>;
  } catch (error) {
    return handleServerApiError("createLocationAction", error);
  }
}

// -------------------------------------------------------------------
// Update Location
// -------------------------------------------------------------------
export async function updateLocationAction(
  requestDTO: UpdateLocationRequestDTO,
): Promise<ServerApiResponse<string | undefined>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(UpdateLocationSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const locationId = await updateLocationService(validatedRequest.data);

    return {
      success: true,
      data: locationId,
    } satisfies ServerApiResponse<string | undefined>;
  } catch (error) {
    return handleServerApiError("updateLocationAction", error);
  }
}
