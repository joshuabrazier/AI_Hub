import { NextResponse } from "next/server";

import { sweepTranscriptionsService } from "@/features/transcription/transcription.service";
import { getVerifiedApiSession } from "@/lib/auth/session-auth-server";
import { MESSAGES } from "@/lib/constants";

// Talks to the Speech service, blob storage and Bedrock, so Node; and its
// answer is about this second, so it must never be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// -------------------------------------------------------------------
// POST /api/transcription/sweep
//
// Carries this user's unfinished transcriptions forward.
//
// A THIRD EXCEPTION TO "MUTATIONS GO THROUGH SERVER ACTIONS", and the
// reason is specific to how long this one takes.
//
// Server actions are executed by the router ONE AT A TIME. That is normally
// invisible, because an action is a database write measured in
// milliseconds. This one is not: the sweep that finds a finished transcript
// goes on to summarise it, which is tens of seconds of model call. As a
// server action, polled every six seconds, it would hold the queue - and
// every rename, delete and retry the person tried in the meantime would sit
// behind it doing nothing. The screen would look frozen, which is exactly
// what a slow background job must never make the foreground look like.
//
// A route handler is ordinary HTTP and shares no queue with anything, so a
// sweep taking a minute costs a late update and nothing else.
//
// The other two exceptions are in AI chat and are there for different
// reasons (streaming, and the action body limit). Do not read this as
// licence to move ordinary mutations out of actions - the test is whether
// the call can run long enough to block the interface, and almost nothing
// else in this app can.
//
// CSRF: this is authenticated by the session cookie like everything else,
// and it is deliberately harmless to trigger - it advances the caller's own
// jobs and nothing else, so there is no state an attacker gains by causing
// one. It takes no input at all, which is what keeps that true.
//
// AUTHORIZATION is the service's. It resolves the acting user from the
// session itself and scopes every query to them; the check here is the
// outer gate only.
// -------------------------------------------------------------------
export async function POST(): Promise<Response> {
  const session = await getVerifiedApiSession();

  if (!session) {
    return NextResponse.json({ error: MESSAGES.UNAUTHORIZED }, { status: 401 });
  }

  const result = await sweepTranscriptionsService();

  // `changed` tells the browser whether it is worth re-rendering. Without
  // it the page would rebuild every six seconds for the whole length of a
  // transcription, for no visible difference.
  return NextResponse.json(result);
}
