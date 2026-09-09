import { NextResponse } from "next/server";

import { isBedrockConfigured } from "@/lib/ai/bedrock-client";
import {
  encodeStreamEvent,
  STREAM_CONTENT_TYPE,
  type StreamEvent,
} from "@/lib/ai/stream-protocol";
import { createTurnGuard } from "@/lib/ai/turn-guard";
import { getVerifiedApiSession } from "@/lib/auth/session-auth-server";
import { isDisplayError } from "@/lib/errors";
import { MESSAGES } from "@/lib/constants";
import { validateRequest } from "@/lib/server-requests";

import { streamAiChatReplyService } from "@/features/ai-chat/ai-chat.service";
import { CHAT_FIRST_BYTE_CEILING_MS, SendAiChatMessageSchema } from "@/features/ai-chat/ai-chat.types";

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

  // -----------------------------------------------------------------
  // THREE REASONS TO STOP, AND NONE OF THEM IS "THIS IS TAKING A WHILE".
  //
  //   A PHASE OVERRAN     each stage of a turn has its own budget and its own
  //                       name, so the failure says which one. This replaced
  //                       a single clock that covered the database, the
  //                       attachment downloads and a whole compaction model
  //                       call under a name about the model's first token,
  //                       and therefore reported "the model sent nothing"
  //                       before the model had been asked.
  //
  //   THE CEILING         nothing reached the reader before Azure's own idle
  //                       timeout got close. If the platform wins that race
  //                       the connection is severed mid-flight and the app
  //                       never learns it happened.
  //
  //   THE READER LEFT     `request.signal` aborts when the browser goes away
  //                       - a closed tab, a navigation, or the load balancer
  //                       cutting an idle connection. Without it the server
  //                       carried on calling Bedrock long after there was
  //                       anybody to answer.
  //
  // The guard carries all three, and knows which one happened - which is the
  // difference between a message and a diagnosis.
  // -----------------------------------------------------------------
  const guard = createTurnGuard(request.signal, { firstByteCeilingMs: CHAT_FIRST_BYTE_CEILING_MS });

  const replies = streamAiChatReplyService(validatedRequest.data, guard);

  // -----------------------------------------------------------------
  // Started eagerly, because an authorization failure has to be an HTTP
  // status rather than an error delivered mid-stream after the client has
  // already seen a 200. The service authorizes before its first yield, so
  // anything that must answer with a status code has already run by the time
  // this resolves.
  //
  // Everything AFTER this point is delivered in-band as an `error` event.
  // That is not a compromise, it is strictly more capable: a reply that fails
  // three minutes in cannot have its status code changed, and the old code
  // handled that case by closing the stream - which the browser cannot tell
  // apart from a reply that finished. People reported it as "it just stops".
  // -----------------------------------------------------------------
  let first: IteratorResult<StreamEvent, void>;
  try {
    first = await replies.next();
  } catch (error) {
    guard.dispose();

    // The service has already logged this with its full timeline and written
    // it to the request log. This is the reader's copy of the same sentence.
    const message = isDisplayError(error) ? error.message : guard.describe(error);
    const status = isDisplayError(error) ? 400 : 502;

    return NextResponse.json({ error: message }, { status });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(encodeStreamEvent(event)));

        // Anything reaching the reader resets the platform's idle clock, so
        // the overall ceiling has done its job and stops applying. From here
        // the per-phase budgets are the only limit, which is what lets a long
        // answer run as long as it keeps talking.
        guard.firstByteReached();
      };

      try {
        if (!first.done) send(first.value);

        for await (const event of replies) {
          send(event);
        }

        controller.close();
      } catch (error) {
        // -------------------------------------------------------------
        // THE REPLY WAS ALREADY STREAMING, SO THE STATUS IS LONG SENT.
        //
        // This used to close the stream and log to the server, which meant
        // the reader kept a partial answer with no indication that anything
        // had gone wrong. The reason now goes down the wire: the client shows
        // it and keeps the partial text, which the service has also
        // persisted.
        // -------------------------------------------------------------
        const reason = isDisplayError(error) ? error.message : guard.describe(error);

        console.error(`[POST /api/ai-chat/stream] failed mid-stream: ${reason}`);

        try {
          controller.enqueue(encoder.encode(encodeStreamEvent({ t: "error", v: reason })));
        } catch {
          // The reader has already gone, which is the one case where there is
          // nobody to tell. Not worth a log line of its own - the service has
          // recorded the failure either way.
        }

        controller.close();
      } finally {
        // However this ended. A timer left armed would fire into a finished
        // request and hold the event loop open for its full window.
        guard.dispose();
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
      // Newline-delimited JSON rather than plain text. The payload is not
      // just the answer any more: it also carries what the server is doing
      // while there is no answer yet, and why it stopped if it stopped. See
      // stream-protocol.ts.
      "Content-Type": STREAM_CONTENT_TYPE,
      "Cache-Control": "no-store, no-transform",
      // Stops intermediate proxies buffering the whole reply and defeating
      // the streaming.
      "X-Accel-Buffering": "no",
    },
  });
}
