import z from "zod";

export type NotificationTypeResponseDTO = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isActive: boolean;
  orderBy: number;
};

// -------------------------------------------------------------------
// Create / Update schemas + DTOs. The admin sets the label (name), order and
// active flag; the stable `key` is derived from the name server-side and never
// edited (so stored notifications keep resolving).
// -------------------------------------------------------------------
export const createNotificationTypeSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(200).optional(),
  isActive: z.boolean(),
  orderBy: z.number().int().min(1, "Must be greater than 0"),
});

export type CreateNotificationTypeRequestDTO = z.infer<typeof createNotificationTypeSchema>;

export const updateNotificationTypeSchema = z.object({
  // Opaque id: built-in types use short fixed ids (e.g. "ntype_general"),
  // admin-created ones a longer generated id, so only require it's present.
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().trim().max(200).optional(),
  isActive: z.boolean().optional(),
  orderBy: z.number().int().min(1).optional(),
});

export type UpdateNotificationTypeRequestDTO = z.infer<typeof updateNotificationTypeSchema>;
