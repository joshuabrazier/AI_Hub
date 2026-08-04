// -------------------------------------------------------------------
// Audit log vocabulary. Actions are namespaced dotted strings; entity types
// are the kind of record an action touched. Kept as literals so the recorder
// and the viewer share one source of truth.
//
// These values are PERSISTED as plain strings in audit_logs.action and
// .entity_type, and both columns are indexed. Renaming one does not migrate
// the rows already written: existing history simply stops matching the
// viewer's filters, with no error. Treat every value here as append-only -
// add new ones freely, but change an existing string only alongside a
// deliberate backfill.
// -------------------------------------------------------------------
export const AUDIT_ACTIONS = {
  // Users
  USER_CREATED: "user.created",
  USER_UPDATED: "user.updated",
  USER_STATUS_CHANGED: "user.status_changed",
  USER_ROLE_CHANGED: "user.role_changed",
  USER_INVITED: "user.invited",
  USER_INVITATION_CANCELLED: "user.invitation_cancelled",
  // Data retention: a person's data was de-identified (irreversible).
  USER_DEIDENTIFIED: "user.deidentified",

  // Teams and membership. Membership is an authorization change, so it is
  // recorded as carefully as a role change.
  TEAM_CREATED: "team.created",
  TEAM_UPDATED: "team.updated",
  TEAM_STATUS_CHANGED: "team.status_changed",
  TEAM_MEMBER_ADDED: "team.member_added",
  TEAM_MEMBER_ROLE_CHANGED: "team.member_role_changed",
  TEAM_MEMBER_REMOVED: "team.member_removed",

  // Documents
  DOCUMENT_SIGNED: "document.signed",

  // Authentication
  AUTH_SIGNED_IN: "auth.signed_in",
  AUTH_SIGNED_OUT: "auth.signed_out",
  AUTH_SIGN_IN_FAILED: "auth.sign_in_failed",
  AUTH_PASSWORD_CHANGED: "auth.password_changed",
  AUTH_IMPERSONATION_STARTED: "auth.impersonation_started",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_ENTITY_TYPES = {
  USER: "user",
  TEAM: "team",
  TEAM_MEMBER: "team_member",
  DOCUMENT: "document",
  AUTH: "auth",
} as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[keyof typeof AUDIT_ENTITY_TYPES];

// The acting user, when known - snapshotted onto the log row so the trail
// survives a later rename or deletion.
export type AuditActor = { id: string | null; role: string | null; name: string | null };

// What a caller supplies to record an event. The actor and request metadata
// (IP / user-agent) are resolved automatically from the session and request
// when not supplied.
export type RecordAuditEventInput = {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  // Scope references, both soft (no foreign key) so history outlives its
  // subject. teamId is the team the event belongs to, when it belongs to one;
  // subjectUserId is the person it was done TO, as distinct from the actor who
  // did it.
  teamId?: string | null;
  subjectUserId?: string | null;
  summary?: string | null;
  // Structured detail. For encrypted or otherwise sensitive fields, record only
  // WHICH field changed (e.g. { fields: ["phoneNumber"] }), never the value.
  changes?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  // Override the resolved actor (used by callers with no app session).
  actor?: AuditActor;
};
