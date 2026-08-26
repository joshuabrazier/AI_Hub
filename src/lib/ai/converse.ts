import "server-only";

import { ConverseCommand, type Message, type SystemContentBlock } from "@aws-sdk/client-bedrock-runtime";
import { generateId } from "better-auth";

import {
  addAiChatRequestLogRepo,
  boundPayload,
} from "@/lib/data/repositories/ai-chat-request-logs.repository";
import { type AiChatRequestKind } from "@/lib/data/kysely-database-types";
import { handleError } from "@/lib/handle-errors";

import { BEDROCK_MODEL_ID, BEDROCK_REGION, getBedrockClient, isBedrockConfigured } from "./bedrock-client";

// -------------------------------------------------------------------
// One model call, one block of text back.
//
// WHY THIS EXISTS SEPARATELY FROM THE CHAT SERVICE. The only other path to
// the model is streamAiChatReplyService, an async generator welded to chat
// subjects, stored messages, attachments and compaction. A feature that wants
// a paragraph about a number needs none of that, and reusing it would mean
// inventing a fake conversation to hang the request off.
//
// WHAT IT DELIBERATELY KEEPS is the logging. CLAUDE.md makes
// ai_chat_request_logs a promise: it records what was actually sent to the
// model on EVERY call, and admins can read it in full. A second path to
// Bedrock that skipped it would quietly turn that promise into "every call
// except the ones added later", which is the kind of gap nobody discovers
// until they need the record. So this writes a row for successes and failures
// alike, and a failure is exactly when an admin most wants the payload.
//
// The `kind` column is what tells those rows apart in the viewer, which is
// why each caller passes its own rather than borrowing 'chat'.
//
// NO PROMPT CACHING HERE, on purpose. A cache point earns its keep when a
// long prefix is re-sent turn after turn; these calls are one-shot, and the
// minimum cacheable prefix for this model is 4,096 tokens - larger than most
// of these requests. The feature's own result cache is the right layer for
// not paying twice, and it saves the whole call rather than part of one.
// -------------------------------------------------------------------

// Enough for several paragraphs and no more. A summary that runs past this is
// not a summary, and an unbounded max is how one call quietly costs what fifty
// should.
const DEFAULT_MAX_TOKENS = 1_500;

// Low but not zero. These calls describe the same figures every time, so
// near-determinism is the point: two admins asking about one week should not
// get materially different readings of it.
const DEFAULT_TEMPERATURE = 0.2;

export class BedrockNotConfiguredError extends Error {
  constructor() {
    super("Bedrock is not configured");
    this.name = "BedrockNotConfiguredError";
  }
}

export interface ConverseTextParams {
  // Whose spend this is. Required, because the log row is per user and an
  // unattributed call is one nobody can be asked about.
  userId: string;
  kind: AiChatRequestKind;
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ConverseTextResult {
  text: string;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
  };
}

export async function converseText(params: ConverseTextParams): Promise<ConverseTextResult> {
  if (!isBedrockConfigured()) throw new BedrockNotConfiguredError();

  const system: SystemContentBlock[] = [{ text: params.system }];
  const messages: Message[] = [{ role: "user", content: [{ text: params.prompt }] }];

  const startedAt = Date.now();

  let usage: ConverseTextResult["usage"] = {
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
  };

  try {
    const response = await getBedrockClient().send(
      new ConverseCommand({
        modelId: BEDROCK_MODEL_ID,
        system,
        messages,
        inferenceConfig: {
          maxTokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: params.temperature ?? DEFAULT_TEMPERATURE,
        },
      }),
    );

    usage = {
      inputTokens: response.usage?.inputTokens ?? null,
      outputTokens: response.usage?.outputTokens ?? null,
      cacheReadTokens: response.usage?.cacheReadInputTokens ?? null,
      cacheWriteTokens: response.usage?.cacheWriteInputTokens ?? null,
    };

    // Converse returns content as blocks even for a plain text reply, and a
    // stop reason of max_tokens still carries the text produced so far.
    const text = (response.output?.message?.content ?? [])
      .map((block) => ("text" in block && block.text ? block.text : ""))
      .join("")
      .trim();

    await recordConverseRequest({ ...params, system, messages, usage, error: null, startedAt });

    if (!text) throw new Error("The model returned an empty reply");

    return { text, usage };
  } catch (error) {
    const described = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

    // Logged before rethrowing, and separately from the success path, so a
    // failed call is on the record with whatever usage it had reported.
    await recordConverseRequest({ ...params, system, messages, usage, error: described, startedAt });

    throw handleError("converseText", error);
  }
}

// -------------------------------------------------------------------
// The log row. Text only: nothing on this path can carry an attachment, so
// unlike the chat recorder there is no file metadata to flatten.
//
// Guarded and best effort. Losing a log row is bad; failing the caller's
// request because the log write failed would be worse, and the thrown error
// would replace the real one on the failure path.
// -------------------------------------------------------------------
async function recordConverseRequest(entry: {
  userId: string;
  kind: AiChatRequestKind;
  system: SystemContentBlock[];
  messages: Message[];
  usage: ConverseTextResult["usage"];
  error: string | null;
  startedAt: number;
}): Promise<void> {
  try {
    const messages = entry.messages.map((message) => ({
      role: message.role ?? "unknown",
      text: (message.content ?? [])
        .map((block) => ("text" in block && block.text ? block.text : ""))
        .join(""),
      cachePoint: false,
    }));

    const systemBlocks = entry.system.map((block) => ({
      text: "text" in block && block.text ? block.text : "",
    }));

    // Bounded together so a shortened payload cannot be filed as complete.
    const serialisedMessages = boundPayload(JSON.stringify(messages));
    const serialisedSystem = boundPayload(JSON.stringify(systemBlocks));

    await addAiChatRequestLogRepo({
      id: generateId(),
      userId: entry.userId,
      // No conversation to point at. The column is a nullable soft reference
      // precisely so a call that is not part of a thread can still be logged.
      subjectId: null,
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
    console.error("[converse] request log failed", error);
  }
}
