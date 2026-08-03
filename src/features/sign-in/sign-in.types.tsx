import { PASSWORD_INVALID_MESSAGE, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/constants";
import z from "zod";

export const signInSchema = z.object({
  email: z.email("Please enter a valid email address"),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, { message: PASSWORD_INVALID_MESSAGE })
    .max(PASSWORD_MAX_LENGTH, { message: PASSWORD_INVALID_MESSAGE }),
  rememberMe: z.boolean(),
});

export type SignInForm = z.infer<typeof signInSchema>;
