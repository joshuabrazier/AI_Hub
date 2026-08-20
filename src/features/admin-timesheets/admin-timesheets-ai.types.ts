import { z } from "zod";

// -------------------------------------------------------------------
// AI period summaries - DTOs and the action schema.
// -------------------------------------------------------------------

// Which screen asked. Two scopes rather than one because the questions differ:
// the overview is about the business, the staff view is about people, and a
// summary that tried to be both would be specific about neither.
export const TIMESHEET_SUMMARY_SCOPES = ["overview", "staff"] as const;

export type TimesheetSummaryScope = (typeof TIMESHEET_SUMMARY_SCOPES)[number];

// -------------------------------------------------------------------
// The four states the panel can be in, kept explicit rather than inferred
// from a null summary. "no summary yet", "the figures have moved since this
// was written" and "there is nothing to summarise" are three different things
// to say to a reader, and collapsing them into an empty string is how a panel
// ends up silent about which one it means.
// -------------------------------------------------------------------
export type TimesheetSummaryState =
  // Nothing cached for these filters.
  | "none"
  // Cached, and the figures still match what it describes.
  | "current"
  // Cached, but the numbers have changed since - most likely a Jira sync.
  | "stale"
  // No worklogs in the period, so there is nothing to write about.
  | "empty";

export interface TimesheetSummaryDTO {
  scope: TimesheetSummaryScope;
  // False when Bedrock is not configured on this deployment. The feature is
  // optional, so the panel explains itself rather than offering a button that
  // cannot work.
  available: boolean;
  state: TimesheetSummaryState;
  // Markdown, rendered through AiChatMarkdown. Null unless state is current
  // or stale.
  summary: string | null;
  generatedAt: Date | null;
}

// -------------------------------------------------------------------
// The action's input.
//
// The FILTERS ARE NOT TAKEN FROM THE CLIENT as a free-form object - only the
// same period and filter strings the page URL already carries, which the
// service then resolves through the ordinary timesheet service. So the worst
// a caller can do is ask for a summary of a period they can already see, and
// they must be an admin to reach it at all.
// -------------------------------------------------------------------
export const GenerateTimesheetSummarySchema = z.object({
  scope: z.enum(TIMESHEET_SUMMARY_SCOPES),
  granularity: z.string().min(1).max(20).optional(),
  start: z.string().min(1).max(20).optional(),
  category: z.string().max(120).optional(),
  project: z.string().max(120).optional(),
  person: z.string().max(120).optional(),
});

export type GenerateTimesheetSummaryRequestDTO = z.infer<typeof GenerateTimesheetSummarySchema>;
