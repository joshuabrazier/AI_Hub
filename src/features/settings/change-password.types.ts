import { PASSWORD_INVALID_MESSAGE, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/constants";
import z from "zod";

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Please enter your current password"),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, { message: PASSWORD_INVALID_MESSAGE })
      .max(PASSWORD_MAX_LENGTH, { message: PASSWORD_INVALID_MESSAGE }),
    confirmNewPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, { message: PASSWORD_INVALID_MESSAGE })
      .max(PASSWORD_MAX_LENGTH, { message: PASSWORD_INVALID_MESSAGE }),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords do not match",
    path: ["confirmNewPassword"],
  });

export type ChangePasswordForm = z.infer<typeof changePasswordSchema>;
