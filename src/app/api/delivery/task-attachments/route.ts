import { NextResponse } from "next/server";

import { getVerifiedApiSession } from "@/lib/auth/session-auth-server";
import { MESSAGES } from "@/lib/constants";
import { isDisplayError } from "@/lib/errors";
import { validateRequest } from "@/lib/server-requests";

import { uploadTaskAttachmentService } from "@/features/delivery/delivery-board.service";
import { MAX_TASK_ATTACHMENT_BYTES, UploadTaskAttachmentSchema } from "@/features/delivery/delivery.types";

// Reads the body as bytes and writes to Azure Blob, so it needs Node, and an
// upload must never be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -------------------------------------------------------------------
// POST /api/delivery/task-attachments
//
// The file somebody hangs off a card: a scope document, a signed variation,
// a screenshot of the thing that is broken.
//
// WHY THIS IS A ROUTE HANDLER AND NOT AN ACTION
//
// The same reason the chat upload is, and the only reason. Server actions
// CAN take a File on FormData, so this is not about capability; it is about
// the body limit. Actions are capped by `serverActions.bodySizeLimit`, which
// defaults to 1 MB and is GLOBAL: raising it to clear a scope document would
// raise it for every action in the app, turning a real denial-of-service
// control into a much weaker one so that one feature could accept files.
// This handler takes its own limit instead and every other action keeps the
// tight default.
//
// NOTHING ELSE ABOUT THE LAYERING CHANGES, and this file is deliberately
// thinner than the one it replaced in the plan. It reads the multipart body
// and hands over. It does NOT resolve the task, build a storage key, write a
// blob or decide whether an archived project may be written to - all four
// are the service's, which is what keeps the key builder in one place and
// lets the archived refusal happen BEFORE the bytes land. See the note on
// uploadTaskAttachmentService.
//
// AUTHORIZATION
//
// A route handler is not covered by the proxy matcher and has no area layout
// above it, so the session check here is the outer gate and the service
// re-checks - it is the thing that knows which project the task is on. The
// session is read WITHOUT redirecting, because fetch() would follow a
// redirect and receive an HTML sign-in page where it expected JSON.
// -------------------------------------------------------------------

// A little headroom over the file ceiling for the multipart framing around
// it, so a file at exactly the limit is not refused by its own envelope.
const MAX_UPLOAD_BYTES = MAX_TASK_ATTACHMENT_BYTES + 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  const session = await getVerifiedApiSession();

  if (!session) {
    return NextResponse.json({ error: MESSAGES.UNAUTHORIZED }, { status: 401 });
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

  // The real size, now that the body has been read. Content-Length is
  // client-supplied and a lie is free, so it is checked twice.
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That file is too large." }, { status: 413 });
  }

  const validatedRequest = await validateRequest(UploadTaskAttachmentSchema, {
    taskId: form.get("taskId"),
    // Whatever the browser sent. The schema strips any path off it and
    // bounds it; it is stored for display and never decides what the file
    // is.
    fileName: file.name,
  });

  if (!validatedRequest.success) {
    return NextResponse.json(
      { error: validatedRequest.response.formError ?? MESSAGES.SOMETHING_WENT_WRONG },
      { status: 400 },
    );
  }

  try {
    const attachment = await uploadTaskAttachmentService(
      validatedRequest.data,
      Buffer.from(await file.arrayBuffer()),
    );

    return NextResponse.json({ attachment });
  } catch (error) {
    // A DisplayErrorMessage here is meant for the person who chose the file
    // - an unsupported type, an image too large, a project since archived.
    // Anything else has already been logged with context by handleError.
    const message = isDisplayError(error) ? error.message : MESSAGES.SOMETHING_WENT_WRONG;
    const status = isDisplayError(error) ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
