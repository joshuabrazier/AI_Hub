import z from "zod";

// -------------------------------------------------------------------
// Change email form (client) - includes the confirm field
// -------------------------------------------------------------------
export const changeEmailSchema = z
  .object({
    currentPassword: z.string().min(1, "Please enter your current password"),
    newEmail: z.email("Please enter a valid email address"),
    confirmNewEmail: z.email("Please enter a valid email address"),
  })
  .refine((data) => data.newEmail === data.confirmNewEmail, {
    message: "Email addresses do not match",
    path: ["confirmNewEmail"],
  });

export type ChangeEmailForm = z.infer<typeof changeEmailSchema>;

// -------------------------------------------------------------------
// Change email request (server action) - confirm field is client-only
// -------------------------------------------------------------------
export const changeEmailRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newEmail: z.email(),
});

export type ChangeEmailRequestDTO = z.infer<typeof changeEmailRequestSchema>;
