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
// AI Chat Roles
//
// Who authored one turn. Only the two roles the Bedrock Converse API
// accepts inside `messages`: a system prompt is a separate top-level field
// there, not a message role, so it is never stored as a turn.
// -------------------------------------------------------------------
export const AI_CHAT_ROLES = {
  USER: "user",
  ASSISTANT: "assistant",
} as const;

export type AiChatRole = (typeof AI_CHAT_ROLES)[keyof typeof AI_CHAT_ROLES];

// -------------------------------------------------------------------
// AI Chat Request Kinds
//
// Which of the two calls the app makes a log row records. 'summary' is the
// compaction call - the user never sees it, so without this it would be
// invisible spend against their account.
// -------------------------------------------------------------------
export const AI_CHAT_REQUEST_KINDS = {
  CHAT: "chat",
  SUMMARY: "summary",
} as const;

export type AiChatRequestKind = (typeof AI_CHAT_REQUEST_KINDS)[keyof typeof AI_CHAT_REQUEST_KINDS];

export const AI_CHAT_REQUEST_KIND_LABELS: Record<AiChatRequestKind, string> = {
  [AI_CHAT_REQUEST_KINDS.CHAT]: "Reply",
  [AI_CHAT_REQUEST_KINDS.SUMMARY]: "Compaction",
};

// -------------------------------------------------------------------
// AI Chat Attachment Kinds
//
// Which Converse content block a stored file becomes. Bedrock caps the two
// separately per request (20 images, 5 documents) and they are not
// interchangeable, so the kind is stored rather than re-derived from the
// format every time it is needed.
// -------------------------------------------------------------------
export const AI_CHAT_ATTACHMENT_KINDS = {
  IMAGE: "image",
  DOCUMENT: "document",
} as const;

export type AiChatAttachmentKind =
  (typeof AI_CHAT_ATTACHMENT_KINDS)[keyof typeof AI_CHAT_ATTACHMENT_KINDS];

// -------------------------------------------------------------------
// Notification audience
// Who a staff member can address a broadcast to. Managers are restricted to
// teams they manage - that is enforced in the service, not here.
// -------------------------------------------------------------------
export const NOTIFICATION_AUDIENCE_TYPES = {
  EVERYONE: "everyone",
  TEAMS: "teams",
  USERS: "users",
} as const;

export type NotificationAudienceType =
  (typeof NOTIFICATION_AUDIENCE_TYPES)[keyof typeof NOTIFICATION_AUDIENCE_TYPES];

export const NOTIFICATION_AUDIENCE_LABELS: Record<NotificationAudienceType, string> = {
  [NOTIFICATION_AUDIENCE_TYPES.EVERYONE]: "Everyone",
  [NOTIFICATION_AUDIENCE_TYPES.TEAMS]: "Specific teams",
  [NOTIFICATION_AUDIENCE_TYPES.USERS]: "Specific people",
};

// Fallback notification categories, used only when the admin-managed
// notification_types table is empty (a fresh database).
export const DEFAULT_NOTIFICATION_TYPE_KEYS = {
  GENERAL: "general",
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
// AI Chat Subjects
// One conversation thread. `userId` is the only authorization boundary on
// chat - a thread is private to its owner and every query is scoped to the
// SESSION user id. `lastMessageAt` orders the sidebar and is kept separate
// from `updatedAt` so a rename does not reorder the list.
// -------------------------------------------------------------------
export interface AiChatSubjects {
  id: string;
  userId: string;
  title: string;
  lastMessageAt: Date | null;
  // Auto-compaction. `summary` stands in for every turn up to and including
  // `summaryThroughMessageId` in the REQUEST sent to the model; the original
  // turns stay in ai_chat_messages and remain readable. Both NULL on a
  // thread that has never been compacted.
  summary: string | null;
  summaryThroughMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AiChatSubject = Selectable<AiChatSubjects>;
export type NewAiChatSubject = Insertable<AiChatSubjects>;
export type UpdateAiChatSubject = Updateable<AiChatSubjects>;

// -------------------------------------------------------------------
// AI Chat Messages
// One turn, in the order it happened. The whole thread is replayed to the
// model on every send, so this table IS the conversation state.
//
// Token counts come from the Converse response's usage block, recorded on
// the assistant turn. NULL on user turns, and on an assistant turn whose
// stream ended before the usage metadata arrived.
//
// IMPORTANT: with prompt caching on, `inputTokens` is only the NON-CACHED
// portion. Total input for a turn is inputTokens + cacheReadTokens +
// cacheWriteTokens - reading inputTokens alone under-reports, which is the
// mistake that makes caching look like it is not working.
// -------------------------------------------------------------------
export interface AiChatMessages {
  id: string;
  subjectId: string;
  role: AiChatRole;
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
  // Billed at roughly a tenth of the input rate.
  cacheReadTokens: number | null;
  // Billed above the input rate, but only the delta since the last request.
  cacheWriteTokens: number | null;
  createdAt: Date;
}

export type AiChatMessage = Selectable<AiChatMessages>;
export type NewAiChatMessage = Insertable<AiChatMessages>;

// -------------------------------------------------------------------
// AI Chat Attachments
// A file attached to a turn, replayed to the model with the text.
//
// `bytes` is a Buffer both ways - node-postgres maps BYTEA to a Buffer on
// read and accepts one on write, so no encoding step belongs here. Select
// it deliberately: `selectAll()` on this table pulls every file's content
// into memory, which is the wrong default for a list.
//
// `messageId` is NULL while the file is staged - uploaded from the composer
// but not yet sent - and is set to the user turn that carried it on send.
// -------------------------------------------------------------------
export interface AiChatAttachments {
  id: string;
  // Denormalised from the subject so every read can carry the owner in its
  // WHERE clause, including reads of staged rows that have no message yet.
  userId: string;
  subjectId: string;
  messageId: string | null;
  kind: AiChatAttachmentKind;
  // The Converse format token, decided by sniffing the bytes at upload.
  format: string;
  fileName: string;
  mediaType: string;
  byteSize: number;
  // Parsed from the image header at upload; NULL on documents.
  width: number | null;
  height: number | null;
  bytes: Buffer;
  createdAt: Date;
}

export type AiChatAttachment = Selectable<AiChatAttachments>;
export type NewAiChatAttachment = Insertable<AiChatAttachments>;

// The same row without its content, which is what every read outside the
// send path wants: listing what is attached must not load the files.
export type AiChatAttachmentMeta = Omit<AiChatAttachment, "bytes">;

// -------------------------------------------------------------------
// AI Chat Request Logs
// What was ACTUALLY sent to the model, for admin review.
//
// Not reconstructable from AiChatMessages: after compaction the request
// carries a summary in place of the old turns, so replaying the transcript
// would show something that was never sent.
//
// These rows hold the full text of private conversations. The only reader is
// the admin-only viewer, and opening one writes an audit entry.
//
// `systemBlocks` and `messages` are JSONB: read back as parsed arrays,
// written as JSON strings, same as the audit log's `changes`/`metadata`.
// -------------------------------------------------------------------
export interface AiChatRequestLogs {
  id: string;
  userId: string;
  // Soft reference - a log row outlives the conversation it describes.
  subjectId: string | null;
  kind: AiChatRequestKind;
  modelId: string;
  region: string;
  systemBlocks: ColumnType<{ text: string }[], string, string>;
  // `attachments` records that a file was sent - kind, format, sanitised
  // name and size - and never its content. See the note in recordRequest.
  // Absent on rows written before attachments existed, hence optional.
  messages: ColumnType<
    {
      role: string;
      text: string;
      cachePoint: boolean;
      attachments?: {
        kind: AiChatAttachmentKind;
        format: string;
        name: string | null;
        byteSize: number;
      }[];
    }[],
    string,
    string
  >;
  // True when the payload was too large to store whole, so a truncated row
  // never passes as complete.
  truncated: Generated<boolean>;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  // NULL on success. A failed call is when an admin most wants the payload.
  error: string | null;
  durationMs: number | null;
  createdAt: Date;
}

export type AiChatRequestLog = Selectable<AiChatRequestLogs>;
export type NewAiChatRequestLog = Insertable<AiChatRequestLogs>;

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
  documents: Documents;
  documentSignatures: DocumentSignatures;
  notificationTypes: NotificationTypes;
  notificationTemplates: NotificationTemplates;
  notificationBroadcasts: NotificationBroadcasts;
  notifications: Notifications;
  enquiryCategories: EnquiryCategories;
  enquirySubmissions: EnquirySubmissions;
  aiChatSubjects: AiChatSubjects;
  aiChatMessages: AiChatMessages;
  aiChatAttachments: AiChatAttachments;
  aiChatRequestLogs: AiChatRequestLogs;
  auditLogs: AuditLogs;
}
