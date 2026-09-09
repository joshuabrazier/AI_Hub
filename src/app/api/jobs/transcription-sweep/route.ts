import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { sweepTranscriptionFilingService } from "@/features/transcription/filing.service";
import {
  sweepAllTranscriptionsService,
  sweepTeamsAutoImportsService,
} from "@/features/transcription/transcription.service";
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

  // -----------------------------------------------------------------
  // Collect first, then advance.
  //
  // Order matters and saves a whole sweep interval: an auto-import lands a
  // row in `summarising`, and running the advance pass afterwards picks it
  // up in the same run rather than leaving it until the next one.
  //
  // Its failures are its own. A Graph outage must not stop transcriptions
  // that are already recorded from being summarised, so this is caught here
  // rather than allowed to abandon the pass below.
  // -----------------------------------------------------------------
  let autoImport = { examined: 0, imported: 0, gaveUp: 0 };

  try {
    autoImport = await sweepTeamsAutoImportsService();
  } catch (error) {
    console.error("[transcription-sweep] auto-import pass failed", error);
  }

  // -----------------------------------------------------------------
  // Retry filing BEFORE the advance pass, and the order is deliberate.
  //
  // A transcription that finishes below files itself on the spot, spending
  // attempt one. Running this pass afterwards would find that same row and
  // immediately spend attempt two - burning half the retry budget inside a
  // single run, on a SharePoint that has had no time to recover. Running it
  // first means every retry is a full sweep interval apart, which is what
  // makes four attempts worth having.
  //
  // Its failures are its own, for the same reason as the auto-import pass:
  // an unreachable SharePoint must not stop transcriptions being summarised.
  // -----------------------------------------------------------------
  let filing = { examined: 0, filed: 0 };

  try {
    filing = await sweepTranscriptionFilingService();
  } catch (error) {
    console.error("[transcription-sweep] filing pass failed", error);
  }

  const result = await sweepAllTranscriptionsService();

  // Counts only - no ids, no titles, no owners - so a scheduler's logs do
  // not become a record of who is recording what.
  console.info(
    `[transcription-sweep] examined=${result.examined} advanced=${result.advanced}` +
      ` autoImportDue=${autoImport.examined} imported=${autoImport.imported} gaveUp=${autoImport.gaveUp}` +
      ` filingDue=${filing.examined} filed=${filing.filed}`,
  );

  return NextResponse.json({ ok: true, ...result });
}
