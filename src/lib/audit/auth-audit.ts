import "server-only";

import { generateId } from "better-auth";

import { insertAuditLogRepo } from "@/lib/data/repositories/audit-logs.repository";
import { AUDIT_ENTITY_TYPES, AuditAction, AuditActor } from "./audit-log.types";

// -------------------------------------------------------------------
// Record an authentication audit event from inside the better-auth hooks,
// where there is no app session to resolve. The actor and request metadata
// (IP / user-agent from the auth context) are passed explicitly.
//
// Deliberately imports only the repository (not the session helpers) so it can
// be used from auth.ts without an import cycle. Best-effort: never throws into
// the auth flow.
// -------------------------------------------------------------------
export async function recordAuthAuditEvent(input: {
  action: AuditAction;
  actor: AuditActor;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await insertAuditLogRepo({
      id: generateId(),
      actorUserId: input.actor.id,
      actorRole: input.actor.role,
      actorName: input.actor.name,
      action: input.action,
      entityType: AUDIT_ENTITY_TYPES.AUTH,
      entityId: input.actor.id,
      teamId: null,
      // An auth event is done BY the actor to their own account, so the actor
      // is also the subject - stamped here so "everything that happened to this
      // person" includes their sign-ins without a special case in the viewer.
      subjectUserId: input.actor.id,
      summary: input.summary ?? null,
      changes: null,
      metadata: input.metadata ?? null,
      createdAt: new Date(),
    });
  } catch (error) {
    console.error("[recordAuthAuditEvent] failed to record auth event", input.action, error);
  }
}
