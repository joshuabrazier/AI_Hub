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

  // Delivery. A client and a project are the delivery module's own
  // long-lived records, and retiring or archiving one is a soft delete that
  // hides work rather than removing it - so what happened has to be
  // findable afterwards.
  CLIENT_CREATED: "client.created",
  CLIENT_UPDATED: "client.updated",
  CLIENT_STATUS_CHANGED: "client.status_changed",
  PROJECT_CREATED: "project.created",
  PROJECT_UPDATED: "project.updated",
  PROJECT_STATUS_CHANGED: "project.status_changed",

  // Project membership. `project_members` is the security boundary of the
  // delivery module and `is_lead` is its second gate, so adding somebody,
  // changing their lead flag and removing them are all AUTHORIZATION
  // changes - recorded as carefully as a team role change, and for the same
  // reason. The rate band rides along on the same events because it is what
  // a client is charged for that person's hours.
  //
  // Phases and budget groups deliberately have no actions here: neither
  // decides who may see anything, and an entry per drag of a board heading
  // would bury the events above.
  PROJECT_MEMBER_ADDED: "project.member_added",
  PROJECT_MEMBER_CHANGED: "project.member_changed",
  PROJECT_MEMBER_REMOVED: "project.member_removed",

  // Rates, and these two are recorded for a different reason from the six
  // above. A charge rate is what a client is billed and a cost rate is a pay
  // proxy, so a change to either is a commercial act by one admin about
  // another person - the same "name both parties" argument as
  // ai_chat.request_viewed, and why `subjectUserId` is always set on them.
  //
  // A DELETE matters more than a set, and is the reason this pair exists at
  // all. `user_rates` is effective-dated and a rate resolves to the latest
  // start on or before the work date, never a later one - so removing the
  // EARLIEST row of a band leaves work dates with no rate at all, and an
  // entry backdated into that window afterwards comes back unvalued with
  // nothing on any screen to say the rate it needed was deleted. The log
  // entry is the only lasting record of who opened that window.
  //
  // The CENTS are recorded in `changes`, because these rows are already
  // admin-only reading and the figure is the whole substance of the event.
  USER_RATE_SET: "user_rate.set",
  USER_RATE_DELETED: "user_rate.deleted",

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
  CLIENT: "client",
  PROJECT: "project",
  PROJECT_MEMBER: "project_member",
  USER_RATE: "user_rate",
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
