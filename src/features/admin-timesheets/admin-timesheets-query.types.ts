import { z } from "zod";

import { GRANULARITIES } from "@/lib/timesheet/period";

// -------------------------------------------------------------------
// Natural-language filter resolution - DTOs and schemas.
//
// THE MODEL RETURNS FILTERS, NEVER SQL. That is the whole security design and
// it is worth stating plainly: repositories are the only database access in
// this app, every query they build is typed and parameterised, and a model
// emitting SQL would break both in one step. What comes back here is a small
// object of the same shape the URL already carries, and the dashboard then
// runs exactly the query it always runs.
//
// A SHAPE CHECK IS NOT ENOUGH, which is the part that is easy to get wrong.
// Zod can prove `person` is a string; it cannot prove it is a person. The
// service therefore checks every returned value against the options actually
// offered for that period, and rejects anything else. Two reasons, and the
// second matters more day to day:
//
//   1. An invented value would flow into a query predicate. Parameterised, so
//      not injectable - but still an input nobody chose.
//   2. An invented value produces a SILENTLY EMPTY dashboard, which reads as
//      "no time logged" rather than "I misunderstood you". That is the failure
//      mode that would make the feature untrustworthy.
// -------------------------------------------------------------------

export const QUERY_MAX_LENGTH = 300;

// What the model is required to hand back. Deliberately flat and small: every
// field maps to a URL parameter that already exists.
export const ResolvedQuerySchema = z.object({
  // False when the question is not about filtering a timesheet period at all.
  // Having the model say so is better than having it guess, because a guess
  // renders as a confident dashboard of the wrong thing.
  understood: z.boolean(),
  granularity: z.enum(GRANULARITIES).nullable(),
  // Any date inside the wanted period, 'YYYY-MM-DD'. The period code snaps it
  // to the start of its own period, so the 15th and the 20th open the same
  // month.
  start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "start must be YYYY-MM-DD")
    .nullable(),
  // 'all', or a value from the options offered. Checked against them in the
  // service - see the note above.
  category: z.string().max(120).nullable(),
  project: z.string().max(120).nullable(),
  person: z.string().max(120).nullable(),
  // One sentence, in the model's own words, saying what it took the question
  // to mean. Shown to the reader so a misreading is visible rather than
  // silent.
  interpretation: z.string().max(300),
});

export type ResolvedQuery = z.infer<typeof ResolvedQuerySchema>;

export const AskTimesheetQuerySchema = z.object({
  question: z.string().trim().min(1, "Ask a question").max(QUERY_MAX_LENGTH),
  // The period the asker is currently looking at, so "last month" and "the
  // week before" have something to be relative to.
  granularity: z.string().min(1).max(20).optional(),
  start: z.string().min(1).max(20).optional(),
});

export type AskTimesheetQueryRequestDTO = z.infer<typeof AskTimesheetQuerySchema>;

// -------------------------------------------------------------------
// What the action hands back to the page.
//
// `href` is a relative path built by the SERVER from validated values, never a
// URL the model produced. A model-supplied URL would be an open-redirect
// waiting to happen; a model-supplied filter tuple cannot be, because the
// server decides what to do with it.
// -------------------------------------------------------------------
export interface TimesheetQueryResultDTO {
  understood: boolean;
  // Present when understood. A relative path on this app.
  href: string | null;
  // What the model took the question to mean, always shown.
  interpretation: string;
  // Set when a value was dropped because it was not one of the offered
  // options. Surfaced rather than swallowed: "I could not find a person called
  // that" is a useful answer and an empty dashboard is not.
  rejected: string[];
}
