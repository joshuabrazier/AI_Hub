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

  // AI chat. Reading somebody's request payload means reading their private
  // conversation, so the act is recorded with both parties named.
  AI_CHAT_REQUEST_VIEWED: "ai_chat.request_viewed",

  // Authentication
  AUTH_SIGNED_IN: "auth.signed_in",
  AUTH_SIGNED_OUT: "auth.signed_out",
  AUTH_SIGN_IN_FAILED: "auth.sign_in_failed",
  AUTH_PASSWORD_CHANGED: "auth.password_changed",
  // App-level two-factor enrolment. A change to how an account is secured,
  // so it is recorded like a role change. Routine per-session verifications
  // are deliberately NOT logged - one per person per sign-in would bury the
  // events worth reading, and the sign-in itself is already audited.
  AUTH_TWO_FACTOR_ENABLED: "auth.two_factor_enabled",
  // An admin clearing somebody else's second factor. Recorded like a role
  // change and naming BOTH parties, because it is the one way a person's
  // second factor is removed without them proving anything - the same
  // accountability argument as ai_chat.request_viewed.
  AUTH_TWO_FACTOR_RESET: "auth.two_factor_reset",
  AUTH_IMPERSONATION_STARTED: "auth.impersonation_started",

  // SharePoint inventory.
  //
  // These record WHOSE ACCESS a library is being read with, which is the
  // only access-control question the feature has. A crawl runs on one
  // person's delegated token and can therefore see exactly what that
  // person can see - so "who nominated this" and "whose token walked it"
  // are the two facts that make the inventory accountable. Without them
  // the answer to "why does this list contain the HR folder" would have to
  // be reconstructed from nothing.
  SHAREPOINT_LIBRARY_NOMINATED: "sharepoint.library_nominated",
  SHAREPOINT_LIBRARY_REMOVED: "sharepoint.library_removed",
  SHAREPOINT_CRAWL_STARTED: "sharepoint.crawl_started",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_ENTITY_TYPES = {
  USER: "user",
  TEAM: "team",
  TEAM_MEMBER: "team_member",
  AI_CHAT_REQUEST: "ai_chat_request",
  AUTH: "auth",
  SHAREPOINT_DRIVE: "sharepoint_drive",
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
