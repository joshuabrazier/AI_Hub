import { z } from "zod";

// -------------------------------------------------------------------
// Validate client environment variables
// -------------------------------------------------------------------
const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_TITLE: z.string().min(1),
  NEXT_PUBLIC_APP_DESCRIPTION: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),

  // The IANA timezone the app renders dates and times in. Optional with a
  // default so an existing deployment keeps working, but set it deliberately
  // per project - see src/lib/timezone.ts for why it matters.
  NEXT_PUBLIC_APP_TIME_ZONE: z.string().min(1).default("Australia/Adelaide"),

  NEXT_PUBLIC_BETTER_AUTH_COOKIE_PREFIX: z.string().min(1),

  NEXT_PUBLIC_PASSWORD_MIN_LENGTH: z.coerce.number().int().positive(),
  NEXT_PUBLIC_PASSWORD_MAX_LENGTH: z.coerce.number().int().positive(),
});

export const envClient = clientEnvSchema.parse({
  NEXT_PUBLIC_APP_TITLE: process.env.NEXT_PUBLIC_APP_TITLE,
  NEXT_PUBLIC_APP_DESCRIPTION: process.env.NEXT_PUBLIC_APP_DESCRIPTION,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_APP_TIME_ZONE: process.env.NEXT_PUBLIC_APP_TIME_ZONE,

  NEXT_PUBLIC_BETTER_AUTH_COOKIE_PREFIX: process.env.NEXT_PUBLIC_BETTER_AUTH_COOKIE_PREFIX,

  NEXT_PUBLIC_PASSWORD_MIN_LENGTH: process.env.NEXT_PUBLIC_PASSWORD_MIN_LENGTH,
  NEXT_PUBLIC_PASSWORD_MAX_LENGTH: process.env.NEXT_PUBLIC_PASSWORD_MAX_LENGTH,
});
