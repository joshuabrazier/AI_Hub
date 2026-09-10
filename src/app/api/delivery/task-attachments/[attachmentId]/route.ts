import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { getVerifiedApiSession } from "@/lib/auth/session-auth-server";
import { MESSAGES } from "@/lib/constants";

import { getTaskAttachmentDownloadService } from "@/features/delivery/delivery-board.service";

// Streams from Azure Blob through a Node stream, so Node; and a private file
// must never be cached by anything in front of this app.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -------------------------------------------------------------------
// GET /api/delivery/task-attachments/[attachmentId]
//
// Serves a file on a card back to somebody on that project.
//
// A route handler because it returns bytes: there is no server-action shape
// for "here is a file", and this is a read rather than a mutation, so the
// actions rule never applied to it. The same reasoning as
// GET /api/ai-chat/attachments/[attachmentId] and the transcription media
// route.
//
// PROXIED, NEVER A SIGNED URL. The one place this module signs anything is
// the transcription upload, and that SAS is write-only and scoped to a blob
// that does not exist yet. A READ url is a bearer token for a client's
// contract, and one that leaked into browser history, a proxy log or a
// screenshot would keep working for anybody holding it, long outliving the
// session check that produced it. Proxying costs bandwidth and keeps "a live
// session on that project" the only way to read a file.
//
// IT STREAMS, because a card carries whole design packs. Buffering one to
// hand to a Response would hold all of it in the instance's memory for the
// length of the transfer, and two downloads at once could take the process
// down.
//
// AUTHORIZATION IS THE SERVICE'S. It reads the row, resolves the project the
// row names, and answers null unless the caller is on it - so an id from
// somebody else's client is indistinguishable from one that never existed.
// The session check here is the outer gate only.
//
// -------------------------------------------------------------------
// SERVING UNTRUSTED BYTES SAFELY - the part that matters most here.
//
// These bytes came from a person and are served from the app's OWN origin,
// where a file the browser decides to treat as HTML would run as a page with
// access to this app's cookies and DOM. Four things stop that, and the first
// three are all load-bearing:
//
//   1. `X-Content-Type-Options: nosniff` - the browser must believe the
//      Content-Type below and may not guess a better one from the content.
//   2. The Content-Type is the SNIFFED type recorded at upload, never
//      anything the browser claimed, and `html` deliberately maps to
//      text/plain (see attachment-formats.ts).
//   3. Only images are served inline. Everything else is
//      `Content-Disposition: attachment`, which downloads rather than
//      renders whatever the browser makes of the type.
//
// `Content-Security-Policy: sandbox` is the fourth, so even a response that
// somehow rendered would do it with no script and no same-origin privileges.
// -------------------------------------------------------------------
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
): Promise<Response> {
  const session = await getVerifiedApiSession();

  if (!session) {
    return NextResponse.json({ error: MESSAGES.UNAUTHORIZED }, { status: 401 });
  }

  const { attachmentId } = await params;

  const attachment = await getTaskAttachmentDownloadService(attachmentId);

  // Not on that project, never existed, or the blob has gone. All three
  // answer the same way: from the reader's side the file is simply not
  // there, and saying which would tell somebody guessing an id that a real
  // file is behind it.
  if (!attachment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isImage = attachment.mediaType.startsWith("image/");

  const headers = new Headers({
    "Content-Type": attachment.mediaType,
    "Content-Length": String(attachment.byteSize),
    // RFC 5987. The filename is somebody's own and may contain quotes,
    // newlines or non-ASCII, any of which would let it break out of the
    // header and inject one of its own - so the plain `filename` is stripped
    // to a safe subset and the real name rides on `filename*`,
    // percent-encoded.
    "Content-Disposition": `${isImage ? "inline" : "attachment"}; filename="${asciiFallback(attachment.fileName)}"; filename*=UTF-8''${encodeRFC5987(attachment.fileName)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    // A client's document: not by a shared cache, and not by the browser's
    // disk cache either.
    "Cache-Control": "private, no-store",
  });

  // Node stream to a web stream, which is what a Response body is. The bytes
  // flow through without ever being collected into one buffer.
  return new Response(Readable.toWeb(Readable.from(attachment.stream)) as ReadableStream, { headers });
}

// A quoted-string-safe version for the legacy `filename` parameter: only
// printable ASCII, and never a quote, a backslash or a control character.
function asciiFallback(fileName: string): string {
  const cleaned = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");

  return cleaned.trim().slice(0, 100) || "attachment";
}

// encodeURIComponent leaves a handful of characters that are not valid in
// this header; percent-encode those too.
function encodeRFC5987(fileName: string): string {
  return encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
