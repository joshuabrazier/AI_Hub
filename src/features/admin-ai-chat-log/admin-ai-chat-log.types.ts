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
