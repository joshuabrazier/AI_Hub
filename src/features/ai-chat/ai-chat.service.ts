import "server-only";

import {
  ConverseCommand,
  ConverseStreamCommand,
  type Message,
  type SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";

import { BEDROCK_MODEL_ID, getBedrockClient, isBedrockConfigured } from "@/lib/ai/bedrock-client";
import { requireUser } from "@/lib/auth/session-auth-server";
import {
  AI_CHAT_ROLES,
  type AiChatMessage,
  type AiChatSubject,
} from "@/lib/data/kysely-database-types";
import {
  addAiChatMessageRepo,
  getAiChatMessagesBySubjectRepo,
} from "@/lib/data/repositories/ai-chat-messages.repository";
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

import {
  deriveAiChatSubjectTitle,
  mapDBAiChatMessageToDTO,
  mapDBAiChatSubjectToDTO,
} from "./ai-chat.mappers";
import {
  COMPACT_AT_INPUT_TOKENS,
  KEEP_RECENT_MESSAGES,
  MAX_HISTORY_CHARS,
  SUMMARY_MAX_TOKENS,
  UNTITLED_SUBJECT_TITLE,
  type AiChatPageDTO,
  type AiChatSubjectDetailDTO,
  type DeleteAiChatSubjectRequestDTO,
  type RenameAiChatSubjectRequestDTO,
  type SendAiChatMessageRequestDTO,
} from "./ai-chat.types";

// -------------------------------------------------------------------
// AI chat service
//
// THE AUTHORIZATION MODEL, WHICH IS DIFFERENT FROM THE REST OF THE APP
//
// Chat is not team-scoped. A conversation belongs to one person and nobody
// else can read it - not their manager, not an admin. So the guard here is
// requireUser (any signed-in role) rather than a role or team check, and
// the boundary is the `userId` predicate every repository query carries.
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
const SYSTEM_PROMPT = [
  "You are a helpful assistant inside a staff portal.",
  "Be direct and concise. Answer the question that was asked, and say plainly when you do not know something rather than guessing.",
  "Format with short paragraphs and lists where they help. Do not open with filler like 'Certainly' or 'Great question'.",
].join(" ");

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
      return { isConfigured: isBedrockConfigured(), subjects, active: null };
    }

    // The row, for the summary cursor - the sidebar DTO does not carry it,
    // and it is per-conversation rather than per-list.
    const targetRow = await getAiChatSubjectForUserRepo(target.id, user.id);
    const messages = await getAiChatMessagesBySubjectRepo(target.id);

    const active: AiChatSubjectDetailDTO = {
      subject: target,
      messages: messages.map(mapDBAiChatMessageToDTO),
      // Only meaningful if it actually points at a turn still in the
      // transcript; a stale cursor should not draw a marker at nothing.
      summarizedThroughMessageId:
        targetRow?.summaryThroughMessageId &&
        messages.some((message) => message.id === targetRow.summaryThroughMessageId)
          ? targetRow.summaryThroughMessageId
          : null,
    };

    return { isConfigured: isBedrockConfigured(), subjects, active };
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
};

function buildConverseRequest(
  transcript: AiChatMessage[],
  summary: string | null,
  summaryThroughMessageId: string | null,
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

  const messages: Message[] = kept.map((turn, index) => ({
    role: turn.role === AI_CHAT_ROLES.USER ? "user" : "assistant",
    content:
      index === kept.length - 1
        ? // The cache point rides on the final turn, so the cached prefix is
          // the entire request. Below the model's 4,096-token minimum it is
          // simply ignored - the request still succeeds, it just does not
          // cache - so there is no size check to get wrong here.
          [{ text: turn.content }, { cachePoint: { type: "default" } }]
        : [{ text: turn.content }],
  }));

  const system: SystemContentBlock[] = [{ text: SYSTEM_PROMPT }];

  if (summary) {
    system.push({
      text:
        "The earlier part of this conversation has been summarised to keep it within budget. " +
        "Treat the summary as an accurate record of what was said, and if the user refers to " +
        "something it does not cover, say so plainly rather than inventing the detail.\n\n" +
        `<earlier_conversation_summary>\n${summary}\n</earlier_conversation_summary>`,
    });
  }

  return { system, messages, trimmed: firstKept };
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

  const transcriptText = folding
    .map((turn) => `${turn.role === AI_CHAT_ROLES.USER ? "User" : "Assistant"}: ${turn.content}`)
    .join("\n\n");

  try {
    const response = await getBedrockClient().send(
      new ConverseCommand({
        modelId: BEDROCK_MODEL_ID,
        system: [
          {
            text:
              "You compress conversation transcripts so a later reader can carry on without them. " +
              "Preserve decisions, facts, names, numbers, code identifiers, and anything the user asked to be " +
              "remembered. Drop pleasantries and restatements. Write plain prose in the third person, with no " +
              "preamble and no closing remark. Never invent detail that is not in the transcript.",
          },
        ],
        messages: [
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
        ],
        inferenceConfig: { maxTokens: SUMMARY_MAX_TOKENS },
      }),
    );

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
  await addAiChatMessageRepo({
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

  const { summary, summaryThroughMessageId } = await compactIfNeeded(subject, transcript, user.id);

  const { system, messages, trimmed } = buildConverseRequest(transcript, summary, summaryThroughMessageId);

  if (trimmed > 0) {
    // The backstop fired, which means compaction did not keep up. Not
    // user-facing - the reply is still correct, just missing distant context.
    console.warn(`streamAiChatReplyService: backstop trimmed ${trimmed} turn(s) beyond the summary`);
  }

  let reply = "";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let cacheReadTokens: number | null = null;
  let cacheWriteTokens: number | null = null;

  try {
    const response = await getBedrockClient().send(
      new ConverseStreamCommand({
        modelId: BEDROCK_MODEL_ID,
        system,
        messages,
        inferenceConfig: { maxTokens: MAX_OUTPUT_TOKENS },
      }),
    );

    if (!response.stream) {
      throw new Error("Bedrock returned no stream");
    }

    for await (const event of response.stream) {
      // Text arrives as deltas on the content block. `toolUse` and
      // `reasoningContent` deltas are possible on this union and are ignored:
      // no tools are declared, and extended thinking is not enabled.
      const chunk = event.contentBlockDelta?.delta?.text;
      if (chunk) {
        reply += chunk;
        yield chunk;
        continue;
      }

      // Usage arrives once, at the end, on its own event. All four figures are
      // recorded: `inputTokens` alone is only the uncached remainder once a
      // cache point is in play.
      if (event.metadata?.usage) {
        inputTokens = event.metadata.usage.inputTokens ?? null;
        outputTokens = event.metadata.usage.outputTokens ?? null;
        cacheReadTokens = event.metadata.usage.cacheReadInputTokens ?? null;
        cacheWriteTokens = event.metadata.usage.cacheWriteInputTokens ?? null;
      }
    }
  } catch (error) {
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
