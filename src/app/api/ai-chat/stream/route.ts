import { NextResponse } from "next/server";

import { isBedrockConfigured } from "@/lib/ai/bedrock-client";
import { getVerifiedApiSession } from "@/lib/auth/session-auth-server";
import { isDisplayError } from "@/lib/errors";
import { MESSAGES } from "@/lib/constants";
import { validateRequest } from "@/lib/server-requests";

import { streamAiChatReplyService } from "@/features/ai-chat/ai-chat.service";
import { SendAiChatMessageSchema } from "@/features/ai-chat/ai-chat.types";

// The Bedrock client and Kysely both need Node, and a streamed reply must
// never be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -------------------------------------------------------------------
// POST /api/ai-chat/stream
//
// WHY THIS IS A ROUTE HANDLER AND NOT AN ACTION
//
// This is the one deliberate exception to the repo's mutations-go-through-
// server-actions rule. A server action returns a value; this endpoint has to
// return a stream so the reply renders as it is generated. Everything else
// about the layering is unchanged - Zod still validates at the boundary, and
// the service still owns authorization and every database write. The only
// difference is the shape of the response.
//
// AUTHORIZATION
//
// A route handler is NOT covered by the proxy matcher (which only matches
// /admin, /manage and /portal) and has no area layout above it, so the
// session check here is the outer gate and there is nothing else in front of
// it. The service re-checks - it calls requireUser and re-resolves the
// conversation against the session user - so neither layer is load-bearing
// alone, which is the same arrangement every guarded page uses.
//
// The session is read WITHOUT redirecting: a redirect is the right answer for
// a page and the wrong one for fetch(), which would follow it and hand the
// client an HTML sign-in page where it expected a stream. This answers 401.
// -------------------------------------------------------------------
export async function POST(request: Request): Promise<Response> {
  const session = await getVerifiedApiSession();

  if (!session) {
    return NextResponse.json({ error: MESSAGES.UNAUTHORIZED }, { status: 401 });
  }

  // Inert rather than broken when no token is configured, matching how the
  // retention endpoint behaves without its secret.
  if (!isBedrockConfigured()) {
    return NextResponse.json({ error: "AI chat is not configured on this environment." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const validatedRequest = await validateRequest(SendAiChatMessageSchema, body);
  if (!validatedRequest.success) {
    return NextResponse.json(
      { error: validatedRequest.response.formError ?? MESSAGES.SOMETHING_WENT_WRONG },
      { status: 400 },
    );
  }

  // The generator authorizes before it yields anything, so a conversation
  // that is not the caller's fails here - before any stream is opened and
  // before the model is called. Started eagerly for exactly that reason: an
  // authorization failure has to be an HTTP status, not an error delivered
  // mid-stream after the client already saw a 200.
  const replies = streamAiChatReplyService(validatedRequest.data);

  let first: IteratorResult<string, void>;
  try {
    first = await replies.next();
  } catch (error) {
    // handleError in the service has already logged this with context.
    const message = isDisplayError(error) ? error.message : MESSAGES.SOMETHING_WENT_WRONG;
    const status = isDisplayError(error) ? 400 : 502;

    return NextResponse.json({ error: message }, { status });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (!first.done && first.value) {
          controller.enqueue(encoder.encode(first.value));
        }

        for await (const chunk of replies) {
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      } catch (error) {
        // The reply was already streaming when this failed, so the status is
        // long since sent. Close the stream rather than error it: the client
        // keeps the partial answer, which the service has also persisted.
        console.error("[POST /api/ai-chat/stream] failed mid-stream", error);
        controller.close();
      }
    },

    // Fires when the client goes away - a closed tab, or Stop. Returning the
    // generator runs its `finally`, which persists whatever had been
    // generated, so an abandoned reply is kept rather than paid for and
    // thrown away.
    async cancel() {
      await replies.return();
    },
  });

  return new Response(stream, {
    headers: {
      // Plain text, not SSE: the payload is one continuous answer, so there
      // is nothing to frame into events and no reason to make the client
      // parse a protocol to read it.
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Stops intermediate proxies buffering the whole reply and defeating
      // the streaming.
      "X-Accel-Buffering": "no",
    },
  });
}
