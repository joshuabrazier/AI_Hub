import "server-only";

import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { NewProgram, UpdateProgram, USER_ROLES } from "@/lib/data/kysely-database-types";
import {
  createProgramRepo,
  getProgramsRepo,
  updateProgramByIdRepo,
} from "@/lib/data/repositories/programs.repository";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import { mapDBProgramToProgramResponseDTO } from "./admin-programs.mappers";
import { CreateProgramRequestDTO, ProgramResponseDTO, UpdateProgramRequestDTO } from "./admin-programs.types";

// -------------------------------------------------------------------
// Admin programs service
//
// Programs are platform-level configuration: they belong to no team, and a
// class of any team may be an instance of any program. So the whole file is
// admin-only, and every entry point says so itself rather than trusting the
// action that called it - a service that relies on its caller is only as safe
// as the least careful caller it ever acquires.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Get programs. Returns a list of ProgramResponseDTO.
// -------------------------------------------------------------------
export async function getProgramsService(): Promise<ProgramResponseDTO[]> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const programs = await getProgramsRepo();

    return programs.map(mapDBProgramToProgramResponseDTO);
  } catch (error) {
    throw handleError("getProgramsService", error);
  }
}

// -------------------------------------------------------------------
// Create Program
// -------------------------------------------------------------------
export async function createProgramService(requestDTO: CreateProgramRequestDTO): Promise<string> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const now = new Date();

    const newProgram: NewProgram = {
      id: generateId(),
      name: requestDTO.name,
      description: requestDTO.description,
      isActive: requestDTO.isActive,
      createdAt: now,
      updatedAt: now,
    };

    const program = await createProgramRepo(newProgram);

    revalidatePath(ROUTES.ADMIN_PROGRAMS);
    // The class form's program picker is built from this list.
    revalidatePath(ROUTES.ADMIN_CLASSES);

    return program.id;
  } catch (error) {
    throw handleError("createProgramService", error);
  }
}

// -------------------------------------------------------------------
// Update Program. Retiring one is isActive = false, never a delete - classes
// reference programs, so deleting would strand them.
// -------------------------------------------------------------------
export async function updateProgramService(requestDTO: UpdateProgramRequestDTO): Promise<string | undefined> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const updateProgram: UpdateProgram = {
      name: requestDTO.name,
      description: requestDTO.description,
      isActive: requestDTO.isActive,
      updatedAt: new Date(),
    };

    const program = await updateProgramByIdRepo(requestDTO.id, updateProgram);

    revalidatePath(ROUTES.ADMIN_PROGRAMS);
    revalidatePath(ROUTES.ADMIN_CLASSES);

    return program?.id;
  } catch (error) {
    throw handleError("updateProgramService", error);
  }
}
