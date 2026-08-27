import { NextResponse } from "next/server";

import { streamTextSummaryService } from "@/features/summaries/summaries.service";
import { SummariseTextSchema } from "@/features/summaries/summaries.types";
import { isBedrockConfigured } from "@/lib/ai/bedrock-client";
import { getVerifiedApiSession } from "@/lib/auth/session-auth-server";
import { MESSAGES } from "@/lib/constants";
import { isDisplayError } from "@/lib/errors";
import { validateRequest } from "@/lib/server-requests";

// The Bedrock client and Kysely both need Node, and a streamed summary must
// never be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -------------------------------------------------------------------
// POST /api/summaries/stream
//
// WHY A ROUTE HANDLER AND NOT AN ACTION - the same reason as
// /api/ai-chat/stream, and it is the shape of the response rather than a
// preference. A server action returns a value; this has to return a stream
// so the summary renders as it is written. Everything else about the
// layering is unchanged: Zod validates at the boundary and the service owns
// authorization.
//
// There is a second reason here that chat does not have. A detailed summary
// of a long document runs for a minute or more, and server actions are
// executed ONE AT A TIME - as an action this would hold every other
// interaction on the page behind it, which is exactly the mistake the
// transcription sweep made before it moved to a route.
//
// A route handler is NOT covered by the proxy matcher and has no area
// layout above it, so the session check here is the outer gate. The service
// re-checks with requireUser, so neither layer is load-bearing alone.
//
// The session is read WITHOUT redirecting: a redirect is right for a page
// and wrong for fetch(), which would follow it and hand the client an HTML
// sign-in page where it expected a stream. This answers 401.
// -------------------------------------------------------------------
export async function POST(request: Request): Promise<Response> {
  const session = await getVerifiedApiSession();

  if (!session) {
    return NextResponse.json({ error: MESSAGES.UNAUTHORIZED }, { status: 401 });
  }

  if (!isBedrockConfigured()) {
    return NextResponse.json({ error: "Summaries are not configured on this environment." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const validatedRequest = await validateRequest(SummariseTextSchema, body);
  if (!validatedRequest.success) {
    return NextResponse.json(
      { error: validatedRequest.response.formError ?? MESSAGES.SOMETHING_WENT_WRONG },
      { status: 400 },
    );
  }

  // Started eagerly so an authorization or configuration failure is an HTTP
  // status rather than an error delivered mid-stream, after the client has
  // already seen a 200 and started rendering.
  const summary = streamTextSummaryService(validatedRequest.data);

  let first: IteratorResult<string, void>;
  try {
    first = await summary.next();
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

        for await (const chunk of summary) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (error) {
        // Mid-stream failure. The client has a 200 and part of a summary, so
        // there is no status left to change - the connection simply ends and
        // the reader keeps what arrived. Logged rather than swallowed.
        console.error("[POST /api/summaries/stream] stream failed after starting", error);
      } finally {
        controller.close();
      }
    },

    // The reader closed the tab or pressed stop. Returning the generator
    // runs its `finally`, so the request is still recorded in the log - an
    // abandoned summary was paid for like any other.
    cancel() {
      void summary.return(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      // Stops a proxy buffering the whole response and defeating the point
      // of streaming it.
      "X-Accel-Buffering": "no",
    },
  });
}
