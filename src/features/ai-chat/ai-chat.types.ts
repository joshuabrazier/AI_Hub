import z from "zod";

import { TABLE_ID_LENGTH } from "@/lib/constants";
import { type AiChatAttachmentKind, type AiChatRole } from "@/lib/data/kysely-database-types";

// Ids are always re-checked server-side against the session user; the length
// bound only keeps obvious rubbish out of the query.
const subjectIdSchema = z.string().min(TABLE_ID_LENGTH);
const attachmentIdSchema = z.string().min(TABLE_ID_LENGTH);

// -------------------------------------------------------------------
// Bounds
//
// MAX_MESSAGE_CHARS caps one turn. It is not a safety control - the model
// would happily take more - it is there so a paste of an entire file lands
// as a clear validation error rather than a surprise bill.
//
// MAX_HISTORY_CHARS is a runaway guard, not a context-window limit. Every
// send replays the whole conversation by design, and input tokens therefore
// grow with the thread; this is the ceiling past which the oldest turns are
// dropped from the REQUEST (never from the database) so a very long thread
// cannot walk into the 20 MB payload cap or an unbounded per-message cost.
// ~400k characters is roughly 100k tokens, well inside the model's 1M
// window, so in practice it only trips on threads nobody is reading anyway.
// -------------------------------------------------------------------
export const MAX_MESSAGE_CHARS = 20_000;
export const MAX_HISTORY_CHARS = 400_000;

// -------------------------------------------------------------------
// Auto-compaction
//
// Every send replays the whole thread as fresh input, so a long
// conversation is re-billed on every message - the cost grows with the
// square of its length, not linearly. Compaction replaces the older turns
// with a summary so that stops.
//
// COMPACT_AT_INPUT_TOKENS is measured against the TOTAL input of the last
// reply (non-cached + cache reads + cache writes), which the model reports
// and we store. Measuring real tokens rather than guessing from character
// counts matters, because the trigger has to line up with what is billed.
//
// KEEP_RECENT_MESSAGES survive verbatim. Too few and follow-ups like
// "change that to blue" lose their referent, so this is deliberately more
// than a couple of exchanges.
//
// SUMMARY_MAX_TOKENS bounds the summary itself. A summary that grows without
// limit just recreates the problem it was meant to solve.
// -------------------------------------------------------------------
export const COMPACT_AT_INPUT_TOKENS = 60_000;
export const KEEP_RECENT_MESSAGES = 8;
export const SUMMARY_MAX_TOKENS = 2_000;

// -------------------------------------------------------------------
// Prompt caching
//
// Amazon Bedrock caches the prefix of a request that sits before a
// `cachePoint`, and bills reads at roughly a tenth of the input rate. For a
// chat thread the entire history is that prefix, so one cache point at the
// very end of the request means every following turn reads the whole
// conversation back cheaply instead of paying full price to resend it.
//
// Two limits from AWS's model table, both specific to Opus 4.6:
//   - 4,096 tokens minimum per checkpoint. Below that the request still
//     succeeds, it simply does not cache - so a short thread costs nothing
//     extra and there is no reason to withhold the cache point.
//   - 5 MINUTE TTL, with no 1-hour option on this model. A reader who steps
//     away loses the cache and pays a full re-read on their next message.
//     That is precisely why compaction earns its place alongside caching:
//     caching makes a busy conversation cheap, compaction makes a long one
//     cheap even when it goes cold.
// -------------------------------------------------------------------
export const CACHE_MINIMUM_TOKENS = 4_096;

// How many characters of the first user turn become the conversation title.
export const TITLE_MAX_CHARS = 60;

// The title a conversation carries until its first message names it.
export const UNTITLED_SUBJECT_TITLE = "New chat";

// -------------------------------------------------------------------
// One conversation in the sidebar.
// -------------------------------------------------------------------
export type AiChatSubjectDTO = {
  id: string;
  title: string;
  messageCount: number;
  // Null for a conversation that has not been used yet. Ordering already
  // accounts for that server-side; this is only for display.
  lastMessageAt: Date | null;
};

// -------------------------------------------------------------------
// One attached file, as the screen sees it.
//
// Never carries the bytes. The transcript renders names and sizes, and the
// download route serves the content on demand - so opening a conversation
// with twenty photos in it does not ship twenty photos to the browser.
//
// `fileName` is the name the user's own filesystem gave it, and it is
// untrusted text: rendered as a text node, never as HTML, and never
// interpolated into a URL or a header without encoding.
// -------------------------------------------------------------------
export type AiChatAttachmentDTO = {
  id: string;
  kind: AiChatAttachmentKind;
  format: string;
  fileName: string;
  mediaType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
};

// -------------------------------------------------------------------
// One turn of a conversation.
//
// Token counts are present only on assistant turns, and only when the
// stream ran to completion - a reply the reader stopped part-way through has
// no usage metadata to record. They are shown so spend is visible per
// answer rather than only in an AWS bill.
// -------------------------------------------------------------------
export type AiChatMessageDTO = {
  id: string;
  role: AiChatRole;
  content: string;
  createdAt: Date;
  // Non-cached input only - see totalInputTokens below.
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  // The three input figures added up, which is what was actually sent.
  // Derived in the mapper rather than in the component so every surface
  // that shows a token count shows the same number.
  totalInputTokens: number | null;
  // Files sent with this turn. Only ever populated on user turns - the
  // model returns text, so an assistant turn has nothing to attach.
  attachments: AiChatAttachmentDTO[];
};

// -------------------------------------------------------------------
// The conversation currently open, with its full transcript.
// -------------------------------------------------------------------
export type AiChatSubjectDetailDTO = {
  subject: AiChatSubjectDTO;
  messages: AiChatMessageDTO[];
  // Files uploaded from the composer but not yet sent. They survive a page
  // reload because they are rows, not browser state - so choosing a large
  // PDF and then refreshing does not silently lose it.
  staged: AiChatAttachmentDTO[];
  // The id of the last turn covered by the summary, or null if this thread
  // has never been compacted. The transcript still shows every message; the
  // UI uses this to mark where the model's own recall becomes a summary,
  // so a reader is never left wondering why it forgot something.
  summarizedThroughMessageId: string | null;
};

// -------------------------------------------------------------------
// Everything the chat screen renders in one pass.
//
// `isConfigured` is false when no Bedrock token is set. The screen then
// explains that rather than offering a composer that cannot send, because a
// send that fails at the network layer reads as a bug in the product.
// -------------------------------------------------------------------
export type AiChatPageDTO = {
  isConfigured: boolean;
  subjects: AiChatSubjectDTO[];
  // Null when the user has no conversations yet, or asked for one that is
  // not theirs (which is answered as "no such conversation").
  active: AiChatSubjectDetailDTO | null;
};

// -------------------------------------------------------------------
// Schemas
//
// Every one of these carries a subject id from the client, and none of them
// is proof of anything: the service re-resolves the conversation against the
// SESSION user before touching a row.
// -------------------------------------------------------------------
export const GetAiChatPageSchema = z.object({
  // Which conversation to open. Absent means "the most recent one".
  subjectId: subjectIdSchema.optional(),
});

export type GetAiChatPageRequestDTO = z.infer<typeof GetAiChatPageSchema>;

export const CreateAiChatSubjectSchema = z.object({});

export type CreateAiChatSubjectRequestDTO = z.infer<typeof CreateAiChatSubjectSchema>;

export const RenameAiChatSubjectSchema = z.object({
  subjectId: subjectIdSchema,
  title: z.string().trim().min(1, "Please enter a title").max(TITLE_MAX_CHARS),
});

export type RenameAiChatSubjectRequestDTO = z.infer<typeof RenameAiChatSubjectSchema>;

export const DeleteAiChatSubjectSchema = z.object({
  subjectId: subjectIdSchema,
});

export type DeleteAiChatSubjectRequestDTO = z.infer<typeof DeleteAiChatSubjectSchema>;

// -------------------------------------------------------------------
// The streaming send.
//
// Validated in the route handler rather than an action, because the reply
// streams and a server action cannot return a stream. Same Zod-at-the-
// boundary rule as everywhere else; only the boundary differs.
// -------------------------------------------------------------------
export const SendAiChatMessageSchema = z.object({
  subjectId: subjectIdSchema,
  content: z
    .string()
    .trim()
    .min(1, "Please enter a message")
    .max(MAX_MESSAGE_CHARS, `Please keep a message under ${MAX_MESSAGE_CHARS} characters`),
});

export type SendAiChatMessageRequestDTO = z.infer<typeof SendAiChatMessageSchema>;

// -------------------------------------------------------------------
// Attachments.
//
// The upload itself is multipart and its file is validated by inspecting
// the BYTES (see src/lib/ai/attachment-formats.ts), not by a schema - a
// Zod rule can only describe what the client claimed. This schema covers
// the one field that travels alongside it.
// -------------------------------------------------------------------
export const UploadAiChatAttachmentSchema = z.object({
  subjectId: subjectIdSchema,
});

export type UploadAiChatAttachmentRequestDTO = z.infer<typeof UploadAiChatAttachmentSchema>;

export const RemoveAiChatAttachmentSchema = z.object({
  attachmentId: attachmentIdSchema,
});

export type RemoveAiChatAttachmentRequestDTO = z.infer<typeof RemoveAiChatAttachmentSchema>;
