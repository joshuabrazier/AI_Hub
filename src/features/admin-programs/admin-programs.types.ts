import { TABLE_ID_LENGTH } from "@/lib/constants";
import z from "zod";

// -------------------------------------------------------------------
// Program response DTO (what the UI consumes)
//
// A program is a named offering that classes are instances of. It carries no
// age bracket and no make-up relationships: both belonged to the swim-school
// model and have no equivalent here.
// -------------------------------------------------------------------
export type ProgramResponseDTO = {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  createdAt: string; // ISO - used for "date added" sorting
};

// -------------------------------------------------------------------
// Shared shape
// -------------------------------------------------------------------
const programBaseShape = {
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000),
  isActive: z.boolean(),
};

// -------------------------------------------------------------------
// Create / Update schemas + DTOs
// -------------------------------------------------------------------
export const CreateProgramSchema = z.object(programBaseShape);

export type CreateProgramRequestDTO = z.infer<typeof CreateProgramSchema>;

export const UpdateProgramSchema = z.object({ id: z.string().min(TABLE_ID_LENGTH), ...programBaseShape });

export type UpdateProgramRequestDTO = z.infer<typeof UpdateProgramSchema>;
