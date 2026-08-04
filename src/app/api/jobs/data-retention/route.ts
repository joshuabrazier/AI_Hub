import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { deidentifyInactiveUsersService } from "@/features/admin-retention/admin-retention.service";
import { purgeExpiredAuditLogsService } from "@/lib/audit/audit-log.service";
import { envServer } from "@/lib/env-server";

// The de-identification job talks to the DB and node crypto, so it must run on
// the Node runtime, and must never be statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Constant-time bearer-token check so a wrong secret can't be timed out.
function bearerMatches(header: string | null, secret: string): boolean {
  const prefix = "Bearer ";
  if (!header || !header.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

// -------------------------------------------------------------------
// POST /api/jobs/data-retention
//
// Trigger for the monthly data-retention job. This bearer secret
// (RETENTION_JOB_SECRET) is the ONLY authentication here - there is no session
// behind a scheduler, so the usual role guards do not apply and must not be
// added. It runs two tasks:
//   - purges audit logs older than AUDIT_LOG_RETENTION_DAYS (routine rotation),
//   - de-identifies dormant accounts, but only when RETENTION_JOB_ENABLED is
//     "true"; otherwise that part runs as a preview and changes nothing.
//
// dryRun is computed from the master switch here AND re-checked inside the
// service, so neither one alone decides whether data is destroyed.
// See docs/security.md.
// -------------------------------------------------------------------
export async function POST(request: Request): Promise<Response> {
  const secret = envServer.RETENTION_JOB_SECRET;

  // No secret configured => the endpoint is intentionally inert.
  if (!secret) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Routine log rotation. Runs regardless of the de-identification switch.
  const auditLogs = await purgeExpiredAuditLogsService();

  // De-identification. Master switch: preview unless explicitly enabled.
  const dryRun = !envServer.RETENTION_JOB_ENABLED;
  const deidentify = await deidentifyInactiveUsersService({ dryRun });

  // Counts only - no names, emails or ids - so the run is observable in the
  // logs without the log itself becoming a copy of what was just removed.
  console.info(
    `[data-retention] auditLogsPurged=${auditLogs.purged} (>${auditLogs.retentionDays}d) ` +
      `dryRun=${deidentify.dryRun} candidates=${deidentify.candidateCount} processed=${deidentify.processedCount}`,
  );

  // The response mirrors that: the scheduler gets counts, not the id list.
  return NextResponse.json({
    ok: true,
    auditLogs,
    deidentify: {
      dryRun: deidentify.dryRun,
      jobEnabled: deidentify.jobEnabled,
      candidateCount: deidentify.candidateCount,
      processedCount: deidentify.processedCount,
    },
  });
}
