import "server-only";

import { ConverseStreamCommand, type Message, type SystemContentBlock } from "@aws-sdk/client-bedrock-runtime";
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

// -------------------------------------------------------------------
// A TOTAL ceiling, and it is the ONLY bound that works on this failure.
//
// A CORRECTION, written from production logs. The request handler's
// socketTimeout was meant to be the real detector of a dead call, with this
// as a backstop for the rarer case of a stream that trickles. It is the
// other way round: measured in production, a stalled Bedrock call ran to
// this ceiling every time with socketTimeout at 25s never firing once. The
// socket is NOT idle during one - an AWS event stream carries periodic
// frames, so the connection stays perfectly busy while the model produces
// nothing at all.
//
// So an idle timeout cannot see this failure, and total duration is the only
// quantity that can. That makes this ceiling load-bearing rather than
// defensive, which is why it is now sized per call instead of one number for
// everything: a 300-token folder suggestion and a 4,000-token summary are
// not the same wait, and giving the first the second's budget is how one
// filing decision cost two minutes and then did it three more times.
//
// DERIVED, NOT PICKED. Slowest observed generation rate, plus an allowance
// for prefill on a large prompt. Raising a caller's token cap raises its
// ceiling with it.
// -------------------------------------------------------------------
const SLOWEST_TOKENS_PER_SECOND = 30;
const PREFILL_ALLOWANCE_MS = 30_000;

export function converseCeilingFor(maxTokens: number): number {
  return Math.ceil((maxTokens / SLOWEST_TOKENS_PER_SECOND) * 1000) + PREFILL_ALLOWANCE_MS;
}

// The default, for a caller that has not thought about it. Matches
// DEFAULT_MAX_TOKENS below.
const DEFAULT_TIMEOUT_MS = converseCeilingFor(1_500);

export interface ConverseTextParams {
  // Whose spend this is. Required, because the log row is per user and an
  // unattributed call is one nobody can be asked about.
  userId: string;
  kind: AiChatRequestKind;
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  // The caller's own deadline or cancellation, where it has one. Combined
  // with the ceiling rather than replacing it, so a caller cannot
  // accidentally remove the only bound on the call by passing a signal that
  // never fires.
  abortSignal?: AbortSignal;
  // A tighter total ceiling than the default. Worth setting whenever the
  // reply is short: the ceiling is what a stalled call actually costs, and
  // that cost is paid on every retry above it.
  timeoutMs?: number;
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

  const ceilingMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // AbortSignal.any needs Node 18.17 / 20.3; this app is on Node 20.
  const timeout = AbortSignal.timeout(ceilingMs);
  const abortSignal = params.abortSignal
    ? AbortSignal.any([params.abortSignal, timeout])
    : timeout;

  try {
    // -----------------------------------------------------------------
    // STREAMED, THOUGH THE CALLER WANTS ONE BLOCK OF TEXT.
    //
    // A non-streaming ConverseCommand holds the socket open and completely
    // silent for the whole time the model spends generating. That is fine
    // until the request handler has a socketTimeout - which it now does,
    // because without one nothing in this app could detect a dead Bedrock
    // stream at all - and then every one of these calls looks like a stall
    // and is aborted mid-generation.
    //
    // So this streams and reassembles. Identical tokens, identical price,
    // identical result to the caller, and it means ONE timeout policy is
    // correct for every call site. bedrock-client.ts states the constraint;
    // this is one of the two places that had to change to satisfy it.
    // -----------------------------------------------------------------
    const response = await getBedrockClient().send(
      new ConverseStreamCommand({
        modelId: BEDROCK_MODEL_ID,
        system,
        messages,
        inferenceConfig: {
          maxTokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: params.temperature ?? DEFAULT_TEMPERATURE,
        },
      }),
      { abortSignal },
    );

    if (!response.stream) throw new Error("Bedrock returned no stream");

    let assembled = "";

    for await (const event of response.stream) {
      const chunk = event.contentBlockDelta?.delta?.text;
      if (chunk) assembled += chunk;

      // Usage arrives once, on its own event. All four are recorded: with
      // caching in play `inputTokens` is only the uncached remainder, and
      // reading it alone understates what a call cost.
      if (event.metadata?.usage) {
        usage = {
          inputTokens: event.metadata.usage.inputTokens ?? null,
          outputTokens: event.metadata.usage.outputTokens ?? null,
          cacheReadTokens: event.metadata.usage.cacheReadInputTokens ?? null,
          cacheWriteTokens: event.metadata.usage.cacheWriteInputTokens ?? null,
        };
      }
    }

    // A stop reason of max_tokens still carries the text produced so far,
    // which is why this trusts what arrived rather than checking how it
    // ended.
    const text = assembled.trim();

    await recordConverseRequest({ ...params, system, messages, usage, error: null, startedAt });

    if (!text) throw new Error("The model returned an empty reply");

    return { text, usage };
  } catch (error) {
    // The SDK throws its own bare AbortError and discards the reason, so a
    // call that hit the ceiling above and one the caller cancelled would
    // otherwise be indistinguishable in the log. Said explicitly.
    const described = describeConverseFailure(error, params.abortSignal, timeout, ceilingMs);

    // Logged before rethrowing, and separately from the success path, so a
    // failed call is on the record with whatever usage it had reported.
    await recordConverseRequest({ ...params, system, messages, usage, error: described, startedAt });

    throw handleError("converseText", error);
  }
}

// -------------------------------------------------------------------
// Which of the three things that can stop one of these calls happened.
//
// Same argument as the chat turn guard, in miniature: "AbortError: Request
// aborted" names neither the cause nor the remedy, and the three cases have
// three different ones - wait, look at the caller, or look at Bedrock.
// -------------------------------------------------------------------
function describeConverseFailure(
  error: unknown,
  callerSignal: AbortSignal | undefined,
  timeout: AbortSignal,
  ceilingMs: number,
): string {
  const isAbort = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

  if (isAbort) {
    if (timeout.aborted) {
      // Says the ceiling, because "ran to the full budget" and "failed
      // quickly" are different problems and the SDK's own AbortError cannot
      // tell them apart.
      return (
        `TimeoutError: the model accepted the request and produced nothing for the full ` +
        `${Math.round(ceilingMs / 1000)}s allowed, so it was stopped.`
      );
    }

    if (callerSignal?.aborted) {
      return "AbortError: the caller cancelled this model call.";
    }
  }

  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
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
