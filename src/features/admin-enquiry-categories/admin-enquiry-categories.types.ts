import z from "zod";

// -------------------------------------------------------------------
// Enquiry categories
// The admin-managed options behind the public enquiry form's category
// dropdown. Enquiries are emailed rather than stored, so only the chosen
// option's NAME is ever used - which is why there is no delete: retiring a
// category means deactivating it, and past emails keep quoting a name that
// really existed at the time.
// -------------------------------------------------------------------
export type EnquiryCategoryResponseDTO = {
  id: string;
  name: string;
  isActive: boolean;
  orderBy: number;
};

// What the public enquiry form's dropdown renders. The value is the NAME, not
// the id: the name is what gets emailed, and the form has nothing to resolve
// an id against.
export type EnquiryCategoryOptionDTO = {
  value: string;
  label: string;
};

// -------------------------------------------------------------------
// Create / Update schemas + DTOs
// -------------------------------------------------------------------
export const createEnquiryCategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  isActive: z.boolean(),
  orderBy: z.number().int().min(1, "Must be greater than 0"),
});

export type CreateEnquiryCategoryRequestDTO = z.infer<typeof createEnquiryCategorySchema>;

export const updateEnquiryCategorySchema = z.object({
  // Ids are opaque strings; admin-created categories use a generated id, so
  // only require that one is present, not a fixed length.
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
  orderBy: z.number().int().min(1).optional(),
});

export type UpdateEnquiryCategoryRequestDTO = z.infer<typeof updateEnquiryCategorySchema>;
