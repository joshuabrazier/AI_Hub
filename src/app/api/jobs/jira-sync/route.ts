import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { syncJiraWorklogsService } from "@/features/timesheet-sync/timesheet-sync.service";
import { envServer } from "@/lib/env-server";

// Talks to Postgres and to Jira over the network, so it must run on the Node
// runtime and must never be statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Constant-time bearer check, so a wrong secret cannot be discovered by
// timing the response.
function bearerMatches(header: string | null, secret: string): boolean {
  const prefix = "Bearer ";
  if (!header || !header.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

// -------------------------------------------------------------------
// POST /api/jobs/jira-sync
//
// The trigger for the incremental worklog sync, called on a timer (a Logic
// App or an Azure Function - the same shape as the existing one-minute email
// queue timer).
//
// JIRA_SYNC_SECRET is the ONLY authentication here. There is no session
// behind a scheduler, so the usual role guards do not apply and must not be
// added; the endpoint is inert until the secret is set.
//
// While JIRA_SYNC_ENABLED is not "true" the job reads Jira and reports what
// it WOULD write, changing nothing. Deploying therefore never starts
// rewriting the read model on its own.
//
// Safe to call repeatedly: every write is an upsert keyed on Jira's worklog
// id, and the watermark only advances behind writes that committed. If two
// runs overlap, the second re-reads the first's window and lands on the same
// rows.
// -------------------------------------------------------------------
export async function POST(request: Request): Promise<Response> {
  const secret = envServer.JIRA_SYNC_SECRET;

  // No secret configured => the endpoint is intentionally inert.
  if (!secret) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await syncJiraWorklogsService();

  // Counts and a window, never the worklogs themselves - the scheduler's logs
  // should not become a second copy of the timesheet.
  console.info(
    `[timesheet-sync] ok=${result.ok} dryRun=${result.dryRun} since=${result.since} ` +
      `seen=${result.worklogIdsSeen} written=${result.worklogsWritten} deleted=${result.worklogsDeleted} ` +
      `issues=${result.issuesWritten}${result.error ? ` error=${result.error}` : ""}`,
  );

  // A failed sync answers 500 so the scheduler's own alerting sees it, rather
  // than a 200 with ok:false that every monitor would read as healthy.
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
