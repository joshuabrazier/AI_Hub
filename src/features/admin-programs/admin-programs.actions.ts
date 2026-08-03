"use server";

import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { ServerApiResponse } from "@/lib/types";
import { validateRequest } from "@/lib/server-requests";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { handleServerApiError } from "@/lib/handle-errors";

import {
  CreateProgramRequestDTO,
  CreateProgramSchema,
  ProgramResponseDTO,
  UpdateProgramRequestDTO,
  UpdateProgramSchema,
} from "./admin-programs.types";
import { createProgramService, getProgramsService, updateProgramService } from "./admin-programs.service";

// -------------------------------------------------------------------
// Get Programs
// -------------------------------------------------------------------
export async function getProgramsAction(): Promise<ServerApiResponse<ProgramResponseDTO[]>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const programs = await getProgramsService();

    return {
      success: true,
      data: programs,
    } satisfies ServerApiResponse<ProgramResponseDTO[]>;
  } catch (error) {
    return handleServerApiError("getProgramsAction", error);
  }
}

// -------------------------------------------------------------------
// Create Program
// -------------------------------------------------------------------
export async function createProgramAction(
  requestDTO: CreateProgramRequestDTO,
): Promise<ServerApiResponse<string>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(CreateProgramSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const programId = await createProgramService(validatedRequest.data);

    return {
      success: true,
      data: programId,
    } satisfies ServerApiResponse<string>;
  } catch (error) {
    return handleServerApiError("createProgramAction", error);
  }
}

// -------------------------------------------------------------------
// Update Program
// -------------------------------------------------------------------
export async function updateProgramAction(
  requestDTO: UpdateProgramRequestDTO,
): Promise<ServerApiResponse<string | undefined>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(UpdateProgramSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const programId = await updateProgramService(validatedRequest.data);

    return {
      success: true,
      data: programId,
    } satisfies ServerApiResponse<string | undefined>;
  } catch (error) {
    return handleServerApiError("updateProgramAction", error);
  }
}
