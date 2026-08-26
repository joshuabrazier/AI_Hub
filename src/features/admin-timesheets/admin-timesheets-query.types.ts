import { z } from "zod";

import { GRANULARITIES } from "@/lib/timesheet/period";

import { BILLABLE_FILTERS } from "./admin-timesheets.types";

// -------------------------------------------------------------------
// The figures a question can ask FOR.
//
// The model says which of these the question wanted; the ENGINE computes every
// one of them. That division is the same rule as everywhere else in this
// feature - the model chooses the shape of the question, never the value of an
// answer - and it is what lets the box answer "how much has that cost us"
// without becoming a second source of numbers.
// -------------------------------------------------------------------
export const QUERY_MEASURES = [
  "hours",
  "billableHours",
  "nonBillableHours",
  "value",
  "cost",
  "margin",
  "effectiveRate",
  "utilisation",
  // FORECASTS. Named separately from the actuals so a question asking what
  // something WILL cost cannot be answered with what it HAS cost - which is
  // the mistake that makes a forecast feature worse than none.
  "projectedCost",
  "projectedValue",
  "remainingCapacity",
] as const;

export type QueryMeasure = (typeof QUERY_MEASURES)[number];

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
  // SEVERAL people, because "Louis and Josh" is a normal thing to ask for.
  // Each id is checked against the offered options independently, so one
  // unknown name does not throw away the ones that were recognised.
  people: z.array(z.string().max(120)).max(50).nullable(),
  billable: z.enum(BILLABLE_FILTERS).nullable(),
  // Which figures the question asked for. Empty means it wanted a view rather
  // than an answer, which is the ordinary case.
  measures: z.array(z.enum(QUERY_MEASURES)).max(8).nullable(),
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
// One figure in an answer. `value` is already FORMATTED, by the same helpers
// the dashboards use, so the card and the tiles cannot render the same number
// two different ways - and a null figure arrives as "-" rather than as a zero
// somebody would act on.
export interface QueryMeasureDTO {
  key: QueryMeasure;
  label: string;
  value: string;
  // The caveat that belongs with this figure, if any: unrated hours behind a
  // value, a partial cost base behind a margin. Shown with the number, because
  // a qualified figure presented bare is the thing that misleads.
  caveat: string | null;
}

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
  // Present when the question asked for figures rather than a view. Every one
  // of them computed by the engine, never by the model.
  answer: {
    periodLabel: string;
    // The filters in words, so the answer states what it is an answer ABOUT.
    // A number with no scope on it is how "$8,430" gets quoted as the month
    // when it was one person's week.
    scope: string;
    measures: QueryMeasureDTO[];
  } | null;
}
