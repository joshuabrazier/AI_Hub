import z from "zod";

import { TABLE_ID_LENGTH } from "@/lib/constants";
import { type AiChatAttachmentKind, type AiChatRequestKind } from "@/lib/data/kysely-database-types";

const idSchema = z.string().min(TABLE_ID_LENGTH);

// How many calls one page of the log shows. Modest, because each row can
// carry a whole conversation and the detail view is where the reading
// actually happens.
export const AI_CHAT_LOG_PAGE_SIZE = 25;

// -------------------------------------------------------------------
// One turn as it was sent, inside a logged payload.
//
// `cachePoint` marks the turn the cache breakpoint rode on - the last one, so
// the cached prefix is the whole request. Surfaced because "why did this call
// cost full price" is usually answered by where that marker was.
// -------------------------------------------------------------------
export type LoggedMessageDTO = {
  role: string;
  text: string;
  cachePoint: boolean;
  // Files sent with this turn - what they were, not what was in them. The
  // log records that a file went to the model so its cost and its leaving
  // the organisation are both accounted for; the content stays private to
  // the person who uploaded it and is not reachable from this screen.
  //
  // Optional because rows written before attachments existed do not have
  // the field, and an old row is not a broken one.
  attachments?: LoggedAttachmentDTO[];
};

export type LoggedAttachmentDTO = {
  kind: AiChatAttachmentKind;
  format: string;
  // The SANITISED name the model saw, or null for an image - Converse
  // images carry no name field at all.
  name: string | null;
  byteSize: number;
};

// -------------------------------------------------------------------
// One row of the list. Deliberately carries no payload: the list is for
// scanning, and loading every conversation to render a table would be both
// slow and a needless spread of private content across a page that mostly
// gets glanced at.
// -------------------------------------------------------------------
export type AiChatRequestLogRowDTO = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  subjectId: string | null;
  kind: AiChatRequestKind;
  kindLabel: string;
  createdAt: Date;
  durationMs: number | null;
  messageCount: number;
  // Input as actually billed: uncached + cache reads + cache writes.
  totalInputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  truncated: boolean;
  error: string | null;
};

// -------------------------------------------------------------------
// The full payload of one call. Reading this writes an audit entry.
// -------------------------------------------------------------------
export type AiChatRequestLogDetailDTO = AiChatRequestLogRowDTO & {
  modelId: string;
  region: string;
  systemBlocks: string[];
  messages: LoggedMessageDTO[];
  inputTokens: number | null;
  cacheWriteTokens: number | null;
  // -----------------------------------------------------------------
  // Where the duration went.
  //
  // The duration beside it says a call took twenty seconds; this says
  // nineteen of them were spent compacting the thread before the model was
  // asked anything. Without it this screen could describe a failure without
  // being able to explain one, which is how "the model sent nothing for 20
  // seconds" survived as a diagnosis for weeks.
  //
  // Null is ordinary rather than a gap: rows predate the column, and a
  // compaction call is one request inside somebody else's turn.
  // -----------------------------------------------------------------
  phases: LoggedPhaseDTO[] | null;
  // What the turn as a whole did, beside the individual stages. Null
  // alongside the phases, for the same reasons.
  phaseSummary: LoggedPhaseSummaryDTO | null;
};

export type LoggedPhaseDTO = {
  name: string;
  ms: number;
  budgetMs: number;
  // "idle" budgets reset on every sign of life; "duration" is a hard
  // ceiling. Shown because the same elapsed number means different things
  // under the two, and reading an idle phase as a total is how a healthy
  // long reply gets mistaken for a slow one.
  kind: "duration" | "idle";
  timedOut: boolean;
};

export type LoggedPhaseSummaryDTO = {
  totalMs: number;
  timedOutPhase: string | null;
  // A reader who closed the tab. Not a fault, and saying so is what stops
  // the next person investigating a bug that is not there.
  readerLeft: boolean;
  // The overall time-to-first-byte ceiling rather than one phase's own
  // budget: every stage was within its limit and there were too many of
  // them. A different finding with a different remedy.
  ceilingHit: boolean;
  notes: Record<string, string | number | boolean>;
};

// One entry in the "filter by user" control.
export type AiChatLogUserOptionDTO = {
  id: string;
  name: string;
  email: string;
  requestCount: number;
};

export type AiChatLogPageDTO = {
  rows: AiChatRequestLogRowDTO[];
  users: AiChatLogUserOptionDTO[];
  // Echoed back so the control reflects what is actually being shown rather
  // than what was asked for.
  filteredUserId: string | null;
  page: number;
  pageCount: number;
  totalRows: number;
};

// -------------------------------------------------------------------
// Schemas
// -------------------------------------------------------------------
export const GetAiChatLogPageSchema = z.object({
  userId: idSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type GetAiChatLogPageRequestDTO = z.infer<typeof GetAiChatLogPageSchema>;

export const GetAiChatRequestLogDetailSchema = z.object({
  logId: idSchema,
});

export type GetAiChatRequestLogDetailRequestDTO = z.infer<typeof GetAiChatRequestLogDetailSchema>;
