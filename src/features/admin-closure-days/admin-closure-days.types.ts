import { TABLE_ID_LENGTH } from "@/lib/constants";
import z from "zod";

// -------------------------------------------------------------------
// Closure day DTO (what the UI consumes).
//
// `dayDate` stays a 'YYYY-MM-DD' string all the way to the screen: it is a
// calendar day, not an instant, and converting it to a Date would move it
// across midnight for anyone in another zone.
// -------------------------------------------------------------------
export type ClosureDayDTO = {
  id: string;
  dayDate: string;
  reason: string;
};

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");

// -------------------------------------------------------------------
// Add a closure day: the date, and a reason members will see.
// -------------------------------------------------------------------
export const CreateClosureDaySchema = z.object({
  dayDate: dateString,
  reason: z.string().trim().min(1, "Enter a reason").max(200),
});

export type CreateClosureDayRequestDTO = z.infer<typeof CreateClosureDaySchema>;

// -------------------------------------------------------------------
// Remove a closure day by id. The id is only a lookup key - the caller's
// authority is re-checked in the service, never inferred from it.
// -------------------------------------------------------------------
export const DeleteClosureDaySchema = z.object({
  id: z.string().min(TABLE_ID_LENGTH),
});

export type DeleteClosureDayRequestDTO = z.infer<typeof DeleteClosureDaySchema>;
