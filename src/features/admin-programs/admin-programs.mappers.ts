import type { Program } from "@/lib/data/kysely-database-types";
import type { ProgramResponseDTO } from "./admin-programs.types";

// -------------------------------------------------------------------
// Map DB Program to Program Response DTO
// -------------------------------------------------------------------
export function mapDBProgramToProgramResponseDTO(program: Program): ProgramResponseDTO {
  return {
    id: program.id,
    name: program.name,
    description: program.description,
    isActive: program.isActive,
    createdAt: program.createdAt.toISOString(),
  };
}
