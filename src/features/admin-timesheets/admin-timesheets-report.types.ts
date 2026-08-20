import { z } from "zod";

import type { ReportFacts } from "@/lib/timesheet/report-facts";

// -------------------------------------------------------------------
// Saved timesheet reports - DTOs and the action schemas.
// -------------------------------------------------------------------

export const REPORT_TITLE_MAX_LENGTH = 120;

export interface TimesheetReportListItemDTO {
  id: string;
  title: string;
  periodLabel: string;
  granularity: string;
  periodStart: string;
  // "all" when unfiltered. Shown on the list so a report of one project is
  // never mistaken for a report of the business.
  category: string;
  project: string;
  person: string;
  authorName: string | null;
  createdAt: Date;
}

export interface TimesheetReportDTO extends TimesheetReportListItemDTO {
  // The model's markdown.
  body: string;
  // The figures it was written from, snapshotted at the time. Typed as
  // unknown-ish rather than ReportFacts on read: an old row was written
  // against an older shape, and the detail panel has to render it without
  // asserting it still matches today's type.
  facts: Partial<ReportFacts> | null;
  modelId: string;
  totalInputTokens: number | null;
  outputTokens: number | null;
}

// -------------------------------------------------------------------
// Whether reports can be written at all on this deployment, plus the list.
// One DTO so the page makes one call and cannot render a Create button over
// an unconfigured model.
// -------------------------------------------------------------------
export interface TimesheetReportsPageDTO {
  available: boolean;
  reports: TimesheetReportListItemDTO[];
}

// -------------------------------------------------------------------
// Creating one.
//
// The title is the only free text a person supplies. It is trimmed and
// bounded, and it lands in the prompt as the report's subject line - which is
// worth naming: an admin who writes an instruction into the title is
// instructing a report they asked for and will read themselves, so it is not
// a privilege boundary. The untrusted text that matters is inside the facts,
// and that is delimited.
// -------------------------------------------------------------------
export const CreateTimesheetReportSchema = z.object({
  title: z.string().trim().min(1, "Give the report a name").max(REPORT_TITLE_MAX_LENGTH),
  granularity: z.string().min(1).max(20).optional(),
  start: z.string().min(1).max(20).optional(),
  category: z.string().max(120).optional(),
  project: z.string().max(120).optional(),
  person: z.string().max(120).optional(),
});

export type CreateTimesheetReportRequestDTO = z.infer<typeof CreateTimesheetReportSchema>;

export const DeleteTimesheetReportSchema = z.object({
  id: z.string().min(1).max(120),
});

export type DeleteTimesheetReportRequestDTO = z.infer<typeof DeleteTimesheetReportSchema>;
