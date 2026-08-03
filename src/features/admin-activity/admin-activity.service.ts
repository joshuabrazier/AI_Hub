import "server-only";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES, USER_ROLE_LABELS, UserRole } from "@/lib/data/kysely-database-types";
import { getAuditLogsRepo } from "@/lib/data/repositories/audit-logs.repository";
import { getAllTeamsRepo } from "@/lib/data/repositories/teams.repository";
import { getUsersByIdsRepo } from "@/lib/data/repositories/users.repository";
import { formatDateTime } from "@/lib/format";
import { handleError } from "@/lib/handle-errors";

import { AuditFieldChange, AuditLogEntryDTO, auditActionMeta } from "./admin-activity.types";

// How many recent events the viewer loads. The trail only grows, so the screen
// shows the most recent window and the filter/search work on it client-side.
const AUDIT_VIEW_LIMIT = 500;

function roleLabel(role: string | null): string {
  if (!role) return "";
  return USER_ROLE_LABELS[role as UserRole] ?? role;
}

// Read the plain field before/after list off the stored `changes` blob.
//
// Every field is re-checked rather than trusted: `changes` is JSONB written by
// whatever recorded the event, possibly under an older shape, so a row with an
// unexpected structure has to render as empty instead of throwing and taking
// the whole viewer down with it.
function decodeFieldChanges(changes: Record<string, unknown> | null): AuditFieldChange[] {
  const fields = changes?.fields;
  if (!Array.isArray(fields)) return [];

  return fields.map((entry) => {
    const record = entry as { label?: unknown; from?: unknown; to?: unknown };
    return {
      label: typeof record.label === "string" ? record.label : "",
      from: typeof record.from === "string" ? record.from : "",
      to: typeof record.to === "string" ? record.to : "",
    };
  });
}

// -------------------------------------------------------------------
// Admin Activity: the most recent audit events, resolved to display-ready
// rows (actor, action label + category, team, subject, formatted time).
//
// Admin only, and unscoped by design - this is the whole trail, including
// events for teams the reader is not a member of, which is the point of an
// audit viewer. There is deliberately no manager-facing version: a
// team-filtered trail is a different feature, and it would have to pass
// scope.teamIds to getAuditLogsRepo rather than reusing this.
// -------------------------------------------------------------------
export async function getAuditLogService(): Promise<AuditLogEntryDTO[]> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const logs = await getAuditLogsRepo({ limit: AUDIT_VIEW_LIMIT });

    // Resolve the soft references in two batched lookups rather than one per
    // row. Both can miss: team_id and subject_user_id have no foreign key, so
    // history outlives the team or person it names.
    const subjectUserIds = Array.from(
      new Set(logs.map((log) => log.subjectUserId).filter((id): id is string => id !== null)),
    );

    const [teams, subjectUsers] = await Promise.all([getAllTeamsRepo(), getUsersByIdsRepo(subjectUserIds)]);

    const teamNameById = new Map(teams.map((team) => [team.id, team.name]));
    const userNameById = new Map(subjectUsers.map((user) => [user.id, user.name]));

    return logs.map((log) => {
      const meta = auditActionMeta(log.action);
      const fieldChanges = decodeFieldChanges(log.changes);
      const metadata = (log.metadata ?? {}) as { ipAddress?: unknown; userAgent?: unknown };
      const ipAddress = typeof metadata.ipAddress === "string" ? metadata.ipAddress : "";
      const userAgent = typeof metadata.userAgent === "string" ? metadata.userAgent : "";

      return {
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        createdAtLabel: formatDateTime(log.createdAt),
        // A null actor is a system action (the retention job, a scheduled
        // task), not a missing one.
        actorName: log.actorName ?? "System",
        actorRole: roleLabel(log.actorRole),
        action: log.action,
        actionLabel: meta.label,
        category: meta.category,
        summary: log.summary ?? "",
        teamId: log.teamId ?? "",
        teamName: log.teamId ? (teamNameById.get(log.teamId) ?? "(removed team)") : "",
        subjectUserId: log.subjectUserId ?? "",
        subjectUserName: log.subjectUserId ? (userNameById.get(log.subjectUserId) ?? "(removed user)") : "",
        entityType: log.entityType,
        fieldChanges,
        ipAddress,
        userAgent,
        // The dialog also shows request metadata, so a row with only an IP is
        // still worth opening.
        hasDetails: fieldChanges.length > 0 || ipAddress !== "" || userAgent !== "",
      } satisfies AuditLogEntryDTO;
    });
  } catch (error) {
    throw handleError("getAuditLogService", error);
  }
}
