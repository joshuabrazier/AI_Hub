import { NextResponse } from "next/server";

import { MAX_DOCUMENT_BYTES } from "@/lib/ai/attachment-formats";
import { isBedrockConfigured } from "@/lib/ai/bedrock-client";
import { getVerifiedApiSession } from "@/lib/auth/session-auth-server";
import { MESSAGES } from "@/lib/constants";
import { DisplayErrorMessage } from "@/lib/errors";
import { validateRequest } from "@/lib/server-requests";

import { uploadAiChatAttachmentService } from "@/features/ai-chat/ai-chat.service";
import { UploadAiChatAttachmentSchema } from "@/features/ai-chat/ai-chat.types";

// Reads the body as bytes and writes to Postgres, so it needs Node, and an
// upload must never be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -------------------------------------------------------------------
// POST /api/ai-chat/attachments
//
// WHY THIS IS A ROUTE HANDLER AND NOT AN ACTION
//
// The second - and, along with the streaming send, the only other -
// deliberate exception to the mutations-go-through-server-actions rule.
// Server actions CAN take a File on FormData, so this is not about
// capability; it is about the body limit. Actions are capped by
// `serverActions.bodySizeLimit`, which defaults to 1 MB and is GLOBAL:
// raising it to clear a 4.5 MB document would raise it for every action in
// the app, turning a real denial-of-service control into a much weaker one
// so that one feature could accept files. A route handler takes its own
// limit here instead, and every other action keeps the tight default.
//
// Nothing else about the layering changes. Zod validates the field that
// travels with the file, the SERVICE owns authorization and the write, and
// the file itself is validated by inspecting its bytes - a schema can only
// describe what the client claimed about it.
//
// AUTHORIZATION
//
// Like the streaming route, this is not covered by the proxy matcher and
// has no area layout above it, so the session check here is the outer gate
// and the service re-checks. The session is read WITHOUT redirecting,
// because fetch() would follow a redirect and receive an HTML sign-in page
// where it expected JSON.
// -------------------------------------------------------------------

// The per-file ceiling is the document cap - the largest single thing the
// API will take. Enforced twice: once on the declared length, so an
// oversized upload is refused before it is read, and once on what actually
// arrived, because Content-Length is client-supplied and a lie is free.
// A little headroom is allowed for the multipart framing around the file.
const MAX_UPLOAD_BYTES = MAX_DOCUMENT_BYTES + 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  const session = await getVerifiedApiSession();

  if (!session) {
    return NextResponse.json({ error: MESSAGES.UNAUTHORIZED }, { status: 401 });
  }

  // Inert rather than broken when no token is configured - there is no point
  // storing a file for a model this environment cannot reach.
  if (!isBedrockConfigured()) {
    return NextResponse.json({ error: "AI chat is not configured on this environment." }, { status: 503 });
  }

  // Cheap rejection on the declared size, before anything is buffered.
  const declaredLength = Number(request.headers.get("content-length") ?? 0);

  if (declaredLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That file is too large." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }

  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Expected a file upload." }, { status: 400 });
  }

  // The real size, now that the body has been read. A client that
  // understated Content-Length gets caught here.
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That file is too large." }, { status: 413 });
  }

  const validatedRequest = await validateRequest(UploadAiChatAttachmentSchema, {
    subjectId: form.get("subjectId"),
  });

  if (!validatedRequest.success) {
    return NextResponse.json(
      { error: validatedRequest.response.formError ?? MESSAGES.SOMETHING_WENT_WRONG },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    const attachment = await uploadAiChatAttachmentService(validatedRequest.data, {
      // `file.name` is whatever the browser sent. It is stored for display
      // and never used to decide what the file is.
      fileName: file.name,
      bytes,
    });

    return NextResponse.json({ attachment });
  } catch (error) {
    // A DisplayErrorMessage here is a validation result meant for the person
    // who chose the file - an unsupported type, an image too large. Anything
    // else has already been logged with context by handleError.
    const message = error instanceof DisplayErrorMessage ? error.message : MESSAGES.SOMETHING_WENT_WRONG;
    const status = error instanceof DisplayErrorMessage ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
