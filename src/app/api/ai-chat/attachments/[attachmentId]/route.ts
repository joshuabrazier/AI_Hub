import { NextResponse } from "next/server";

import { AI_CHAT_ATTACHMENT_KINDS } from "@/lib/data/kysely-database-types";
import { getSession } from "@/lib/auth/session-auth-server";
import { getAiChatAttachmentForUserRepo } from "@/lib/data/repositories/ai-chat-attachments.repository";
import { getAttachment } from "@/lib/storage/attachment-storage";
import { MESSAGES } from "@/lib/constants";

// Reads BYTEA from Postgres, so Node; and a private file must never be
// cached by anything in front of this app.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -------------------------------------------------------------------
// GET /api/ai-chat/attachments/[attachmentId]
//
// Serves an attached file back to the person who uploaded it - the preview
// in the transcript, and the download behind it.
//
// A route handler because it returns bytes: there is no server-action shape
// for "here is a file", and this is a read rather than a mutation, so the
// actions rule does not apply to it in the first place.
//
// The file lives in Azure Blob and is streamed through this handler rather
// than handed to the browser as a signed URL. That is deliberate: a SAS URL
// is a bearer token, and one that leaked into browser history, a proxy log
// or a screenshot would read that file for anybody holding it, outliving
// the session check that produced it. Proxying costs bandwidth and keeps
// the rule that the ONLY way to read an attachment is a live session that
// owns it.
//
// AUTHORIZATION is the repository predicate. The query is keyed on
// `(id, user_id)`, so an id belonging to somebody else's conversation
// simply matches nothing and answers 404 - the same answer an id that never
// existed gets, which keeps a guessed id from confirming that a file is
// there. There is no admin override: the request log records that a file
// was sent, not the file.
//
// SERVING UNTRUSTED BYTES SAFELY - the part that matters most here.
//
// These bytes came from a user, and they are served from the app's OWN
// origin, where a document that the browser decides to treat as HTML would
// run as a page with access to this app's cookies and DOM. Three things
// stop that, and all three are load-bearing:
//
//   1. `X-Content-Type-Options: nosniff` - the browser must believe the
//      Content-Type below and may not guess a better one from the content.
//   2. The Content-Type comes from the SNIFFED format, never from what the
//      browser claimed at upload, and `html` deliberately maps to
//      text/plain (see attachment-formats.ts).
//   3. Only the four image formats are served inline. Everything else is
//      Content-Disposition: attachment, which downloads rather than renders
//      no matter what the browser makes of the type.
//
// `Content-Security-Policy: sandbox` is set as a fourth layer, so even a
// response that somehow rendered would do it without script or same-origin
// privileges.
// -------------------------------------------------------------------
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attachmentId: string }> },
): Promise<Response> {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: MESSAGES.UNAUTHORIZED }, { status: 401 });
  }

  const { attachmentId } = await params;

  const attachment = await getAiChatAttachmentForUserRepo(attachmentId, session.user.id);

  if (!attachment) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The row is authorization; the blob is just bytes. Fetched only AFTER
  // the ownership check above has passed, so an id that is not the
  // caller's never reaches storage at all.
  const bytes = await getAttachment(attachment.storageKey);

  // A row pointing at a blob that is gone. Answered as 404 rather than 500:
  // from the reader's side the file is simply not there, and this is a
  // recoverable state that retention or a partial delete can produce.
  if (!bytes) {
    console.warn(`[GET attachment] blob missing for ${attachment.id} (${attachment.storageKey})`);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Images render in the transcript; everything else downloads. A document
  // is never displayed by this app, so it never gets the chance to be
  // interpreted as markup on this origin.
  const isImage = attachment.kind === AI_CHAT_ATTACHMENT_KINDS.IMAGE;
  const disposition = isImage ? "inline" : "attachment";

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.mediaType,
      "Content-Length": String(attachment.byteSize),
      // RFC 5987. The filename is the user's own and may contain quotes,
      // newlines or non-ASCII, any of which would let it break out of the
      // header and inject one of its own - so the plain `filename` is
      // stripped to a safe subset and the real name rides on `filename*`,
      // percent-encoded.
      "Content-Disposition": `${disposition}; filename="${asciiFallback(attachment.fileName)}"; filename*=UTF-8''${encodeRFC5987(attachment.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      // Private content: not by a shared cache, and not by the browser's
      // disk cache either, since these can be sensitive documents.
      "Cache-Control": "private, no-store",
    },
  });
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
