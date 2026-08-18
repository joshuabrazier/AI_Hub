import z from "zod";

import { phoneNumberSchema } from "@/lib/validation";

// -------------------------------------------------------------------
// First-run account setup.
//
// Shown once, after somebody's first Microsoft sign-in, before they can
// reach any area of the app.
//
// EMAIL IS NOT IN THIS SHAPE, and that is the important part. The address is
// the link to the Entra identity and the value the domain allowlist is
// checked against; if it were editable here, somebody could sign in on an
// allowed domain and then change their address to anything. It is displayed
// read-only and never accepted from the client.
//
// Role and team are likewise absent: both are server-assigned, from an
// invitation or by an admin.
// -------------------------------------------------------------------
export type AccountSetupDTO = {
  // Prefilled from what Entra asserted, for them to confirm or correct.
  name: string;
  preferredName: string;
  phoneNumber: string;
  // Display only.
  email: string;
};

export const CompleteAccountSetupSchema = z.object({
  name: z.string().trim().min(1, "Please enter your full name").max(255),
  preferredName: z.string().trim().max(120),
  phoneNumber: phoneNumberSchema().or(z.literal("")),
});

export type CompleteAccountSetupRequestDTO = z.infer<typeof CompleteAccountSetupSchema>;
