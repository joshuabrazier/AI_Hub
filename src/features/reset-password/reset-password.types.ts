import { PASSWORD_INVALID_MESSAGE, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/constants";
import z from "zod";

export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, { message: PASSWORD_INVALID_MESSAGE })
      .max(PASSWORD_MAX_LENGTH, { message: PASSWORD_INVALID_MESSAGE }),
    confirmPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, { message: PASSWORD_INVALID_MESSAGE })
      .max(PASSWORD_MAX_LENGTH, { message: PASSWORD_INVALID_MESSAGE }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;
