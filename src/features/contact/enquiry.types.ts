import { z } from "zod";

import { phoneNumberSchema } from "@/lib/validation";

// -------------------------------------------------------------------
// Enquiry form
//
// Anyone can send an enquiry from the public contact page. It is emailed to
// the team and never stored, so this schema is the single source of truth for
// the fields - there is no table to read the shape from.
// -------------------------------------------------------------------

export const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type WeekDay = (typeof WEEK_DAYS)[number];

export const EnquirySchema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(120),
  phone: phoneNumberSchema({ requiredMessage: "Please enter a phone number", max: 40 }),
  email: z.string().trim().min(1, "Please enter your email").email("Enter a valid email address").max(255),
  // The chosen category's NAME, from the admin-managed list. Optional in the
  // sense that an empty string still submits: the list can legitimately be
  // empty on a fresh install, and a public lead form must not be blocked by a
  // dropdown with nothing in it.
  category: z.string().trim().max(120),
  preferredDays: z.array(z.enum(WEEK_DAYS)).max(7),
  message: z.string().trim().max(2000, "Please keep your message under 2000 characters"),
  // Honeypot: real people leave this empty; bots fill every field. Kept in the
  // schema (not rejected) so a filled value can be dropped silently server-side.
  company: z.string().max(200),
  // Time-trap: milliseconds the visitor spent on the form before submitting.
  // Humans take several seconds; a near-instant submit is almost certainly a
  // bot. Optional so a client that can't measure it still submits normally.
  elapsedMs: z.number().int().nonnegative().optional(),
});

export type EnquiryRequestDTO = z.infer<typeof EnquirySchema>;
