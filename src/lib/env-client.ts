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

  // What the AI assistant is called on this deployment, e.g. "Saga".
  //
  // OPTIONAL WITH NO DEFAULT, and that is the point. This is a base repo, so
  // it must not ship somebody else's product name - and a generic default
  // like "Assistant" is worse than none, because "You are Assistant, a
  // general-purpose AI assistant" is a sentence no prompt should contain.
  // Unset, every surface says "the assistant" exactly as it did before this
  // variable existed; set, the same surfaces use the name. See
  // src/features/ai-chat/assistant-identity.ts.
  NEXT_PUBLIC_AI_ASSISTANT_NAME: z.string().min(1).optional(),

  NEXT_PUBLIC_BETTER_AUTH_COOKIE_PREFIX: z.string().min(1),

  NEXT_PUBLIC_PASSWORD_MIN_LENGTH: z.coerce.number().int().positive(),
  NEXT_PUBLIC_PASSWORD_MAX_LENGTH: z.coerce.number().int().positive(),

  // The VAPID PUBLIC key, which the browser needs to subscribe. Public by
  // definition - it is handed to every visitor - so it belongs here rather
  // than in the server env. Its private half is VAPID_PRIVATE_KEY and must
  // never appear in a NEXT_PUBLIC_ variable.
  //
  // Optional: with it unset the notification toggle renders nothing and the
  // send path is a no-op, so an environment without push behaves exactly as
  // it did before push existed.
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
});

export const envClient = clientEnvSchema.parse({
  NEXT_PUBLIC_APP_TITLE: process.env.NEXT_PUBLIC_APP_TITLE,
  NEXT_PUBLIC_APP_DESCRIPTION: process.env.NEXT_PUBLIC_APP_DESCRIPTION,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_APP_TIME_ZONE: process.env.NEXT_PUBLIC_APP_TIME_ZONE,

  NEXT_PUBLIC_AI_ASSISTANT_NAME: process.env.NEXT_PUBLIC_AI_ASSISTANT_NAME,

  NEXT_PUBLIC_BETTER_AUTH_COOKIE_PREFIX: process.env.NEXT_PUBLIC_BETTER_AUTH_COOKIE_PREFIX,

  NEXT_PUBLIC_PASSWORD_MIN_LENGTH: process.env.NEXT_PUBLIC_PASSWORD_MIN_LENGTH,
  NEXT_PUBLIC_PASSWORD_MAX_LENGTH: process.env.NEXT_PUBLIC_PASSWORD_MAX_LENGTH,

  NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
});
