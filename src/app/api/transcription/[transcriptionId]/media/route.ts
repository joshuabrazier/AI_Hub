import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { getTranscriptionMediaService } from "@/features/transcription/transcription.service";
import { getSession } from "@/lib/auth/session-auth-server";
import { MESSAGES } from "@/lib/constants";

// Streams from Azure Blob through a Node stream, so Node; and a private
// recording must never be cached by anything in front of this app.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -------------------------------------------------------------------
// GET /api/transcription/[transcriptionId]/media
//
// Hands somebody back the recording of their own meeting.
//
// A route handler because it returns bytes: there is no server-action shape
// for "here is a file", and this is a read rather than a mutation, so the
// rule that mutations go through actions never applied to it. The same
// reasoning as GET /api/ai-chat/attachments/[attachmentId].
//
// WHY IT IS PROXIED AND NOT A SIGNED URL. The upload half of this feature
// does hand the browser a SAS, because pushing hundreds of megabytes
// through this app would tie up an instance for the length of the transfer.
// A read is deliberately not symmetrical: an upload SAS is write-only,
// scoped to one blob that does not exist yet, and worthless to anybody who
// does not already know the exact name. A READ url is a bearer token for
// the recording of a private meeting, and one that leaked into browser
// history, a proxy log or a screenshot would keep working for anybody
// holding it, long outliving the session check that produced it. Proxying
// costs bandwidth and keeps "a live session that owns it" the only way to
// hear a meeting.
//
// IT STREAMS. The service hands back an open stream rather than bytes,
// which is piped straight to the response. A meeting recording is hundreds
// of megabytes; buffering one would hold all of it in the instance's memory
// for the length of the download, and two people at once could take the
// process down.
//
// AUTHORIZATION is the service's, and it resolves the row against the
// SESSION user before touching storage - so an id belonging to somebody
// else matches nothing and answers 404, the same answer an id that never
// existed gets. The session check here is the outer gate only.
// -------------------------------------------------------------------
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ transcriptionId: string }> },
): Promise<Response> {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: MESSAGES.UNAUTHORIZED }, { status: 401 });
  }

  const { transcriptionId } = await params;

  const media = await getTranscriptionMediaService({ transcriptionId });

  // Not theirs, never existed, or the recording has been removed by
  // retention. All three answer the same way: from the reader's side the
  // file is simply not there, and saying which would tell somebody guessing
  // an id that a real transcription is behind it.
  if (!media) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const headers = new Headers({
    // The type the SERVER derived from the filename at upload, never one
    // reported back by storage - that is whatever the browser set on the
    // blob, and it is not evidence of anything.
    "Content-Type": media.mediaType,
    // Always a download. This app never plays a recording back, so the
    // bytes are never interpreted on this origin at all.
    "Content-Disposition": `attachment; filename="${asciiFallback(media.fileName)}"; filename*=UTF-8''${encodeRFC5987(media.fileName)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    // A recording of a private meeting: not by a shared cache, and not by
    // the browser's disk cache either.
    "Cache-Control": "private, no-store",
  });

  // Known from the blob's properties, so the browser can show progress on
  // what may be a long download. Omitted rather than guessed if storage did
  // not report it - a wrong Content-Length truncates the file.
  if (media.byteSize !== null) headers.set("Content-Length", String(media.byteSize));

  // Node stream to a web stream, which is what a Response body is. The
  // bytes flow through without ever being collected into one buffer.
  return new Response(Readable.toWeb(Readable.from(media.stream)) as ReadableStream, { headers });
}

// A quoted-string-safe version for the legacy `filename` parameter: only
// printable ASCII, and never a quote, a backslash or a control character.
function asciiFallback(fileName: string): string {
  const cleaned = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");

  return cleaned.trim().slice(0, 100) || "recording";
}

// encodeURIComponent leaves a handful of characters that are not valid in
// this header; percent-encode those too.
function encodeRFC5987(fileName: string): string {
  return encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
