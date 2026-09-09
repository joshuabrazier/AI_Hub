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
  // Whether attachment storage is set up. Separate from `isConfigured`
  // because the two fail independently: an environment can have a working
  // model and no blob container, in which case chat still works and the
  // composer simply does not offer the paperclip - rather than accepting a
  // file it has nowhere to put.
  canAttachFiles: boolean;
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

// ===================================================================
// HOW LONG EACH STAGE OF A TURN MAY TAKE
//
// A chat turn had no bound of any kind once, and the numbers that produced
// were not small: two failed replies in the request log ran for 1,081 and
// 1,441 seconds. A single flat "nothing has arrived for N seconds" clock
// replaced that, and then caused a worse problem of its own - it was armed
// before any of the work started, so it timed the database, the attachment
// downloads and a whole compaction model call under a name that claimed to
// be about the model's first token. On a long thread it fired every time.
//
// So a turn is now a SEQUENCE OF NAMED PHASES, each with its own budget. See
// src/lib/ai/turn-guard.ts for the mechanism and for why there are two kinds
// of budget. What lives here is the sizing, because sizing is a judgement
// about this feature rather than about the mechanism.
//
// THE SIZING RULE, and it is the one that was got wrong before: every budget
// that covers a model call must be LONGER than the SDK's own retry ladder
// (BEDROCK_LADDER_WORST_CASE_MS). The SDK's socket idle timeout knows the
// socket went quiet and throws a named TimeoutError saying so; these know
// only that a phase overran. Whichever fires first decides what the failure
// is called, and the specific one is worth more than the general one. Set
// these tighter and every failure arrives as a bare AbortError again.
//
// The budgets are therefore GENEROUS, which is safe only because
// CHAT_FIRST_BYTE_CEILING_MS bounds their sum. A budget that never fires
// costs nothing; one tight enough to be a real limit eventually kills
// healthy work.
// ===================================================================

// -------------------------------------------------------------------
// Azure App Service's load balancer, and the reason it belongs in this
// comparison at all: it is an IDLE timeout. A reply that keeps streaming
// bytes never trips it, however long it runs - so it does not cap a long
// answer, and treating it as though it did is what produced the wall-clock
// deadline that had to be undone.
//
// What it does cap is silence, and the app has to give up first: if the
// platform wins, the connection is severed mid-stream and the app never
// learns it happened - no log row, no error, nothing to investigate.
// -------------------------------------------------------------------
export const CHAT_PLATFORM_IDLE_CEILING_MS = 230_000;

// -------------------------------------------------------------------
// The whole of a turn up to the moment the reader is sent something.
//
// This is the number that actually has to beat the platform, because it
// covers the only period when the connection is genuinely idle. Once bytes
// are flowing, every one of them resets the platform's clock and a long
// answer may run as long as it likes.
//
// It exists so the phase budgets below can be generous without their sum
// becoming a way to lose a connection silently.
// -------------------------------------------------------------------
export const CHAT_FIRST_BYTE_CEILING_MS = 200_000;

export type ChatPhase = {
  // Written into a message a reader sees, so it is short and hyphenated.
  name: string;
  budgetMs: number;
  // "idle" resets on every sign of life; "duration" is a hard ceiling. See
  // turn-guard.ts.
  kind: "duration" | "idle";
  // -----------------------------------------------------------------
  // What the reader is told is happening, while it is happening.
  //
  // KEPT BESIDE THE BUDGET ON PURPOSE. The two answer the same question for
  // two audiences - "what is this waiting on" - and a label that drifts out
  // of step with the phase it describes is worse than none, because it
  // reports the wrong stage confidently.
  //
  // This is also the cheapest reliability fix in the whole feature. A
  // thirty-second silence reads as broken; the same thirty seconds labelled
  // "summarising earlier turns" reads as working. Most of what was reported
  // as unreliability was a wait nobody could see the reason for.
  // -----------------------------------------------------------------
  status: string;
};

// -------------------------------------------------------------------
// The stages of a turn, in the order they run.
//
// NAMED AS A RECORD RATHER THAN AS LOOSE CONSTANTS so the phase name and its
// budget cannot drift apart, and so the service cannot invent a sixth phase
// that nothing has sized.
//
// Why each is what it is:
//
//   session         Two indexed reads. Anything slower is a database
//                   problem, and 15s is long enough to say so rather than
//                   to blame the model.
//   record-question The user's turn is written before the model is called,
//                   so a send is never lost to a model failure. Three small
//                   writes.
//   history         The transcript. Grows with the thread, still one query.
//   attachments     Metadata AND BYTES: every file on the conversation is
//                   fetched from blob storage. A thread at the attachment
//                   cap is megabytes over the network, which is why this is
//                   the largest of the non-model budgets.
//   compaction      A model call, so idle rather than duration, and above
//                   the SDK ladder. It streams: see the constraint in
//                   bedrock-client.ts.
//   model-reply     The reply itself. Idle, so a long answer runs as long as
//                   it keeps talking - and reset by EVERY stream event, not
//                   just text, because a tool round yields nothing for its
//                   whole duration.
//   tool-call       One Jira or database lookup between passes. Duration:
//                   there is no partial progress to protect.
//   persist-reply   Writing the answer down. Included for the timeline
//                   rather than as a real limit - abandoning this would
//                   throw away a reply that has already been paid for.
// -------------------------------------------------------------------
export const CHAT_PHASES = {
  session: { name: "session", budgetMs: 15_000, kind: "duration", status: "Checking your access" },
  question: {
    name: "record-question",
    budgetMs: 20_000,
    kind: "duration",
    status: "Saving your message",
  },
  history: { name: "history", budgetMs: 30_000, kind: "duration", status: "Reading the conversation" },
  attachments: {
    name: "attachments",
    budgetMs: 60_000,
    kind: "duration",
    status: "Loading attached files",
  },
  compaction: {
    name: "compaction",
    budgetMs: 75_000,
    kind: "idle",
    status: "Summarising earlier turns to keep this thread affordable",
  },
  model: { name: "model-reply", budgetMs: 75_000, kind: "idle", status: "Thinking" },
  tool: { name: "tool-call", budgetMs: 45_000, kind: "duration", status: "Looking up timesheet figures" },
  persist: { name: "persist-reply", budgetMs: 30_000, kind: "duration", status: "Saving the reply" },
} as const satisfies Record<string, ChatPhase>;

