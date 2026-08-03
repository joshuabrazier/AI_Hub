import { z } from "zod";

// -------------------------------------------------------------------
// Shared field validators, so the same rules apply everywhere a field
// is collected (enquiry form, onboarding, admin edit, ...).
// -------------------------------------------------------------------

// A phone number: digits plus the usual separators (spaces, hyphens,
// parentheses, a leading +). Requires at least 8 digits, which covers
// Australian landline/mobile (10 digits) and international numbers while
// rejecting free text like "call me". Deliberately permissive on format -
// we validate that it's plausibly a phone number, not a specific country's
// layout. Pass a custom `requiredMessage`/`max` per form.
export function phoneNumberSchema(options?: { requiredMessage?: string; max?: number }) {
  return z
    .string()
    .trim()
    .min(1, options?.requiredMessage ?? "Please enter a phone number")
    .max(options?.max ?? 30)
    .regex(/^\+?[0-9\s()-]+$/, "Enter a valid phone number")
    .refine((value) => value.replace(/\D/g, "").length >= 8, "Enter a valid phone number");
}

// A date of birth: a real 'YYYY-MM-DD' calendar date that is NOT in the future
// (nobody is born tomorrow). Compared on local date parts as strings, so it's
// timezone-stable and "today" is allowed. Pass a custom `invalidMessage` per form.
export function dateOfBirthSchema(invalidMessage = "Enter a valid date of birth") {
  const isRealDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
  return z
    .string()
    .refine(isRealDate, invalidMessage)
    .refine((value) => {
      if (!isRealDate(value)) return true; // an invalid date is already reported above
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      return value <= today;
    }, "Date of birth can't be in the future");
}
