import { PASSWORD_INVALID_MESSAGE, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, TABLE_ID_LENGTH } from "@/lib/constants";
import { UserRole } from "@/lib/data/kysely-database-types";
import z from "zod";

export const ValidateInviteSchema = z.object({
  inviteToken: z.string().min(TABLE_ID_LENGTH),
});

export type ValidateInviteRequestDTO = z.infer<typeof ValidateInviteSchema>;

export type ValidateInviteResponseDTO = {
  name: string;
  email: string;
  role: UserRole;
};

export const AcceptInviteAndSignUpSchema = z
  .object({
    inviteToken: z.string().min(TABLE_ID_LENGTH),
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

export type AcceptInviteAndSignUpRequestDTO = z.infer<typeof AcceptInviteAndSignUpSchema>;
