import { TABLE_ID_LENGTH } from "@/lib/constants";
import z from "zod";

// -------------------------------------------------------------------
// Class location response DTO (what the UI consumes)
// -------------------------------------------------------------------
export type LocationResponseDTO = {
  id: string;
  name: string;
  address: string;
  isActive: boolean;
};

// -------------------------------------------------------------------
// Shared shape
// -------------------------------------------------------------------
const locationBaseShape = {
  name: z.string().trim().min(1, "Name is required").max(120),
  address: z.string().trim().min(1, "Address is required").max(500),
  isActive: z.boolean(),
};

// -------------------------------------------------------------------
// Create / Update schemas + DTOs
// -------------------------------------------------------------------
export const CreateLocationSchema = z.object(locationBaseShape);

export type CreateLocationRequestDTO = z.infer<typeof CreateLocationSchema>;

export const UpdateLocationSchema = z.object({ id: z.string().min(TABLE_ID_LENGTH), ...locationBaseShape });

export type UpdateLocationRequestDTO = z.infer<typeof UpdateLocationSchema>;
