import { z } from "zod";

// -------------------------------------------------------------------
// Staff rates - DTOs and the action schemas.
//
// The FORM works in dollars, because that is what a person types. STORAGE is
// integer cents. The conversion happens once, at the schema boundary, so
// nothing downstream ever handles a fractional amount - see migration 007 for
// why floats are not an option here.
// -------------------------------------------------------------------

export interface StaffRateDTO {
  id: string;
  personId: string;
  personName: string | null;
  effectiveFrom: string;
  chargeRateCents: number;
  costRateCents: number | null;
  notes: string | null;
}

export interface PersonRatesDTO {
  personId: string;
  // Newest first, which is the order somebody reads their own rate history in.
  rates: StaffRateDTO[];
  // The rate in force today, for the summary line. Null when they have none.
  currentChargeRateCents: number | null;
  currentCostRateCents: number | null;
}

// Dollars in, integer cents out. At most two decimal places: $150.505 is a
// typo rather than a rate, and rounding it silently would bury the mistake in
// the money instead of showing it to the person typing.
const dollars = z.coerce
  .number()
  .min(0, "A rate cannot be negative")
  .max(100_000, "That rate looks wrong")
  .refine((value) => {
    // Float arithmetic, so compared with a tolerance rather than for equality:
    // 150.5 * 100 is 15049.999999999998 on some inputs.
    const cents = value * 100;
    return Math.abs(cents - Math.round(cents)) < 1e-6;
  }, "Use at most two decimal places")
  .transform((value) => Math.round(value * 100));

// Empty means "not recorded", which for a cost rate is a real answer: margin
// stays unknown rather than becoming 100%.
const optionalDollars = z
  .union([z.literal(""), dollars])
  .transform((value) => (value === "" ? null : value));

export const SaveStaffRateSchema = z.object({
  personId: z.string().min(1, "A person is required"),
  personName: z.string().optional(),
  // 'YYYY-MM-DD'. The date the rate starts applying FROM, not the date it was
  // entered: backdating is the normal case when somebody sets rates up for the
  // first time.
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-07-01")
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, "That date does not exist"),
  // Required: a row with no charge rate is not a rate.
  chargeRate: dollars,
  // Optional. Empty means nobody has recorded a cost, so margin stays unknown.
  costRate: optionalDollars,
  notes: z.string().max(300).optional(),
});

// TWO types, because the schema converts: the client sends dollars as typed
// strings, the service receives integer cents. Conflating them is how a form
// ends up posting "220" into a field annotated as a number.
export type SaveStaffRateInputDTO = z.input<typeof SaveStaffRateSchema>;
export type SaveStaffRateRequestDTO = z.output<typeof SaveStaffRateSchema>;

export const DeleteStaffRateSchema = z.object({
  id: z.string().min(1).max(120),
});

export type DeleteStaffRateRequestDTO = z.infer<typeof DeleteStaffRateSchema>;
