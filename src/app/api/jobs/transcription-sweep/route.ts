import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { sweepAllTranscriptionsService } from "@/features/transcription/transcription.service";
import { envServer } from "@/lib/env-server";

// Talks to the Speech service, blob storage and Bedrock, so Node; and its
// answer is about this minute, so it must never be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Constant-time bearer check so a wrong secret cannot be timed out.
function bearerMatches(header: string | null, secret: string): boolean {
  const prefix = "Bearer ";
  if (!header || !header.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

// -------------------------------------------------------------------
// POST /api/jobs/transcription-sweep
//
// Carries EVERYBODY'S unfinished transcriptions forward. Meant to be called
// on a timer, every minute or two.
//
// WHY THIS EXISTS, and it is a reversal of an earlier decision worth being
// explicit about. Transcription was built with no background worker: jobs
// advanced only while somebody had the screen open, and the trade was that
// there was nothing to deploy, schedule or monitor. That trade stops working
// the moment you want a notification when a transcription is ready - with a
// locked phone nothing is running, so the job never finishes and there is
// nothing to notify about. This is the piece that makes "record it and walk
// away" true rather than nearly true.
//
// The browser-driven sweep at /api/transcription/sweep stays. It is what
// makes the screen feel live for somebody watching it, and it does not
// depend on this job running.
//
// AUTHENTICATION IS THIS BEARER SECRET AND NOTHING ELSE. There is no
// session behind a scheduler, so the usual role guards do not apply and
// must not be added. The service it calls acts on rows it did not resolve
// from a session - the only place in the feature that does - which is
// precisely why the door in front of it is locked this way.
//
// Inert until TRANSCRIPTION_SWEEP_SECRET is set, exactly like the retention
// job, so deploying this cannot start background work on its own.
// -------------------------------------------------------------------
export async function POST(request: Request): Promise<Response> {
  const secret = envServer.TRANSCRIPTION_SWEEP_SECRET;

  // No secret configured => the endpoint is intentionally inert.
  if (!secret) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await sweepAllTranscriptionsService();

  // Counts only - no ids, no titles, no owners - so a scheduler's logs do
  // not become a record of who is recording what.
  console.info(
    `[transcription-sweep] examined=${result.examined} advanced=${result.advanced}`,
  );

  return NextResponse.json({ ok: true, ...result });
}
