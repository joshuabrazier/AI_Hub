import { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

// -------------------------------------------------------------------
// Enum Types
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// User Roles (platform-wide)
//  admin   - full access to everything
//  manager - internal staff, scoped to the teams they are assigned to
//  member  - end user; sees their own portal only
//
// Roles are server-assigned: `role` is input:false in Better Auth, so it can
// never be set from a client request. See src/lib/auth/auth.ts.
// -------------------------------------------------------------------
export const USER_ROLES = {
  ADMIN: "admin",
  MANAGER: "manager",
  MEMBER: "member",
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  [USER_ROLES.ADMIN]: "Admin",
  [USER_ROLES.MANAGER]: "Manager",
  [USER_ROLES.MEMBER]: "Member",
};

// The internal roles - everyone who works in the product rather than using it
// as an end user. Admins reach /admin, managers reach /manage.
export const STAFF_ROLES = [USER_ROLES.ADMIN, USER_ROLES.MANAGER] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_OPTIONS = STAFF_ROLES.map((role) => ({
  value: role,
  label: USER_ROLE_LABELS[role],
}));

export const USER_ROLE_OPTIONS = Object.values(USER_ROLES).map((role) => ({
  value: role,
  label: USER_ROLE_LABELS[role],
}));

// -------------------------------------------------------------------
// Team Roles (a user's role WITHIN one team)
//
// Distinct from the platform role above: the platform role decides which area
// a user can reach, the team role decides what they can do inside a team they
// belong to. An admin assigns a manager to a team by creating a team_members
// row with team_role = 'manager'.
// -------------------------------------------------------------------
export const TEAM_ROLES = {
  MANAGER: "manager",
  MEMBER: "member",
} as const;

export type TeamRole = (typeof TEAM_ROLES)[keyof typeof TEAM_ROLES];

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  [TEAM_ROLES.MANAGER]: "Manager",
  [TEAM_ROLES.MEMBER]: "Member",
};

export const TEAM_ROLE_OPTIONS = Object.values(TEAM_ROLES).map((role) => ({
  value: role,
  label: TEAM_ROLE_LABELS[role],
}));

// -------------------------------------------------------------------
// Invitation Status
// -------------------------------------------------------------------
export const INVITATION_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
  EXPIRED: "expired",
  REVOKED: "revoked",
} as const;

export type InvitationStatus = (typeof INVITATION_STATUS)[keyof typeof INVITATION_STATUS];

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  [INVITATION_STATUS.PENDING]: "Pending",
  [INVITATION_STATUS.COMPLETED]: "Completed",
  [INVITATION_STATUS.EXPIRED]: "Expired",
  [INVITATION_STATUS.REVOKED]: "Revoked",
};

// -------------------------------------------------------------------
// Session Status (one dated occurrence of a class)
// -------------------------------------------------------------------
export const SESSION_STATUS = {
  SCHEDULED: "scheduled",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;

export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  [SESSION_STATUS.SCHEDULED]: "Scheduled",
  [SESSION_STATUS.COMPLETED]: "Completed",
  [SESSION_STATUS.CANCELLED]: "Cancelled",
};

// -------------------------------------------------------------------
// Attendance Status
// A member's status for one session (session_attendees.attendance_status).
// 'booked' is written when they join a class; staff set the rest per session.
//
// CANCELLED is load-bearing: it is what frees a place. Capacity counts and
// rosters exclude it everywhere, and the row is kept rather than deleted so
// the change stays on the record.
// -------------------------------------------------------------------
export const ATTENDANCE_STATUS = {
  BOOKED: "booked",
  ATTENDED: "attended",
  ABSENT: "absent",
  CANCELLED: "cancelled",
} as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUS)[keyof typeof ATTENDANCE_STATUS];

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  [ATTENDANCE_STATUS.BOOKED]: "Booked",
  [ATTENDANCE_STATUS.ATTENDED]: "Attended",
  [ATTENDANCE_STATUS.ABSENT]: "Absent",
  [ATTENDANCE_STATUS.CANCELLED]: "Cancelled",
};

// Statuses that occupy a place in a session. Anything not listed here has
// freed its place. Use this rather than re-listing statuses at each call site.
export const PLACE_TAKING_ATTENDANCE_STATUSES = [
  ATTENDANCE_STATUS.BOOKED,
  ATTENDANCE_STATUS.ATTENDED,
  ATTENDANCE_STATUS.ABSENT,
] as const;

// -------------------------------------------------------------------
// Days of the week (each class stores its own per-day schedule; these back
// the day picker and label lookups)
// -------------------------------------------------------------------
export const DAYS_OF_WEEK = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number]["value"];

export const DAY_OF_WEEK_LABELS: Record<DayOfWeek, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

// -------------------------------------------------------------------
// Notification audience
// Who a staff member can address a broadcast to. Managers are restricted to
// teams they manage - that is enforced in the service, not here.
// -------------------------------------------------------------------
export const NOTIFICATION_AUDIENCE_TYPES = {
  EVERYONE: "everyone",
  TEAMS: "teams",
  USERS: "users",
  CLASSES: "classes",
} as const;

export type NotificationAudienceType =
  (typeof NOTIFICATION_AUDIENCE_TYPES)[keyof typeof NOTIFICATION_AUDIENCE_TYPES];

export const NOTIFICATION_AUDIENCE_LABELS: Record<NotificationAudienceType, string> = {
  [NOTIFICATION_AUDIENCE_TYPES.EVERYONE]: "Everyone",
  [NOTIFICATION_AUDIENCE_TYPES.TEAMS]: "Specific teams",
  [NOTIFICATION_AUDIENCE_TYPES.USERS]: "Specific people",
  [NOTIFICATION_AUDIENCE_TYPES.CLASSES]: "Specific classes",
};

// Fallback notification categories, used only when the admin-managed
// notification_types table is empty (a fresh database).
export const DEFAULT_NOTIFICATION_TYPE_KEYS = {
  GENERAL: "general",
  SCHEDULE: "schedule",
  ACCOUNT: "account",
} as const;

// -------------------------------------------------------------------
// Site Content
// Admin-editable content for the public site. One row per key.
//
// Values are either sanitised rich-text HTML or a JSON string, depending on
// the key - see SITE_CONTENT_SHAPES below. The landing_* keys are what make
// the home page editable from the admin area rather than from code.
// -------------------------------------------------------------------
export const SITE_CONTENT_KEYS = {
  ABOUT: "about",
  CONTACT: "contact",
  PRIVACY_POLICY: "privacy_policy",
  TERMS_AND_CONDITIONS: "terms_and_conditions",
  // Not a public page - the wording signed as the media consent document.
  MEDIA_CONSENT: "media_consent",
  // Home page blocks, each stored as JSON.
  LANDING_HERO: "landing_hero",
  LANDING_HIGHLIGHTS: "landing_highlights",
  LANDING_FEATURES: "landing_features",
  LANDING_CTA: "landing_cta",
} as const;

export type SiteContentKey = (typeof SITE_CONTENT_KEYS)[keyof typeof SITE_CONTENT_KEYS];

// Whether a key holds rich-text HTML or a JSON document. The admin editor
// picks its form from this, and the reader validates JSON keys with Zod
// before use - a malformed value must never reach the page.
export const SITE_CONTENT_SHAPES = {
  [SITE_CONTENT_KEYS.ABOUT]: "html",
  [SITE_CONTENT_KEYS.CONTACT]: "json",
  [SITE_CONTENT_KEYS.PRIVACY_POLICY]: "html",
  [SITE_CONTENT_KEYS.TERMS_AND_CONDITIONS]: "html",
  [SITE_CONTENT_KEYS.MEDIA_CONSENT]: "html",
  [SITE_CONTENT_KEYS.LANDING_HERO]: "json",
  [SITE_CONTENT_KEYS.LANDING_HIGHLIGHTS]: "json",
  [SITE_CONTENT_KEYS.LANDING_FEATURES]: "json",
  [SITE_CONTENT_KEYS.LANDING_CTA]: "json",
} as const satisfies Record<SiteContentKey, "html" | "json">;

// -------------------------------------------------------------------
// Tables
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Users Table
// The centre of the model: every person is a user. Better Auth owns the
// authentication columns; the app adds role, is_active and a small profile
// block. There is no separate "client"/"member profile" table.
// -------------------------------------------------------------------
export interface Users {
  id: string;
  name: string;
  // Optional short name the person chose to be greeted by (personalisation only).
  preferredName: string | null;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: UserRole;
  isActive: boolean;
  // better-auth admin plugin - the ban feature is unused (no UI); these stay NULL/false.
  banned: Generated<boolean>;
  banReason: string | null;
  banExpires: Date | null;
  // better-auth two-factor plugin: true once a TOTP setup has been verified.
  twoFactorEnabled: Generated<boolean>;
  phoneNumber: string | null;
  // Per-notification-type email preferences, keyed by the type's key. An absent
  // key means enabled (opt-out). Selected as an object, inserted as JSON text.
  notificationPreferences: ColumnType<Record<string, boolean>, string, string>;
  // Data retention: set once this person's data has been de-identified
  // (irreversible). NULL = still identifiable.
  deidentifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type User = Selectable<Users>;
export type NewUser = Insertable<Users>;
export type UpdateUser = Updateable<Users>;

// -------------------------------------------------------------------
// Sessions Table (better-auth) - LOGIN sessions.
// The dated occurrences of a class are class_sessions, not this.
// -------------------------------------------------------------------
export interface Sessions {
  id: string;
  expiresAt: Date;
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  userId: string;
  // Set to the admin's user id when this session was created by impersonation;
  // NULL for ordinary sign-ins.
  impersonatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type Session = Selectable<Sessions>;
export type NewSession = Insertable<Sessions>;
export type UpdateSession = Updateable<Sessions>;

// -------------------------------------------------------------------
// Accounts Table (better-auth)
// -------------------------------------------------------------------
export interface Accounts {
  id: string;
  accountId: string;
  providerId: string;
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scope: string | null;
  password: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type Account = Selectable<Accounts>;
export type NewAccount = Insertable<Accounts>;
export type UpdateAccount = Updateable<Accounts>;

// -------------------------------------------------------------------
// Verifications Table (better-auth)
// -------------------------------------------------------------------
export interface Verifications {
  id: string;
  identifier: string;
  value: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type Verification = Selectable<Verifications>;
export type NewVerification = Insertable<Verifications>;
export type UpdateVerification = Updateable<Verifications>;

// -------------------------------------------------------------------
// Two Factor Table (better-auth two-factor plugin)
// `secret` and `backupCodes` are encrypted by better-auth with
// BETTER_AUTH_SECRET - never rotate it, or existing 2FA setups break.
// Managed entirely by the plugin; the app never writes here.
// -------------------------------------------------------------------
export interface TwoFactor {
  id: string;
  userId: string;
  secret: string;
  backupCodes: string;
  verified: Generated<boolean>;
  failedVerificationCount: Generated<number>;
  lockedUntil: Date | null;
}

// -------------------------------------------------------------------
// Teams Table
// An explicitly created, named grouping of users. Nothing creates a team
// implicitly - an admin makes one and then adds people to it.
// -------------------------------------------------------------------
export interface Teams {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type Team = Selectable<Teams>;
export type NewTeam = Insertable<Teams>;
export type UpdateTeam = Updateable<Teams>;

// -------------------------------------------------------------------
// Team Members Table
// Many-to-many and optional in both directions: a user can be in no team, one
// team, or several, and a team can be empty.
//
// This table IS the app's security boundary. A user's team set is always
// resolved from the SESSION user id, never from a URL parameter, and any
// query over team-scoped data is filtered by it. Because membership is
// many-to-many, helpers return string[] - never a single id.
// -------------------------------------------------------------------
export interface TeamMembers {
  id: string;
  teamId: string;
  userId: string;
  teamRole: TeamRole;
  createdAt: Date;
  updatedAt: Date;
}

export type TeamMember = Selectable<TeamMembers>;
export type NewTeamMember = Insertable<TeamMembers>;
export type UpdateTeamMember = Updateable<TeamMembers>;

// -------------------------------------------------------------------
// User Invitations Table
// Sign-up is invite-only. An invitation may optionally place the new user
// straight into a team; teamRole only means anything alongside a teamId
// (enforced by a CHECK constraint).
// -------------------------------------------------------------------
export interface UserInvitations {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: InvitationStatus;
  expiresAt: Date;
  inviterId: string;
  teamId: string | null;
  teamRole: TeamRole | null;
  createdAt: Date;
  updatedAt: Date;
}

export type UserInvitation = Selectable<UserInvitations>;
export type NewUserInvitation = Insertable<UserInvitations>;
export type UpdateUserInvitation = Updateable<UserInvitations>;

// -------------------------------------------------------------------
// Site Content Table
// -------------------------------------------------------------------
export interface SiteContentTable {
  id: Generated<number>;
  contentName: SiteContentKey;
  contentValue: string;
  createdAt: Date;
  updatedAt: Date;
}

export type SiteContent = Selectable<SiteContentTable>;
export type NewSiteContent = Insertable<SiteContentTable>;
export type UpdateSiteContent = Updateable<SiteContentTable>;

// -------------------------------------------------------------------
// Programs Table
// A named offering that classes are instances of.
// -------------------------------------------------------------------
export interface Programs {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type Program = Selectable<Programs>;
export type NewProgram = Insertable<Programs>;
export type UpdateProgram = Updateable<Programs>;

// -------------------------------------------------------------------
// Locations Table
// Venues where classes run.
// -------------------------------------------------------------------
export interface Locations {
  id: string;
  name: string;
  address: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type Location = Selectable<Locations>;
export type NewLocation = Insertable<Locations>;
export type UpdateLocation = Updateable<Locations>;

// -------------------------------------------------------------------
// Classes Table
// A recurring class: a program delivered at a location, on one or more weekly
// days, between startDate and endDate. Dated occurrences are generated into
// class_sessions across that range.
//
// startDate/endDate are DATE columns, so pg returns them as 'YYYY-MM-DD'
// strings. Compare them lexicographically; never convert to Date.
//
// teamId is optional. When set, the team's managers can administer the class;
// when NULL it is admin-only.
// -------------------------------------------------------------------
export interface ClassScheduleDay {
  day: DayOfWeek;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

export interface Classes {
  id: string;
  programId: string;
  locationId: string;
  teamId: string | null;
  // The staff member running it (optional).
  leadUserId: string | null;
  name: string;
  description: string;
  // JSONB: read back as a parsed array; written as a JSON string.
  schedule: ColumnType<ClassScheduleDay[], string, string>;
  capacity: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type Class = Selectable<Classes>;
export type NewClass = Insertable<Classes>;
export type UpdateClass = Updateable<Classes>;

// -------------------------------------------------------------------
// Class Members Table
// A user who is in a class. Joining also writes that user's per-session
// roster rows into session_attendees.
// -------------------------------------------------------------------
export interface ClassMembers {
  id: string;
  classId: string;
  userId: string;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ClassMember = Selectable<ClassMembers>;
export type NewClassMember = Insertable<ClassMembers>;
export type UpdateClassMember = Updateable<ClassMembers>;

// -------------------------------------------------------------------
// Class Sessions Table
// sessionDate is a DATE ('YYYY-MM-DD' string); sessionStart/sessionEnd are
// TIME columns ('HH:MM:SS' strings).
// -------------------------------------------------------------------
export interface ClassSessions {
  id: string;
  classId: string;
  leadUserId: string | null;
  sessionDate: string;
  sessionStart: string;
  sessionEnd: string;
  status: SessionStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ClassSession = Selectable<ClassSessions>;
export type NewClassSession = Insertable<ClassSessions>;
export type UpdateClassSession = Updateable<ClassSessions>;

// -------------------------------------------------------------------
// Session Attendees Table
// One row per user per session: the roster, plus that user's attendance
// status for that session.
// -------------------------------------------------------------------
export interface SessionAttendees {
  id: string;
  classSessionId: string;
  userId: string;
  attendanceStatus: AttendanceStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type SessionAttendee = Selectable<SessionAttendees>;
export type NewSessionAttendee = Insertable<SessionAttendees>;
export type UpdateSessionAttendee = Updateable<SessionAttendees>;

// -------------------------------------------------------------------
// Closure Days Table
// Dates on which no classes run. Sessions on these dates show as cancelled.
// Non-destructive: removing the day restores its sessions. dayDate is a DATE
// ('YYYY-MM-DD' string). `reason` is shown to members.
// -------------------------------------------------------------------
export interface ClosureDays {
  id: string;
  dayDate: string;
  reason: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ClosureDay = Selectable<ClosureDays>;
export type NewClosureDay = Insertable<ClosureDays>;
export type UpdateClosureDay = Updateable<ClosureDays>;

// -------------------------------------------------------------------
// Documents Table
// The signable documents, as data rather than a hardcoded enum, so a project
// can add one without a schema or code change. contentKey names the
// site_content row holding the wording; bump `version` only when a change
// should force everyone to re-sign.
// -------------------------------------------------------------------
export interface Documents {
  id: string;
  key: string;
  title: string;
  version: string;
  contentKey: SiteContentKey;
  isRequired: boolean;
  orderBy: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type DocumentRecord = Selectable<Documents>;
export type NewDocumentRecord = Insertable<Documents>;
export type UpdateDocumentRecord = Updateable<Documents>;

// -------------------------------------------------------------------
// Document Signatures Table
// One immutable record per document a user signs. The exact key, title,
// version and text signed are snapshotted so later edits never change what
// was already signed, and so history survives the document row being renamed
// or deleted. signerName and signatureImage are field-encrypted.
// -------------------------------------------------------------------
export interface DocumentSignatures {
  id: string;
  userId: string;
  documentId: string | null;
  documentKey: string;
  documentVersion: string;
  documentTitle: string;
  documentContent: string;
  signerName: string;
  signatureImage: string;
  signedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type DocumentSignature = Selectable<DocumentSignatures>;
export type NewDocumentSignature = Insertable<DocumentSignatures>;
export type UpdateDocumentSignature = Updateable<DocumentSignatures>;

// -------------------------------------------------------------------
// Notification Types - admin-managed list of categories. `key` is the stable
// value stored on notifications, broadcasts and templates; `name` is the
// label. Row types are suffixed "Record" to avoid clashing with the
// NotificationType string union used elsewhere.
// -------------------------------------------------------------------
export interface NotificationTypes {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isActive: boolean;
  orderBy: number;
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationTypeRecord = Selectable<NotificationTypes>;
export type NewNotificationTypeRecord = Insertable<NotificationTypes>;
export type UpdateNotificationTypeRecord = Updateable<NotificationTypes>;

// -------------------------------------------------------------------
// Notification Templates
// Reusable content a staff member can fill the compose form from, or save the
// current draft into. Holds type/title/body only - the audience is chosen at
// send time. System templates (fixed ids) back a built-in feature and cannot
// be deleted.
// -------------------------------------------------------------------
export interface NotificationTemplates {
  id: string;
  createdBy: string | null;
  name: string;
  type: string;
  title: string;
  body: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationTemplate = Selectable<NotificationTemplates>;
export type NewNotificationTemplate = Insertable<NotificationTemplates>;
export type UpdateNotificationTemplate = Updateable<NotificationTemplates>;

// -------------------------------------------------------------------
// Notification Broadcasts
// The message a staff member sends. Each recipient gets their own row in
// `notifications` referencing the broadcast.
// -------------------------------------------------------------------
export interface NotificationBroadcasts {
  id: string;
  createdBy: string | null;
  type: string;
  audienceType: NotificationAudienceType;
  audienceLabel: string | null;
  title: string;
  body: string | null;
  createdAt: Date;
}

export type NotificationBroadcast = Selectable<NotificationBroadcasts>;
export type NewNotificationBroadcast = Insertable<NotificationBroadcasts>;
export type UpdateNotificationBroadcast = Updateable<NotificationBroadcasts>;

// -------------------------------------------------------------------
// Notifications
// One row per recipient. Backs the portal's Notifications tab, the unread
// badge in the nav, and the staff view. `readAt` is NULL until the recipient
// reads it, and is what drives the unread count (served by a partial index).
// -------------------------------------------------------------------
export interface Notifications {
  id: string;
  userId: string;
  broadcastId: string | null;
  type: string;
  title: string;
  body: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export type Notification = Selectable<Notifications>;
export type NewNotification = Insertable<Notifications>;
export type UpdateNotification = Updateable<Notifications>;

// -------------------------------------------------------------------
// Enquiry Categories - admin-managed options for the public enquiry form.
// Enquiries are emailed rather than stored, so only the chosen option's name
// is used; deactivating one hides it from the form.
// -------------------------------------------------------------------
export interface EnquiryCategories {
  id: string;
  name: string;
  isActive: boolean;
  orderBy: number;
  createdAt: Date;
  updatedAt: Date;
}

export type EnquiryCategory = Selectable<EnquiryCategories>;
export type NewEnquiryCategory = Insertable<EnquiryCategories>;
export type UpdateEnquiryCategory = Updateable<EnquiryCategories>;

// -------------------------------------------------------------------
// Enquiry Submissions
// A throttling ledger: one row per enquiry email actually sent, used to
// rate-limit per IP. The enquiry content is emailed, never stored here.
// -------------------------------------------------------------------
export interface EnquirySubmissions {
  id: string;
  ipAddress: string | null;
  createdAt: Generated<Date>;
}

export type EnquirySubmission = Selectable<EnquirySubmissions>;
export type NewEnquirySubmission = Insertable<EnquirySubmissions>;

// -------------------------------------------------------------------
// Audit Logs
// Append-only trail of sensitive-data changes and auth events. `actor_*` are
// snapshotted so the trail survives a user being renamed or deleted.
// `changes`/`metadata` are JSONB. teamId and subjectUserId are SOFT
// references (no FK) so deleting the subject never removes its history.
// -------------------------------------------------------------------
export interface AuditLogs {
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
  changes: ColumnType<Record<string, unknown> | null, string | null, string | null>;
  metadata: ColumnType<Record<string, unknown> | null, string | null, string | null>;
  createdAt: Date;
}

export type AuditLog = Selectable<AuditLogs>;
export type NewAuditLog = Insertable<AuditLogs>;

// -------------------------------------------------------------------
// Billable Status
// What an issue declares about whether its time can be invoiced. NULL is a
// third state and a meaningful one: nobody has said. It must never be quietly
// read as non-billable, because that writes off hours in silence.
// -------------------------------------------------------------------
export const BILLABLE_STATUS = {
  BILLABLE: "Billable",
  NON_BILLABLE: "Non-billable",
} as const;

export type BillableStatus = (typeof BILLABLE_STATUS)[keyof typeof BILLABLE_STATUS];

// -------------------------------------------------------------------
// Where a worklog's billable status came from. An inherited value bills
// exactly the same, but it changes silently when an item is re-parented,
// which is why the source is recorded rather than just the value.
// -------------------------------------------------------------------
export const BILLABLE_SOURCES = {
  ISSUE: "issue",
  PARENT: "parent",
  UNSET: "unset",
} as const;

export type BillableSource = (typeof BILLABLE_SOURCES)[keyof typeof BILLABLE_SOURCES];

// -------------------------------------------------------------------
// Jira Issues
// The issue cache behind the facts. `billable` here is what the issue ITSELF
// declares and is often null; the resolved value, plus which level it came
// from, is recorded per worklog.
//
// Estimates are seconds, matching Jira's own unit. See the note in
// migrations/001 on why nothing in the read model is NUMERIC.
// -------------------------------------------------------------------
export interface JiraIssues {
  issueKey: string;
  parentKey: string | null;
  projectKey: string;
  issueType: string | null;
  summary: string;
  description: string | null;
  category: string | null;
  billable: string | null;
  baselineEstimateSeconds: number | null;
  currentEstimateSeconds: number | null;
  status: string | null;
  jiraUpdatedAt: Date | null;
  syncedAt: Generated<Date>;
}

export type JiraIssue = Selectable<JiraIssues>;
export type NewJiraIssue = Insertable<JiraIssues>;
export type UpdateJiraIssue = Updateable<JiraIssues>;

// -------------------------------------------------------------------
// Jira Projects
//
// The project list with its category. Held so the Internal/External selector
// can offer a category that has NO time logged against it: "Internal
// Operations exists and has zero hours" and "there is no such thing as
// Internal" look identical otherwise, and one of them means time is being
// recorded somewhere other than Jira.
// -------------------------------------------------------------------
export interface JiraProjects {
  projectKey: string;
  name: string;
  category: string | null;
  projectType: string | null;
  syncedAt: Generated<Date>;
}

export type JiraProject = Selectable<JiraProjects>;
export type NewJiraProject = Insertable<JiraProjects>;
export type UpdateJiraProject = Updateable<JiraProjects>;

// -------------------------------------------------------------------
// Worklog Facts
// One row per Jira worklog. The primary key is Jira's own worklog id, which
// is what makes a re-sync overwrite rather than duplicate.
//
// `workDate` is a DATE and therefore arrives as a 'YYYY-MM-DD' string (see
// kysely-database-client.ts), Adelaide-local. Compare it lexicographically;
// never turn it into a Date to compare it.
//
// `hasNarrative` is GENERATED ALWAYS in Postgres, so it is select-only: the
// `never` insert and update types make writing to it a compile error rather
// than a runtime one.
// -------------------------------------------------------------------
export interface WorklogFacts {
  worklogId: string;
  issueKey: string;
  parentKey: string | null;
  projectKey: string;
  category: string | null;
  personId: string;
  personName: string | null;
  workDate: string;
  startSecond: number | null;
  timeSpentSeconds: number;
  billable: string | null;
  billableSource: Generated<string>;
  narrative: string | null;
  hasNarrative: ColumnType<boolean, never, never>;
  jiraUpdatedAt: Date | null;
  syncedAt: Generated<Date>;
}

export type WorklogFact = Selectable<WorklogFacts>;
export type NewWorklogFact = Insertable<WorklogFacts>;
export type UpdateWorklogFact = Updateable<WorklogFacts>;

// -------------------------------------------------------------------
// Sync Watermarks
// Where the last successful run of a sync job reached. Advanced last, inside
// the same transaction as the writes it describes, so a crash repeats a
// window rather than skipping one.
// -------------------------------------------------------------------
export interface SyncWatermarks {
  jobName: string;
  lastSyncedAt: Date;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  lastUpdatedCount: Generated<number>;
  lastDeletedCount: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type SyncWatermark = Selectable<SyncWatermarks>;
export type NewSyncWatermark = Insertable<SyncWatermarks>;
export type UpdateSyncWatermark = Updateable<SyncWatermarks>;

// -------------------------------------------------------------------
// Database
// -------------------------------------------------------------------
export interface Database {
  users: Users;
  sessions: Sessions;
  accounts: Accounts;
  verifications: Verifications;
  twoFactor: TwoFactor;
  teams: Teams;
  teamMembers: TeamMembers;
  userInvitations: UserInvitations;
  siteContent: SiteContentTable;
  programs: Programs;
  locations: Locations;
  classes: Classes;
  classMembers: ClassMembers;
  classSessions: ClassSessions;
  sessionAttendees: SessionAttendees;
  closureDays: ClosureDays;
  documents: Documents;
  documentSignatures: DocumentSignatures;
  notificationTypes: NotificationTypes;
  notificationTemplates: NotificationTemplates;
  notificationBroadcasts: NotificationBroadcasts;
  notifications: Notifications;
  enquiryCategories: EnquiryCategories;
  enquirySubmissions: EnquirySubmissions;
  auditLogs: AuditLogs;
  // Timesheet read model, derived from Jira and rebuildable from it.
  jiraProject: JiraProjects;
  jiraIssue: JiraIssues;
  worklogFact: WorklogFacts;
  syncWatermark: SyncWatermarks;
}
