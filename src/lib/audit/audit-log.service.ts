import "server-only";

import { headers } from "next/headers";
import { generateId } from "better-auth";

import { getSession } from "@/lib/auth/session-auth-server";
import {
  deleteAuditLogsOlderThanRepo,
  insertAuditLogRepo,
} from "@/lib/data/repositories/audit-logs.repository";
import { envServer } from "@/lib/env-server";
import { AuditActor, RecordAuditEventInput } from "./audit-log.types";

// Best-effort IP / user-agent from the current request. Returns nulls (never
// throws) if called outside a request scope.
async function resolveRequestMetadata(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const requestHeaders = await headers();
    return {
      ipAddress: requestHeaders.get("x-forwarded-for"),
      userAgent: requestHeaders.get("user-agent"),
    };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

// The signed-in user, or an empty actor if there's no session.
async function resolveActor(): Promise<AuditActor> {
  try {
    const session = await getSession();
    if (!session) return { id: null, role: null, name: null };
    const user = session.user as { id: string; role?: string | null; name?: string | null };
    return { id: user.id, role: user.role ?? null, name: user.name ?? null };
  } catch {
    return { id: null, role: null, name: null };
  }
}

// -------------------------------------------------------------------
// Record one audit event for an in-app mutation. The actor is taken from the
// current session and IP/user-agent from the request, unless overridden.
//
// Best-effort by design: any failure (including the table not existing yet) is
// logged and swallowed so audit logging can never break the operation being
// audited. Call it after the mutation has succeeded.
// -------------------------------------------------------------------
export async function recordAuditEvent(input: RecordAuditEventInput): Promise<void> {
  try {
    const actor = input.actor ?? (await resolveActor());
    const requestMetadata = await resolveRequestMetadata();

    await insertAuditLogRepo({
      id: generateId(),
      actorUserId: actor.id,
      actorRole: actor.role,
      actorName: actor.name,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      teamId: input.teamId ?? null,
      subjectUserId: input.subjectUserId ?? null,
      summary: input.summary ?? null,
      changes: input.changes ?? null,
      metadata: { ...requestMetadata, ...(input.metadata ?? {}) },
      createdAt: new Date(),
    });
  } catch (error) {
    console.error("[recordAuditEvent] failed to record audit event", input.action, error);
  }
}

export type AuditLogPurgeResult = {
  // The window applied (days). 0 means purging is disabled.
  retentionDays: number;
  // How many rows were deleted (0 when disabled).
  purged: number;
};

// -------------------------------------------------------------------
// Delete audit rows older than AUDIT_LOG_RETENTION_DAYS (routine log rotation,
// run from the monthly job). When the setting is 0 this is a no-op and the trail
// is kept indefinitely. The cutoff is an instant comparison, so UTC is correct.
// -------------------------------------------------------------------
export async function purgeExpiredAuditLogsService(): Promise<AuditLogPurgeResult> {
  const retentionDays = envServer.AUDIT_LOG_RETENTION_DAYS;

  if (retentionDays <= 0) {
    return { retentionDays: 0, purged: 0 };
  }

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const purged = await deleteAuditLogsOlderThanRepo(cutoff);

  return { retentionDays, purged };
}
