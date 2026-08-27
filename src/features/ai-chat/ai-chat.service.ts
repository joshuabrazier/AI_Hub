import "server-only";

import {
  ConverseCommand,
  ConverseStreamCommand,
  type ContentBlock,
  type DocumentFormat,
  type ImageFormat,
  type Message,
  type SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
// The shape a toolUse input block carries. Re-exported by neither the
// Bedrock client nor its models, so it comes from smithy directly.
import type { DocumentType } from "@smithy/types";
import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";

import {
  inspectAttachment,
  sanitizeDocumentName,
  MAX_DOCUMENTS_PER_REQUEST,
  MAX_IMAGES_PER_REQUEST,
  MAX_REQUEST_ATTACHMENT_BYTES,
} from "@/lib/ai/attachment-formats";
import {
  BEDROCK_MODEL_ID,
  BEDROCK_REGION,
  getBedrockClient,
  isBedrockConfigured,
} from "@/lib/ai/bedrock-client";
import {
  attachmentStorageKey,
  deleteAttachment,
  deleteAttachmentsForSubject,
  getAttachment,
  isAttachmentStorageConfigured,
  putAttachment,
} from "@/lib/storage/attachment-storage";
import { requireUser } from "@/lib/auth/session-auth-server";

import { appKnowledgePrompt } from "./ai-chat-app-knowledge";
import { CHAT_TOOL_CONFIG, MAX_TOOL_ROUNDS, runChatTool } from "./ai-chat-tools";
import {
  AI_CHAT_ATTACHMENT_KINDS,
  AI_CHAT_REQUEST_KINDS,
  AI_CHAT_ROLES,
  type AiChatAttachment,
  type AiChatAttachmentKind,
  type AiChatAttachmentMeta,
  type AiChatMessage,
  type AiChatRequestKind,
  type AiChatSubject,
  type UserRole,
} from "@/lib/data/kysely-database-types";
import {
  addAiChatAttachmentRepo,
  claimStagedAiChatAttachmentsRepo,
  deleteStagedAiChatAttachmentRepo,
  getAiChatAttachmentBytesForSubjectRepo,
  getAiChatAttachmentsForSubjectRepo,
  getStagedAiChatAttachmentsRepo,
} from "@/lib/data/repositories/ai-chat-attachments.repository";
import {
  addAiChatMessageRepo,
  getAiChatMessagesBySubjectRepo,
} from "@/lib/data/repositories/ai-chat-messages.repository";
import {
  addAiChatRequestLogRepo,
  boundPayload,
} from "@/lib/data/repositories/ai-chat-request-logs.repository";
import {
  createAiChatSubjectRepo,
  deleteAiChatSubjectForUserRepo,
  getAiChatSubjectForUserRepo,
  getAiChatSubjectsForUserRepo,
  touchAiChatSubjectRepo,
  updateAiChatSubjectForUserRepo,
} from "@/lib/data/repositories/ai-chat-subjects.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { todayInAppZone } from "@/lib/timezone";

import {
  deriveAiChatSubjectTitle,
  mapDBAiChatAttachmentToDTO,
  mapDBAiChatMessageToDTO,
  mapDBAiChatSubjectToDTO,
} from "./ai-chat.mappers";
import {
  COMPACT_AT_INPUT_TOKENS,
  KEEP_RECENT_MESSAGES,
  MAX_HISTORY_CHARS,
  SUMMARY_MAX_TOKENS,
  UNTITLED_SUBJECT_TITLE,
  type AiChatAttachmentDTO,
  type AiChatPageDTO,
  type AiChatSubjectDetailDTO,
  type DeleteAiChatSubjectRequestDTO,
  type RemoveAiChatAttachmentRequestDTO,
  type RenameAiChatSubjectRequestDTO,
  type SendAiChatMessageRequestDTO,
  type UploadAiChatAttachmentRequestDTO,
} from "./ai-chat.types";

// -------------------------------------------------------------------
// AI chat service
//
// THE AUTHORIZATION MODEL, WHICH IS DIFFERENT FROM THE REST OF THE APP
//
// Chat is not team-scoped. A conversation belongs to one person, and no
// other ordinary user - manager included - can read it. So the guard here is
// requireUser (any signed-in role) rather than a role or team check, and
// the boundary is the `userId` predicate every repository query carries.
//
// ONE EXCEPTION, and it is deliberate: every request sent to the model is
// recorded in ai_chat_request_logs, which ADMINS CAN READ in full through
// /admin/ai-chat-log. That exists so somebody is accountable for what the
// organisation sends to a third-party model and what it costs. It is not a
// hole in the model above - the chat surfaces here still refuse to serve one
// user another's conversation - but it does mean chat is confidential from
// peers rather than from the organisation, and the chat page says so.
//
// That predicate IS the authorization check, not a filter applied after
// one. Every entry point below resolves the conversation through
// getAiChatSubjectForUserRepo(subjectId, user.id) before touching a
// message, and a conversation that is not the caller's comes back
// undefined - the same answer an id that never existed gets, so a guessed
// id cannot confirm somebody else's chat exists.
//
// The guards live HERE rather than only in the action or the route: this
// service has two callers (the actions and the streaming route handler),
// and a service that trusts its callers is only as safe as the least
// careful one it ever acquires.
// -------------------------------------------------------------------

// The system prompt every conversation runs under. A top-level field on the
// Converse request, never a stored message - which is why `ai_chat_role`
// has no 'system' member.
// Markdown is named explicitly because the client renders it. Without this
// the model has to guess whether its formatting will be displayed or shown
// as literal asterisks, and it guesses conservatively - so saying so is
// what actually gets tables and code fences used when they would help.
const SYSTEM_PROMPT = [
  // -----------------------------------------------------------------
  // GENERAL CAPABILITY IS STATED FIRST, AND IT IS LOAD-BEARING.
  //
  // This used to read only "You are a helpful assistant inside a staff
  // portal", and the app-knowledge block that follows is long, specific and
  // ends in a list of limits. Together they read as a job description: the
  // assistant decided the portal WAS its subject and started declining
  // ordinary questions as out of scope.
  //
  // The order matters as much as the words. What the assistant is comes
  // before what it happens to be embedded in, so the app block reads as
  // context rather than as a boundary.
  // -----------------------------------------------------------------
  "You are a general-purpose AI assistant. You are exactly as capable and as broad here as anywhere else.",
  "Help with whatever is asked: writing and editing, analysis, code, maths, research questions, explanations, planning, brainstorming, working through a problem, and general knowledge.",
  "You can also read and work with files the user attaches to the conversation - documents, spreadsheets, PDFs, images - and answer questions about them, summarise them, pull figures out of them or critique them.",
  "You happen to be embedded in a staff portal, and you know about that portal and can look up its timesheet figures. That is one useful thing you can do, NOT the limit of what you do.",
  "Never refuse or deflect an ordinary question on the grounds that it is unrelated to the portal. If somebody asks you to draft an email, explain a concept, review some code or settle an argument, just help.",
  "Be direct and concise. Answer the question that was asked, and say plainly when you do not know something rather than guessing.",
  "Your replies are rendered as GitHub-flavoured Markdown, so use it where it helps: headings, bold, lists, tables, and fenced code blocks with a language tag.",
  "Keep formatting proportionate - short answers need none of it, and a wall of headings is worse than a sentence.",
  "Do not open with filler like 'Certainly' or 'Great question'.",
  // Asked for in a real conversation, and it is the house style anyway: this
  // repo bans em and en dashes in code, docs, commits and UI copy. The
  // assistant's replies are the one text in the product that was not covered
  // by that rule, so it kept using them and had to be asked each time.
  "Never use em dashes or en dashes. Use a hyphen, a comma, or a full stop instead.",
].join(" ");

// -------------------------------------------------------------------
// What the timesheet tool is for, and the one rule that governs using it.
//
// Sent as its own system block so it sits behind the cache point with the
// rest of the prefix, and so the arithmetic rule is stated where the model
// cannot lose it behind a long conversation.
//
// TODAY'S DATE IS ESSENTIAL HERE. "Last month" is unanswerable without it,
// and a model guessing the date will confidently look up the wrong period -
// which returns real figures for a period nobody asked about, the hardest
// kind of wrong answer to notice. It comes from the app zone, never from a
// browser clock.
// -------------------------------------------------------------------
function timesheetToolPrompt(todayIso: string): string {
  return [
    `Today is ${todayIso}.`,
    "You can look up this organisation's timesheet figures with the get_timesheet_figures tool.",
    "Use it whenever a question turns on hours, utilisation, billable share, clients, projects, or - for administrators - cost, margin and chargeable value.",
    "",
    "NEVER CALCULATE A TIMESHEET FIGURE YOURSELF. Every number the tool returns is already worked out.",
    "Quote them as given. Do not sum them, divide them, convert hours to days, or work out a percentage or an average that is not already there.",
    "If somebody asks for a figure the tool did not return, say it is not available and name what you do have.",
    "The one thing you may do is compare two figures the tool gave you, and say which is larger.",
    "",
    "What you can see depends on who is asking, and the tool decides that - not you.",
    "An administrator gets the whole organisation. Anybody else gets only their own time, and no cost or pay information at all.",
    "If the result's scope says viewer is 'self', do not imply that other people's figures exist but are hidden; simply answer about theirs.",
    "Always read the scope.notes list and pass on what it says.",
  ].join(" ");
}

// Output ceiling per reply. Streaming means HTTP timeouts are not the
// constraint, so this is a deliberate cost cap rather than a technical one:
// it is generous enough for a long, detailed answer and bounded enough that
// a single send cannot run away.
const MAX_OUTPUT_TOKENS = 16_000;

// -------------------------------------------------------------------
// The feature is mounted in all three areas, so a change has to refresh all
// three: whichever one the caller is looking at is not knowable here, and
// revalidating only the admin path would leave a manager's sidebar stale.
// -------------------------------------------------------------------
function revalidateAiChatViews(): void {
  revalidatePath(ROUTES.ADMIN_AI_CHAT);
  revalidatePath(ROUTES.MANAGE_AI_CHAT);
  revalidatePath(ROUTES.PORTAL_AI_CHAT);
}

// -------------------------------------------------------------------
// Resolve a conversation the caller owns, or refuse.
//
// Private helper: every exported entry point goes through it, and it is the
// only place a subject id from a request turns into a row.
// -------------------------------------------------------------------
async function requireOwnedSubject(subjectId: string, userId: string) {
  const subject = await getAiChatSubjectForUserRepo(subjectId, userId);

  if (!subject) {
    throw new DisplayErrorMessage("That conversation no longer exists.");
  }

  return subject;
}

// -------------------------------------------------------------------
// The whole chat screen: this user's conversations, plus the transcript of
// the one being opened.
//
// An unknown or someone else's `subjectId` is not an error - it falls back
// to the most recent conversation, so a stale link or a tampered id lands
// on a working screen instead of an error page, and reveals nothing either
// way.
// -------------------------------------------------------------------
export async function getAiChatPageService(subjectId?: string): Promise<AiChatPageDTO> {
  try {
    const user = await requireUser();

    const subjectRows = await getAiChatSubjectsForUserRepo(user.id);
    const subjects = subjectRows.map(mapDBAiChatSubjectToDTO);

    // Ordered most-recently-active first by the repository, so the head of
    // the list is the sensible default.
    const requested = subjectId ? subjects.find((subject) => subject.id === subjectId) : undefined;
    const target = requested ?? subjects[0];

    if (!target) {
      return {
        isConfigured: isBedrockConfigured(),
        canAttachFiles: isAttachmentStorageConfigured(),
        subjects,
        active: null,
      };
    }

    // The row, for the summary cursor - the sidebar DTO does not carry it,
    // and it is per-conversation rather than per-list.
    const targetRow = await getAiChatSubjectForUserRepo(target.id, user.id);
    const messages = await getAiChatMessagesBySubjectRepo(target.id);

    // One read for the whole conversation, metadata only - the bytes stay in
    // the database until somebody actually downloads a file. Grouped here
    // rather than queried per message so opening a long thread is one query,
    // not one per turn.
    const attachments = await getAiChatAttachmentsForSubjectRepo(target.id, user.id);

    const attachmentsByMessage = new Map<string, AiChatAttachmentMeta[]>();
    const staged: AiChatAttachmentDTO[] = [];

    for (const attachment of attachments) {
      if (!attachment.messageId) {
        staged.push(mapDBAiChatAttachmentToDTO(attachment));
        continue;
      }

      const list = attachmentsByMessage.get(attachment.messageId);
      if (list) list.push(attachment);
      else attachmentsByMessage.set(attachment.messageId, [attachment]);
    }

    const active: AiChatSubjectDetailDTO = {
      subject: target,
      messages: messages.map((message) =>
        mapDBAiChatMessageToDTO(message, attachmentsByMessage.get(message.id) ?? []),
      ),
      staged,
      // Only meaningful if it actually points at a turn still in the
      // transcript; a stale cursor should not draw a marker at nothing.
      summarizedThroughMessageId:
        targetRow?.summaryThroughMessageId &&
        messages.some((message) => message.id === targetRow.summaryThroughMessageId)
          ? targetRow.summaryThroughMessageId
          : null,
    };

    return {
      isConfigured: isBedrockConfigured(),
      canAttachFiles: isAttachmentStorageConfigured(),
      subjects,
      active,
    };
  } catch (error) {
    throw handleError("getAiChatPageService", error);
  }
}

// -------------------------------------------------------------------
// Start a conversation. It opens empty and untitled; the first message
// names it.
// -------------------------------------------------------------------
export async function createAiChatSubjectService(): Promise<string> {
  try {
    const user = await requireUser();

    const now = new Date();

    const subject = await createAiChatSubjectRepo({
      id: generateId(),
      userId: user.id,
      title: UNTITLED_SUBJECT_TITLE,
      // Null until a message arrives. The sidebar falls back to createdAt
      // for ordering, so a new empty conversation still sorts to the top.
      lastMessageAt: null,
      createdAt: now,
      updatedAt: now,
    });

    revalidateAiChatViews();

    return subject.id;
  } catch (error) {
    throw handleError("createAiChatSubjectService", error);
  }
}

// -------------------------------------------------------------------
// Rename a conversation. Does not touch lastMessageAt, so renaming does
// not reorder the sidebar.
// -------------------------------------------------------------------
export async function renameAiChatSubjectService(
  requestDTO: RenameAiChatSubjectRequestDTO,
): Promise<void> {
  try {
    const user = await requireUser();

    await requireOwnedSubject(requestDTO.subjectId, user.id);

    await updateAiChatSubjectForUserRepo(requestDTO.subjectId, user.id, { title: requestDTO.title });

    revalidateAiChatViews();
  } catch (error) {
    throw handleError("renameAiChatSubjectService", error);
  }
}

// -------------------------------------------------------------------
// Delete a conversation and its transcript.
//
// A real delete rather than a flag: a chat transcript is the user's own
// content, and "delete" has to mean it is gone. The messages cascade.
// -------------------------------------------------------------------
export async function deleteAiChatSubjectService(
  requestDTO: DeleteAiChatSubjectRequestDTO,
): Promise<void> {
  try {
    const user = await requireUser();

    // Ownership is resolved BEFORE anything is removed, because the blob
    // cleanup below works off the conversation id and must not run for a
    // conversation the caller does not own.
    await requireOwnedSubject(requestDTO.subjectId, user.id);

    // Files first. The row delete cascades to attachment rows and cannot
    // touch storage, so once those rows are gone nothing knows the blobs
    // exist. Doing it in this order means a failure here leaves the
    // conversation intact and retryable, rather than orphaning files.
    if (isAttachmentStorageConfigured()) {
      await deleteAttachmentsForSubject(requestDTO.subjectId);
    }

    // Scoped delete, so a conversation that is not the caller's removes
    // nothing. Zero rows is reported as "no longer exists" - the same
    // answer a real id that was already deleted gets.
    const deleted = await deleteAiChatSubjectForUserRepo(requestDTO.subjectId, user.id);

    if (deleted === 0) {
      throw new DisplayErrorMessage("That conversation no longer exists.");
    }

    revalidateAiChatViews();
  } catch (error) {
    throw handleError("deleteAiChatSubjectService", error);
  }
}


// -------------------------------------------------------------------
// Store a file against a conversation, staged until the next send.
//
// The bytes decide what this is. `fileName` is used for display and to
// break a tie between two Office formats, and the browser's Content-Type
// is not consulted at all - see inspectAttachment. A caller cannot make
// this store something outside the allowlist by lying in either.
//
// The caps checked here are the ones a single message could never satisfy:
// a request carries at most 20 images and 5 documents, so a sixth PDF on
// one turn is refused now rather than silently dropped at send time.
// Attachments from EARLIER turns are not counted - those are allowed to
// exceed the budget and fall out oldest-first, which is what makes a long
// conversation with files in it keep working.
// -------------------------------------------------------------------
export async function uploadAiChatAttachmentService(
  requestDTO: UploadAiChatAttachmentRequestDTO,
  file: { fileName: string; bytes: Buffer },
): Promise<AiChatAttachmentDTO> {
  try {
    const user = await requireUser();

    if (!isAttachmentStorageConfigured()) {
      throw new DisplayErrorMessage("File attachments are not configured on this environment.");
    }

    const subject = await requireOwnedSubject(requestDTO.subjectId, user.id);

    const inspection = inspectAttachment(file.bytes, file.fileName);

    if (!inspection.ok) {
      throw new DisplayErrorMessage(inspection.reason);
    }

    const staged = await getStagedAiChatAttachmentsRepo(subject.id, user.id);

    const stagedImages = staged.filter((item) => item.kind === AI_CHAT_ATTACHMENT_KINDS.IMAGE).length;
    const stagedDocuments = staged.length - stagedImages;
    const stagedBytes = staged.reduce((total, item) => total + item.byteSize, 0);

    if (inspection.kind === AI_CHAT_ATTACHMENT_KINDS.IMAGE && stagedImages >= MAX_IMAGES_PER_REQUEST) {
      throw new DisplayErrorMessage(`You can attach up to ${MAX_IMAGES_PER_REQUEST} images to one message.`);
    }

    if (inspection.kind === AI_CHAT_ATTACHMENT_KINDS.DOCUMENT && stagedDocuments >= MAX_DOCUMENTS_PER_REQUEST) {
      throw new DisplayErrorMessage(
        `You can attach up to ${MAX_DOCUMENTS_PER_REQUEST} documents to one message.`,
      );
    }

    if (stagedBytes + file.bytes.length > MAX_REQUEST_ATTACHMENT_BYTES) {
      throw new DisplayErrorMessage("Those files are too large to send together. Remove one and try again.");
    }

    const attachmentId = generateId();
    const storageKey = attachmentStorageKey(subject.id, attachmentId);

    // The blob goes FIRST, then the row. That order is deliberate: a blob
    // with no row is invisible but collectable - the monthly reconciliation
    // sweep removes it - whereas a row with no blob is a broken attachment
    // the user can see and nothing will ever repair.
    await putAttachment(storageKey, file.bytes, inspection.mediaType);

    const stored = await addAiChatAttachmentRepo({
      id: attachmentId,
      userId: user.id,
      subjectId: subject.id,
      // Staged. The send claims it; nothing else sets this column.
      messageId: null,
      kind: inspection.kind,
      format: inspection.format,
      // Bounded so a pathological name cannot be used to bloat the row, and
      // trimmed of any path the browser may have included.
      fileName: file.fileName.split(/[\\/]/).pop()?.slice(0, 255) || "Attachment",
      mediaType: inspection.mediaType,
      byteSize: file.bytes.length,
      width: inspection.width,
      height: inspection.height,
      storageKey,
      createdAt: new Date(),
    });

    revalidateAiChatViews();

    return mapDBAiChatAttachmentToDTO(stored);
  } catch (error) {
    throw handleError("uploadAiChatAttachmentService", error);
  }
}

// -------------------------------------------------------------------
// Take a staged file back off a message before it is sent.
//
// Only staged rows can go: once a file has been sent it is part of the
// transcript, and removing it would leave the conversation referring to
// something the model can no longer be shown. Deleting the conversation
// still removes it, by cascade.
// -------------------------------------------------------------------
export async function removeAiChatAttachmentService(
  requestDTO: RemoveAiChatAttachmentRequestDTO,
): Promise<void> {
  try {
    const user = await requireUser();

    const removedKey = await deleteStagedAiChatAttachmentRepo(requestDTO.attachmentId, user.id);

    if (!removedKey) {
      throw new DisplayErrorMessage("That attachment has already been sent or removed.");
    }

    // The row is gone, so nothing else knows this file exists. If the blob
    // delete fails the reconciliation sweep collects it, which is why this
    // does not need to be transactional - but it does need to happen.
    await deleteAttachment(removedKey);

    revalidateAiChatViews();
  } catch (error) {
    throw handleError("removeAiChatAttachmentService", error);
  }
}

// -------------------------------------------------------------------
// Every sent file on a conversation, grouped by the turn that carried it.
//
// This is the one read that loads attachment CONTENT in bulk, because the
// Converse API takes file bytes inline and there is no way to hand it a
// reference instead. It is bounded by the same caps the composer enforces,
// and staged rows are skipped - a file that has not been sent yet is not
// part of any turn, and including it would send it a request early.
// -------------------------------------------------------------------
async function loadAttachmentsByMessage(
  subjectId: string,
  userId: string,
): Promise<Map<string, LoadedAttachment[]>> {
  const rows = await getAiChatAttachmentBytesForSubjectRepo(subjectId, userId);

  const sent = rows.filter((row) => row.messageId !== null);

  if (sent.length === 0) return new Map();

  // Fetched in parallel: these are independent blob reads and the count is
  // bounded by the per-request caps the composer enforces, so this is a
  // handful of requests rather than an unbounded fan-out.
  const loaded = await Promise.all(
    sent.map(async (row) => {
      const bytes = await getAttachment(row.storageKey);

      // A row whose blob is missing is skipped rather than fatal. Retention
      // or a half-finished delete can leave one behind, and a send is not
      // the place to discover it - the model is told the file is no longer
      // available by the same eviction note that covers a budget drop.
      if (!bytes) {
        console.warn(`loadAttachmentsByMessage: blob missing for attachment ${row.id} (${row.storageKey})`);
        return null;
      }

      return { ...row, bytes };
    }),
  );

  const grouped = new Map<string, LoadedAttachment[]>();

  for (const row of loaded) {
    if (!row?.messageId) continue;

    const list = grouped.get(row.messageId);
    if (list) list.push(row);
    else grouped.set(row.messageId, [row]);
  }

  return grouped;
}

// -------------------------------------------------------------------
// Build the Converse request from a stored transcript.
//
// Two things are folded in here, and they pull in opposite directions, so
// they are worth stating together:
//
//   COMPACTION shrinks what is sent. Once a thread has been compacted, the
//   turns up to `summaryThroughMessageId` are replaced by `summary`, carried
//   as a second system block. A system block rather than a faked user turn:
//   Converse requires messages to start with a user turn and to read as a
//   real exchange, and a summary is neither party speaking - it is context.
//
//   CACHING makes what is sent cheap to resend. One cache point goes at the
//   very END of the request, so the whole prefix - system, summary, and every
//   turn including the newest question - is cached. Next turn that entire
//   prefix is a cache read at roughly a tenth of the input rate, and only the
//   new exchange is charged in full.
//
// Placing the cache point last is deliberate. Putting it before the newest
// user message would cache a shorter prefix and save less; by the time the
// next request runs, that message is history like everything else.
//
// The MAX_HISTORY_CHARS trim below is now a backstop rather than the main
// mechanism - compaction should keep threads well under it. It stays because
// a guard that only fires once everything else has failed is exactly the one
// worth keeping.
// -------------------------------------------------------------------
type ConverseRequest = {
  system: SystemContentBlock[];
  messages: Message[];
  trimmed: number;
  // How many attached files were left out because the request budget was
  // already spent. Logged, not shown - the reply is still correct.
  droppedAttachments: number;
};

// -------------------------------------------------------------------
// Decide which attachments this request can carry.
//
// THE LIMITS ARE PER REQUEST, NOT PER MESSAGE, AND THAT IS THE WHOLE
// PROBLEM. Bedrock allows 20 images and 5 documents in a call. Every send
// here replays the entire conversation, so those caps apply to everything
// the thread has ever attached, all at once - a conversation with five PDFs
// in it has spent its document budget, and the sixth cannot go even though
// no single message came close to a limit.
//
// So attachments are admitted NEWEST FIRST and the oldest fall out. That
// ordering is the point: the file somebody just attached is the one they
// are asking about, and a request that silently dropped it in favour of a
// photo from last week would look broken. Anything evicted is replaced by a
// note in its own message, so the model can say "I can no longer see that
// file" instead of hallucinating its contents.
//
// The byte budget is checked too, and it is not redundant with the counts:
// 20 images at 3.75 MB is 75 MB, which would blow the 20 MB payload cap
// long before the image count ran out.
// -------------------------------------------------------------------
// An attachment row with its file fetched from storage. Only ever built
// inside the send path - nothing else needs the bytes, and nothing else
// should be able to hold them.
type LoadedAttachment = AiChatAttachment & { bytes: Buffer };

type AttachmentSelection = {
  admitted: Map<string, LoadedAttachment[]>;
  droppedByMessage: Map<string, number>;
  droppedTotal: number;
};

function selectAttachments(
  kept: AiChatMessage[],
  attachmentsByMessage: Map<string, LoadedAttachment[]>,
): AttachmentSelection {
  const admitted = new Map<string, LoadedAttachment[]>();
  const droppedByMessage = new Map<string, number>();

  let images = 0;
  let documents = 0;
  let bytes = 0;
  let droppedTotal = 0;

  for (let index = kept.length - 1; index >= 0; index -= 1) {
    const message = kept[index];
    const files = attachmentsByMessage.get(message.id);

    if (!files || files.length === 0) continue;

    for (const file of files) {
      const isImage = file.kind === AI_CHAT_ATTACHMENT_KINDS.IMAGE;

      const withinCount = isImage ? images < MAX_IMAGES_PER_REQUEST : documents < MAX_DOCUMENTS_PER_REQUEST;
      const withinBytes = bytes + file.byteSize <= MAX_REQUEST_ATTACHMENT_BYTES;

      if (!withinCount || !withinBytes) {
        droppedByMessage.set(message.id, (droppedByMessage.get(message.id) ?? 0) + 1);
        droppedTotal += 1;
        continue;
      }

      if (isImage) images += 1;
      else documents += 1;

      bytes += file.byteSize;

      const list = admitted.get(message.id);
      if (list) list.push(file);
      else admitted.set(message.id, [file]);
    }
  }

  return { admitted, droppedByMessage, droppedTotal };
}

// -------------------------------------------------------------------
// Turn stored files into Converse content blocks.
//
// Attachments come BEFORE the text in the block array, which is Anthropic's
// documented guidance: a question that follows its image is answered better
// than one that precedes it.
//
// A document carries a `name`, and Bedrock restricts that field to a narrow
// character set - so the name the model sees is a sanitised form of the
// filename, not the filename. Its position in the request is what makes an
// unnameable file distinguishable ("Document 3"), which is why the counter
// is threaded through rather than reset per message.
// -------------------------------------------------------------------
function attachmentBlocks(files: LoadedAttachment[], documentPosition: { next: number }): ContentBlock[] {
  return files.map((file) => {
    if (file.kind === AI_CHAT_ATTACHMENT_KINDS.IMAGE) {
      return {
        image: {
          format: file.format as ImageFormat,
          source: { bytes: new Uint8Array(file.bytes) },
        },
      };
    }

    const position = documentPosition.next;
    documentPosition.next += 1;

    return {
      document: {
        format: file.format as DocumentFormat,
        name: sanitizeDocumentName(file.fileName, position),
        source: { bytes: new Uint8Array(file.bytes) },
      },
    };
  });
}

function buildConverseRequest(
  transcript: AiChatMessage[],
  summary: string | null,
  summaryThroughMessageId: string | null,
  attachmentsByMessage: Map<string, LoadedAttachment[]>,
  // The caller's role and name, so the app description can be filtered to the
  // screens they can actually open and addressed to them by name.
  viewer: { role: UserRole; name: string | null },
): ConverseRequest {
  // Everything after the summarised cursor. A cursor matching no row (a
  // summary written against turns since removed) degrades to "the summary
  // covers nothing", which replays the full transcript - more expensive,
  // never wrong.
  const cursorIndex = summaryThroughMessageId
    ? transcript.findIndex((turn) => turn.id === summaryThroughMessageId)
    : -1;

  const live = transcript.slice(cursorIndex + 1);

  // Converse rejects an empty text block, which is what an assistant turn the
  // reader stopped instantly would otherwise produce.
  const usable = live.filter((turn) => turn.content.trim().length > 0);

  // Backstop trim, newest-first so the most recent context survives.
  let budget = MAX_HISTORY_CHARS;
  let firstKept = usable.length;

  for (let index = usable.length - 1; index >= 0; index -= 1) {
    const cost = usable[index].content.length;
    if (budget - cost < 0) break;
    budget -= cost;
    firstKept = index;
  }

  const kept = usable.slice(firstKept);

  // Converse requires the first message to be a user turn.
  while (kept.length > 0 && kept[0].role !== AI_CHAT_ROLES.USER) {
    kept.shift();
    firstKept += 1;
  }

  const { admitted, droppedByMessage, droppedTotal } = selectAttachments(kept, attachmentsByMessage);

  // Shared across the whole request so document names stay unique and their
  // numbering matches the order the model reads them in.
  const documentPosition = { next: 1 };

  const messages: Message[] = kept.map((turn, index) => {
    const files = admitted.get(turn.id) ?? [];
    const dropped = droppedByMessage.get(turn.id) ?? 0;

    const content: ContentBlock[] = [...attachmentBlocks(files, documentPosition), { text: turn.content }];

    if (dropped > 0) {
      // Its own block rather than appended to the user's text: what they
      // typed stays exactly what they typed, and the model is told plainly
      // that something is missing so it can say so instead of guessing.
      content.push({
        text:
          `[${dropped} file${dropped === 1 ? "" : "s"} attached here earlier ` +
          `${dropped === 1 ? "is" : "are"} no longer included in this conversation. ` +
          `Say so if the user asks about ${dropped === 1 ? "it" : "them"}.]`,
      });
    }

    // The cache point rides on the final turn, so the cached prefix is the
    // entire request - attachments included, which is where caching earns
    // the most: a 3 MB PDF re-read at a tenth of the input rate on every
    // following turn instead of being paid for in full each time. Below the
    // model's 4,096-token minimum it is simply ignored, so there is no size
    // check to get wrong here.
    if (index === kept.length - 1) {
      content.push({ cachePoint: { type: "default" } });
    }

    return {
      role: turn.role === AI_CHAT_ROLES.USER ? "user" : "assistant",
      content,
    };
  });

  // Three blocks, all ahead of the conversation and therefore inside the
  // cached prefix: how to answer, what the app is, and how to use the tool.
  // They are separate blocks rather than one long string so a change to any
  // of them reads as a change to that thing.
  const system: SystemContentBlock[] = [
    { text: SYSTEM_PROMPT },
    { text: appKnowledgePrompt(viewer.role, viewer.name) },
    { text: timesheetToolPrompt(todayInAppZone()) },
  ];

  if (summary) {
    system.push({
      text:
        "The earlier part of this conversation has been summarised to keep it within budget. " +
        "Treat the summary as an accurate record of what was said, and if the user refers to " +
        "something it does not cover, say so plainly rather than inventing the detail.\n\n" +
        `<earlier_conversation_summary>\n${summary}\n</earlier_conversation_summary>`,
    });
  }

  return { system, messages, trimmed: firstKept, droppedAttachments: droppedTotal };
}

// -------------------------------------------------------------------
// Record what was actually sent.
//
// Called after every model request, successful or not - a failed call is
// exactly when an admin most wants to see the payload that caused it.
//
// Best-effort and fully guarded, like the audit log: a logging failure must
// never break the reply the user is waiting for. It writes the arrays in the
// shape they went out in, including where the cache point sat, because
// "roughly what was sent" is not what this table is for.
// -------------------------------------------------------------------
// What the log records about one attached file. Named so the two branches
// below widen to the same shape rather than to a union of two array types.
type LoggedAttachment = {
  kind: AiChatAttachmentKind;
  format: string;
  name: string | null;
  byteSize: number;
};

// One half of a tool exchange: either the call the model asked for, or the
// result it was handed back. Both are recorded - see the note at the
// flatMap below for why the result half is the one that matters most.
type LoggedToolExchange = {
  direction: "request" | "result";
  // The tool's name on a request; the id it answers on a result.
  name: string;
  body: string;
};

async function recordRequest(entry: {
  userId: string;
  subjectId: string | null;
  kind: AiChatRequestKind;
  system: SystemContentBlock[];
  messages: Message[];
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
  };
  error: string | null;
  startedAt: number;
}): Promise<void> {
  try {
    // Flattened to the things a reader needs - who said it, what they said,
    // what they attached - plus whether the cache point rode on that turn.
    // Storing the raw SDK union would make the viewer parse Bedrock's wire
    // format to show a sentence.
    //
    // ATTACHMENTS ARE RECORDED AS METADATA, NEVER CONTENT. An admin can see
    // that a 2.1 MB PDF called "Invoice March" was sent, which is what the
    // log is for - accountability for what leaves the organisation and what
    // it costs. Copying the bytes in would put a second full copy of every
    // file into a table that already grows with the square of thread length,
    // and would widen a privacy exception that is deliberately narrow.
    //
    // Read off the BUILT blocks rather than the database rows, so the log
    // describes what was actually in the request - including the eviction
    // when an older file did not make the budget.
    const messages = entry.messages.map((message) => {
      const blocks = message.content ?? [];

      return {
        role: message.role ?? "unknown",
        text: blocks
          .map((block) => ("text" in block ? block.text : ""))
          .filter(Boolean)
          .join(""),
        cachePoint: blocks.some((block) => "cachePoint" in block),

        // TOOL TRAFFIC IS PART OF WHAT WAS SENT, so it is recorded here.
        //
        // Without this the log would show a question and an answer with the
        // data transfer between them invisible - which for a tool that hands
        // over people's utilisation and pay-derived costs is exactly the part
        // an admin reviewing the log needs to see. Dropping it would turn
        // "we record what was sent" into "we record what was typed".
        //
        // Both halves are kept: the ARGUMENTS the model chose, so a lookup of
        // the wrong period or the wrong person is visible, and the RESULT it
        // was given, which is the figures themselves.
        tools: blocks.flatMap<LoggedToolExchange>((block) => {
          if ("toolUse" in block && block.toolUse) {
            return [
              {
                direction: "request",
                name: block.toolUse.name ?? "unknown",
                body: JSON.stringify(block.toolUse.input ?? {}),
              },
            ];
          }

          if ("toolResult" in block && block.toolResult) {
            return [
              {
                direction: "result",
                name: block.toolResult.toolUseId ?? "unknown",
                body: (block.toolResult.content ?? [])
                  .map((part) => ("text" in part ? (part.text ?? "") : ""))
                  .filter(Boolean)
                  .join(""),
              },
            ];
          }

          return [];
        }),
        attachments: blocks.flatMap<LoggedAttachment>((block) => {
          if ("image" in block && block.image) {
            return [
              {
                kind: AI_CHAT_ATTACHMENT_KINDS.IMAGE,
                format: block.image.format ?? "unknown",
                // Images have no name field in Converse - there is nothing
                // to record here beyond the format and the size.
                name: null,
                byteSize: block.image.source?.bytes?.byteLength ?? 0,
              },
            ];
          }

          if ("document" in block && block.document) {
            return [
              {
                kind: AI_CHAT_ATTACHMENT_KINDS.DOCUMENT,
                format: block.document.format ?? "unknown",
                // The SANITISED name, because that is the one the model saw.
                name: block.document.name ?? null,
                byteSize: block.document.source?.bytes?.byteLength ?? 0,
              },
            ];
          }

          return [];
        }),
      };
    });

    const systemBlocks = entry.system.map((block) => ({
      text: "text" in block && block.text ? block.text : "",
    }));

    // Bounded together so a shortened payload cannot be filed as complete.
    const serialisedMessages = boundPayload(JSON.stringify(messages));
    const serialisedSystem = boundPayload(JSON.stringify(systemBlocks));

    await addAiChatRequestLogRepo({
      id: generateId(),
      userId: entry.userId,
      subjectId: entry.subjectId,
      kind: entry.kind,
      modelId: BEDROCK_MODEL_ID,
      region: BEDROCK_REGION,
      systemBlocks: serialisedSystem.value,
      messages: serialisedMessages.value,
      truncated: serialisedMessages.truncated || serialisedSystem.truncated,
      inputTokens: entry.usage.inputTokens,
      outputTokens: entry.usage.outputTokens,
      cacheReadTokens: entry.usage.cacheReadTokens,
      cacheWriteTokens: entry.usage.cacheWriteTokens,
      error: entry.error,
      durationMs: Date.now() - entry.startedAt,
      createdAt: new Date(),
    });
  } catch (error) {
    console.error("[recordRequest] failed to record an AI chat request", error);
  }
}

// -------------------------------------------------------------------
// What a turn actually cost in input.
//
// With caching on, `inputTokens` is only the uncached remainder - the model
// reports cache reads and writes separately. Adding all three is the only way
// to get the figure the compaction trigger should measure against; using
// inputTokens alone would read a well-cached thread as tiny and never compact
// it, right up until the cache expired and the cost reappeared.
// -------------------------------------------------------------------
function totalInputOf(message: AiChatMessage): number {
  return (message.inputTokens ?? 0) + (message.cacheReadTokens ?? 0) + (message.cacheWriteTokens ?? 0);
}

// -------------------------------------------------------------------
// Compact a thread if its last reply was expensive enough to warrant it.
//
// Returns the summary to use for THIS request, so the send that triggers
// compaction is itself smaller rather than paying full price one last time.
//
// Deliberately best-effort: a summarisation failure logs and returns the
// existing summary unchanged. Compaction is a cost optimisation, and a cost
// optimisation must never be the reason somebody cannot send a message.
// -------------------------------------------------------------------
async function compactIfNeeded(
  subject: AiChatSubject,
  transcript: AiChatMessage[],
  userId: string,
  attachmentsByMessage: Map<string, LoadedAttachment[]>,
): Promise<{ summary: string | null; summaryThroughMessageId: string | null }> {
  const current = {
    summary: subject.summary,
    summaryThroughMessageId: subject.summaryThroughMessageId,
  };

  // The most recent assistant turn is the only honest measurement of what this
  // thread costs to send; user turns carry no usage.
  const lastAssistant = [...transcript]
    .reverse()
    .find((turn) => turn.role === AI_CHAT_ROLES.ASSISTANT && turn.inputTokens !== null);

  if (!lastAssistant || totalInputOf(lastAssistant) < COMPACT_AT_INPUT_TOKENS) {
    return current;
  }

  const cursorIndex = current.summaryThroughMessageId
    ? transcript.findIndex((turn) => turn.id === current.summaryThroughMessageId)
    : -1;

  const live = transcript.slice(cursorIndex + 1);

  // Fold in everything except the most recent turns, which stay verbatim so
  // follow-ups like "change that to blue" keep their referent.
  const foldCount = live.length - KEEP_RECENT_MESSAGES;

  // Nothing meaningful to gain from summarising one or two turns, and doing it
  // on every send would cost more than it saves.
  if (foldCount < 2) return current;

  const folding = live.slice(0, foldCount);
  const throughMessage = folding[folding.length - 1];

  // Attached files are named in the folded text even though their content
  // cannot be: a summary is words, and an image is not. Once these turns are
  // behind the cursor their files stop being sent, so without this the model
  // would have no idea a document it was asked about ever existed.
  const transcriptText = folding
    .map((turn) => {
      const speaker = turn.role === AI_CHAT_ROLES.USER ? "User" : "Assistant";
      const files = attachmentsByMessage.get(turn.id) ?? [];

      const attached =
        files.length > 0 ? ` [attached: ${files.map((file) => file.fileName).join(", ")}]` : "";

      return `${speaker}${attached}: ${turn.content}`;
    })
    .join("\n\n");

  const startedAt = Date.now();

  // Built as named values rather than inline, so the exact arrays that go to
  // the model are the exact arrays that get logged below.
  const summarySystem: SystemContentBlock[] = [
    {
      text:
        "You compress conversation transcripts so a later reader can carry on without them. " +
        "Preserve decisions, facts, names, numbers, code identifiers, and anything the user asked to be " +
        "remembered. Drop pleasantries and restatements. Write plain prose in the third person, with no " +
        "preamble and no closing remark. Never invent detail that is not in the transcript. " +
        "Where a turn is marked [attached: ...], record that the file was shared and what was concluded " +
        "about it - the file itself will not be available to the later reader, so say what it showed " +
        "rather than referring to it as though it can still be opened.",
    },
  ];

  const summaryMessages: Message[] = [
    {
      role: "user",
      content: [
        {
          text: current.summary
            ? "Here is a summary of the conversation so far, followed by the turns that came after it. " +
              "Produce ONE merged summary covering both.\n\n" +
              `<existing_summary>\n${current.summary}\n</existing_summary>\n\n` +
              `<new_turns>\n${transcriptText}\n</new_turns>`
            : `Summarise this conversation.\n\n<transcript>\n${transcriptText}\n</transcript>`,
        },
      ],
    },
  ];

  try {
    const response = await getBedrockClient().send(
      new ConverseCommand({
        modelId: BEDROCK_MODEL_ID,
        system: summarySystem,
        messages: summaryMessages,
        inferenceConfig: { maxTokens: SUMMARY_MAX_TOKENS },
      }),
    );

    // Logged like any other call. The user never sees this request, so
    // without a record it would be spend on their account that nothing
    // accounts for.
    await recordRequest({
      userId,
      subjectId: subject.id,
      kind: AI_CHAT_REQUEST_KINDS.SUMMARY,
      system: summarySystem,
      messages: summaryMessages,
      usage: {
        inputTokens: response.usage?.inputTokens ?? null,
        outputTokens: response.usage?.outputTokens ?? null,
        cacheReadTokens: response.usage?.cacheReadInputTokens ?? null,
        cacheWriteTokens: response.usage?.cacheWriteInputTokens ?? null,
      },
      error: null,
      startedAt,
    });

    const summary = response.output?.message?.content?.[0]?.text?.trim();

    if (!summary) {
      console.error("compactIfNeeded: the model returned no summary; leaving the thread uncompacted");
      return current;
    }

    await updateAiChatSubjectForUserRepo(subject.id, userId, {
      summary,
      summaryThroughMessageId: throughMessage.id,
    });

    console.info(
      `compactIfNeeded: folded ${folding.length} turn(s) of subject ${subject.id} into a summary ` +
        `(last reply cost ~${totalInputOf(lastAssistant)} input tokens)`,
    );

    return { summary, summaryThroughMessageId: throughMessage.id };
  } catch (error) {
    await recordRequest({
      userId,
      subjectId: subject.id,
      kind: AI_CHAT_REQUEST_KINDS.SUMMARY,
      system: summarySystem,
      messages: summaryMessages,
      usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null },
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      startedAt,
    });

    // Logged, not thrown - see the note above.
    console.error("compactIfNeeded: summarisation failed, continuing uncompacted", error);
    return current;
  }
}

// -------------------------------------------------------------------
// Send a message and stream the reply.
//
// An async generator rather than a function returning a string, because the
// route handler turns it straight into a ReadableStream. Yielding text keeps
// every Bedrock type inside this file - the route never imports the AWS SDK.
//
// Ordering is deliberate:
//   1. authorize, and resolve the conversation as the caller's
//   2. persist the USER turn before calling the model, so a send is never lost
//      to a model failure - the question stays in the transcript and can be
//      retried
//   3. compact if the thread has grown expensive, so the send that triggers
//      compaction is itself cheaper
//   4. stream the reply, accumulating it as it goes
//   5. persist the assistant turn in a `finally`, so a reader who closes the
//      tab or hits stop still keeps the partial answer rather than losing an
//      expensive reply that was already paid for
// -------------------------------------------------------------------
export async function* streamAiChatReplyService(
  requestDTO: SendAiChatMessageRequestDTO,
): AsyncGenerator<string, void, undefined> {
  const user = await requireUser();

  const subject = await requireOwnedSubject(requestDTO.subjectId, user.id);

  if (!isBedrockConfigured()) {
    throw new DisplayErrorMessage("AI chat is not configured on this environment.");
  }

  const askedAt = new Date();

  // The user's turn lands first, and its own text is included in the history
  // below - so what the model sees is exactly what the transcript shows, with
  // no separate "current message" path that could drift.
  const askedMessage = await addAiChatMessageRepo({
    id: generateId(),
    subjectId: subject.id,
    role: AI_CHAT_ROLES.USER,
    content: requestDTO.content,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    createdAt: askedAt,
  });

  // Anything staged on this conversation belongs to the turn just written.
  // Done before the transcript is read, so the files are already attached
  // to a message by the time the request is built - there is no separate
  // "and also these files" path that could disagree with what was stored.
  const claimed = await claimStagedAiChatAttachmentsRepo(subject.id, user.id, askedMessage.id);

  await touchAiChatSubjectRepo(subject.id, askedAt);

  // Name the conversation from its first question. Done here rather than in the
  // create path because a conversation is created before anything is known
  // about it.
  if (subject.title === UNTITLED_SUBJECT_TITLE) {
    await updateAiChatSubjectForUserRepo(subject.id, user.id, {
      title: deriveAiChatSubjectTitle(requestDTO.content),
    });
  }

  const transcript = await getAiChatMessagesBySubjectRepo(subject.id);

  // Every file on the conversation, not just the ones claimed above: earlier
  // turns carry theirs into this request too, and the budget is measured
  // across all of them. On a thread with no attachments this matches no rows
  // and costs nothing, which is why it is unconditional.
  const attachmentsByMessage = await loadAttachmentsByMessage(subject.id, user.id);

  if (claimed > 0) {
    console.info(`streamAiChatReplyService: attached ${claimed} file(s) to message ${askedMessage.id}`);
  }

  const { summary, summaryThroughMessageId } = await compactIfNeeded(
    subject,
    transcript,
    user.id,
    attachmentsByMessage,
  );

  const { system, messages, trimmed, droppedAttachments } = buildConverseRequest(
    transcript,
    summary,
    summaryThroughMessageId,
    attachmentsByMessage,
    { role: user.role, name: user.name ?? null },
  );

  if (trimmed > 0) {
    // The backstop fired, which means compaction did not keep up. Not
    // user-facing - the reply is still correct, just missing distant context.
    console.warn(`streamAiChatReplyService: backstop trimmed ${trimmed} turn(s) beyond the summary`);
  }

  if (droppedAttachments > 0) {
    // Expected on a long thread with many files, and handled - the model is
    // told which turns lost theirs. Logged because it changes what the
    // answer can be based on.
    console.info(
      `streamAiChatReplyService: subject ${subject.id} exceeded the per-request attachment budget; ` +
        `${droppedAttachments} older file(s) were not sent`,
    );
  }

  let reply = "";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let cacheReadTokens: number | null = null;
  let cacheWriteTokens: number | null = null;
  let failure: string | null = null;

  const startedAt = Date.now();

  try {
    // -----------------------------------------------------------------
    // The tool loop.
    //
    // Converse answers a tool call by ENDING the turn with stopReason
    // "tool_use". Getting a reply then means sending the whole conversation
    // again with the model's tool request and our result appended - so this
    // is a loop over round trips, not a callback.
    //
    // Bounded by MAX_TOOL_ROUNDS, because each pass is a paid request and a
    // model that loops is a bill nobody is watching. On the last pass the
    // tools are withheld entirely, which forces an answer in words rather
    // than a fifth request we would have to refuse mid-stream.
    //
    // Token counts ACCUMULATE across passes. Reporting only the last one
    // would under-report the spend of exactly the questions that cost most,
    // which is the opposite of what the request log is for.
    // -----------------------------------------------------------------
    for (let round = 0; ; round++) {
      const isFinalRound = round >= MAX_TOOL_ROUNDS;

      const response = await getBedrockClient().send(
        new ConverseStreamCommand({
          modelId: BEDROCK_MODEL_ID,
          system,
          messages,
          inferenceConfig: { maxTokens: MAX_OUTPUT_TOKENS },
          ...(isFinalRound ? {} : { toolConfig: CHAT_TOOL_CONFIG }),
        }),
      );

      if (!response.stream) {
        throw new Error("Bedrock returned no stream");
      }

      // Content blocks arrive interleaved and are identified by index, so a
      // tool call is assembled from three events: a start naming it, deltas
      // carrying its arguments as JSON text, and the stop that ends it.
      const toolCalls = new Map<number, { toolUseId: string; name: string; input: string }>();
      let roundText = "";
      let stopReason: string | undefined;

      for await (const event of response.stream) {
        const started = event.contentBlockStart?.start?.toolUse;
        if (started?.toolUseId && started.name) {
          toolCalls.set(event.contentBlockStart?.contentBlockIndex ?? 0, {
            toolUseId: started.toolUseId,
            name: started.name,
            input: "",
          });
          continue;
        }

        // Arguments stream in as fragments of JSON and are only valid once
        // the block closes, so they are concatenated and parsed at the end.
        const toolDelta = event.contentBlockDelta?.delta?.toolUse?.input;
        if (toolDelta !== undefined) {
          const call = toolCalls.get(event.contentBlockDelta?.contentBlockIndex ?? 0);
          if (call) call.input += toolDelta;
          continue;
        }

        // Text arrives as deltas. `reasoningContent` is possible on this
        // union and is ignored - extended thinking is not enabled.
        const chunk = event.contentBlockDelta?.delta?.text;
        if (chunk) {
          reply += chunk;
          roundText += chunk;
          yield chunk;
          continue;
        }

        if (event.messageStop?.stopReason) {
          stopReason = event.messageStop.stopReason;
        }

        // Usage arrives once per pass, on its own event. All four figures are
        // recorded: `inputTokens` alone is only the uncached remainder once a
        // cache point is in play.
        if (event.metadata?.usage) {
          inputTokens = (inputTokens ?? 0) + (event.metadata.usage.inputTokens ?? 0);
          outputTokens = (outputTokens ?? 0) + (event.metadata.usage.outputTokens ?? 0);
          cacheReadTokens = (cacheReadTokens ?? 0) + (event.metadata.usage.cacheReadInputTokens ?? 0);
          cacheWriteTokens = (cacheWriteTokens ?? 0) + (event.metadata.usage.cacheWriteInputTokens ?? 0);
        }
      }

      if (stopReason !== "tool_use" || toolCalls.size === 0) break;

      // The model's turn goes back verbatim - any text it said before asking,
      // then the tool requests themselves. Converse rejects a tool result
      // that does not answer a tool use in the preceding turn.
      const assistantContent: ContentBlock[] = [];
      if (roundText.trim().length > 0) assistantContent.push({ text: roundText });

      const results: ContentBlock[] = [];

      for (const call of toolCalls.values()) {
        // Typed as the SDK's DocumentType because that is what a toolUse
        // input block holds; the tool itself treats every field as untrusted
        // regardless, so this is a shape for the wire rather than a promise
        // about the contents.
        let parsed: DocumentType = {};
        try {
          parsed = call.input.trim() ? (JSON.parse(call.input) as DocumentType) : {};
        } catch {
          // Malformed arguments are answered, not thrown: the model can read
          // the complaint and try again inside its remaining rounds.
          parsed = {};
        }

        assistantContent.push({ toolUse: { toolUseId: call.toolUseId, name: call.name, input: parsed } });

        const output = await runChatTool(call.name, parsed);

        results.push({
          toolResult: {
            toolUseId: call.toolUseId,
            content: [{ text: JSON.stringify(output) }],
          },
        });
      }

      messages.push({ role: "assistant", content: assistantContent });
      messages.push({ role: "user", content: results });
    }
  } catch (error) {
    // Captured for the request log before rethrowing - a failed call is
    // exactly the one an admin will want the payload for.
    failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

    // Logged with context and rethrown. The route turns it into a message for
    // the reader; anything already streamed is kept by the `finally`.
    throw handleError("streamAiChatReplyService", error);
  } finally {
    // Runs on success, on failure, AND when the consumer stops iterating early
    // (a closed tab calls the generator's return()). An empty reply is not
    // stored - there would be nothing to show, and Converse would reject an
    // empty turn on the next send.
    if (reply.trim().length > 0) {
      const answeredAt = new Date();

      await addAiChatMessageRepo({
        id: generateId(),
        subjectId: subject.id,
        role: AI_CHAT_ROLES.ASSISTANT,
        content: reply,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        createdAt: answeredAt,
      });

      await touchAiChatSubjectRepo(subject.id, answeredAt);
    }

    // Recorded here rather than in the try, so it runs on success, on
    // failure, AND on an abandoned stream - the three cases an admin
    // reviewing spend needs to be able to tell apart. The arrays are the
    // exact ones handed to Converse above.
    await recordRequest({
      userId: user.id,
      subjectId: subject.id,
      kind: AI_CHAT_REQUEST_KINDS.CHAT,
      system,
      messages,
      usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
      error: failure,
      startedAt,
    });

    revalidateAiChatViews();
  }
}

// -------------------------------------------------------------------
// EXTENSION POINT: extended thinking
//
// Not enabled. Opus 4.6 supports adaptive thinking, and on Bedrock it is
// requested through `additionalModelRequestFields` on the Converse command:
//
//   additionalModelRequestFields: { thinking: { type: "adaptive" } }
//
// Turning it on also means handling `reasoningContent` deltas in the loop
// above and deciding whether to render them, because on Opus 4.6 `display`
// defaults to "summarized" - so reasoning text starts arriving on the stream
// whether or not the UI has anywhere to put it.
//
// NOT AVAILABLE: Anthropic's server-side compaction (`context_management`
// with `compact_20260112`). It is a Messages-API beta gated behind an
// `anthropic-beta` header, and the Converse API has no way to send one -
// there is no `compact` or `contextManagement` member anywhere in the Bedrock
// Converse types. `compactIfNeeded` above is the client-side equivalent. If
// this app ever moves to the Messages-API Bedrock endpoint, that feature
// becomes worth revisiting.
// -------------------------------------------------------------------
