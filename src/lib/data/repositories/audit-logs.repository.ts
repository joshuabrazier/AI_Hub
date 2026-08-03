import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { AuditLog } from "@/lib/data/kysely-database-types";
import { handleError } from "@/lib/handle-errors";

// A ready-to-store audit row. `changes`/`metadata` are plain objects here and
// serialised to JSONB on insert.
//
// actorRole/actorName are snapshots rather than a join: the trail has to stay
// readable after the actor is renamed, deactivated or deleted.
//
// teamId and subjectUserId are soft references with no foreign key, so removing
// a team or a person never cascades their history away.
export type AuditLogInsert = {
  id: string;
  actorUserId: string | null;
  actorRole: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  teamId: string | null;
  subjectUserId: string | null;
  summary: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
};

// -------------------------------------------------------------------
// Append one audit row.
//
// This is the only write path onto audit_logs, and there is deliberately no
// update counterpart anywhere in this file: an append-only trail is what makes
// it tamper-evident, so a row is never edited after the fact.
//
// The default client is the pool, not a caller's transaction, because audit
// writes are best-effort and happen after the change they describe has
// committed. Pass `db` only when the row genuinely should live or die with the
// surrounding transaction - a rollback then takes the audit row with it.
// -------------------------------------------------------------------
export async function insertAuditLogRepo(entry: AuditLogInsert, db: DBClient = database): Promise<void> {
  try {
    await db
      .insertInto("auditLogs")
      .values({
        id: entry.id,
        actorUserId: entry.actorUserId,
        actorRole: entry.actorRole,
        actorName: entry.actorName,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        teamId: entry.teamId,
        subjectUserId: entry.subjectUserId,
        summary: entry.summary,
        changes: entry.changes ? JSON.stringify(entry.changes) : null,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
        createdAt: entry.createdAt,
      })
      .execute();
  } catch (error) {
    throw handleError("insertAuditLogRepo", error);
  }
}

// -------------------------------------------------------------------
// Delete audit rows created before `cutoff` (log rotation). Returns how many
// rows were removed. This is the one permitted delete against the audit trail -
// routine retention by age only. It takes an instant, never a subject or an
// action, so no caller can use it to remove selected history.
// -------------------------------------------------------------------
export async function deleteAuditLogsOlderThanRepo(cutoff: Date, db: DBClient = database): Promise<number> {
  try {
    const result = await db.deleteFrom("auditLogs").where("createdAt", "<", cutoff).executeTakeFirst();

    return Number(result?.numDeletedRows ?? 0);
  } catch (error) {
    throw handleError("deleteAuditLogsOlderThanRepo", error);
  }
}

// Filters for reading the trail back in the admin activity viewer. Each one is
// backed by an index on audit_logs; entityId is only selective alongside
// entityType, which shares its composite index.
export type AuditLogFilter = {
  // Team scope is a LIST, because team membership is many-to-many: a manager
  // can manage several teams at once. A scalar here would force a caller to
  // pick one of them and would silently show the wrong slice of history.
  // An empty array means "no teams" and matches nothing.
  teamIds?: string[];
  // Scalar, unlike teamIds: the subject is one person, resolved from the
  // session when a user reads their own trail.
  subjectUserId?: string;
  actorUserId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  limit?: number;
  offset?: number;
};

// -------------------------------------------------------------------
// Read the audit trail, newest first, optionally scoped to a team, subject,
// actor, action or entity.
//
// Ordering falls back to id so paging is stable: rows written in the same
// millisecond would otherwise come back in an arbitrary order and could repeat
// or vanish between one offset and the next.
// -------------------------------------------------------------------
export async function getAuditLogsRepo(filter: AuditLogFilter = {}): Promise<AuditLog[]> {
  try {
    // Fail closed. A caller scoped to no teams sees nothing, rather than
    // dropping the filter and reading every team's history.
    if (filter.teamIds && filter.teamIds.length === 0) return [];

    let query = database.selectFrom("auditLogs").selectAll();

    // Presence, not truthiness. A truthiness guard makes an empty string DROP
    // the filter and return the unscoped trail, which is fail-open and the
    // opposite of the teamIds handling above. An empty string is a supplied
    // value that matches nothing, so it must narrow to nothing.
    if (filter.teamIds !== undefined) query = query.where("teamId", "in", filter.teamIds);
    if (filter.subjectUserId !== undefined) query = query.where("subjectUserId", "=", filter.subjectUserId);
    if (filter.actorUserId !== undefined) query = query.where("actorUserId", "=", filter.actorUserId);
    if (filter.action !== undefined) query = query.where("action", "=", filter.action);
    if (filter.entityType !== undefined) query = query.where("entityType", "=", filter.entityType);
    if (filter.entityId !== undefined) query = query.where("entityId", "=", filter.entityId);

    return await query
      .orderBy("createdAt", "desc")
      .orderBy("id", "desc")
      .limit(filter.limit ?? 100)
      .offset(filter.offset ?? 0)
      .execute();
  } catch (error) {
    throw handleError("getAuditLogsRepo", error);
  }
}
