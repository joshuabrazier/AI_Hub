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
  // Summarising a meeting transcript. Not a chat call, but a call to the
  // same model on the organisation's account, so it belongs in the same
  // record rather than in a second log nobody remembers to read.
  TRANSCRIPTION: "transcription",
} as const;

export type AiChatRequestKind = (typeof AI_CHAT_REQUEST_KINDS)[keyof typeof AI_CHAT_REQUEST_KINDS];

export const AI_CHAT_REQUEST_KIND_LABELS: Record<AiChatRequestKind, string> = {
  [AI_CHAT_REQUEST_KINDS.CHAT]: "Reply",
  [AI_CHAT_REQUEST_KINDS.SUMMARY]: "Compaction",
  [AI_CHAT_REQUEST_KINDS.TRANSCRIPTION]: "Meeting summary",
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
  // NULL until the first-run setup screen has been completed. See the note
  // on the column in database-schema.sql.
  profileCompletedAt: Date | null;
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
// The file itself is NOT here: `storageKey` points at a blob in Azure
// Storage. That means a Postgres cascade removes the row and leaves the
// file behind, so every delete path has to clear the blob first - see
// src/lib/storage/attachment-storage.ts.
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
  // 'ai-chat/{subjectId}/{id}' - the blob holding the actual file.
  storageKey: string;
  createdAt: Date;
}

export type AiChatAttachment = Selectable<AiChatAttachments>;
export type NewAiChatAttachment = Insertable<AiChatAttachments>;

// The same row without its storage pointer, which is what every surface
// that only renders names and sizes wants. Keeping the key off this shape
// means a component or DTO cannot leak the blob path by accident.
export type AiChatAttachmentMeta = Omit<AiChatAttachment, "storageKey">;

// -------------------------------------------------------------------
// Transcription status and source
//
// A transcription is a long-running job rather than a request, so the row
// exists before the work is done and moves through these states. See the
// note on the enum in migrations/008_transcription.sql.
// -------------------------------------------------------------------
export const TRANSCRIPTION_STATUSES = {
  AWAITING_MEDIA: "awaiting_media",
  QUEUED: "queued",
  TRANSCRIBING: "transcribing",
  SUMMARISING: "summarising",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type TranscriptionStatus = (typeof TRANSCRIPTION_STATUSES)[keyof typeof TRANSCRIPTION_STATUSES];

export const TRANSCRIPTION_STATUS_LABELS: Record<TranscriptionStatus, string> = {
  [TRANSCRIPTION_STATUSES.AWAITING_MEDIA]: "Uploading",
  [TRANSCRIPTION_STATUSES.QUEUED]: "Queued",
  [TRANSCRIPTION_STATUSES.TRANSCRIBING]: "Transcribing",
  [TRANSCRIPTION_STATUSES.SUMMARISING]: "Summarising",
  [TRANSCRIPTION_STATUSES.COMPLETED]: "Ready",
  [TRANSCRIPTION_STATUSES.FAILED]: "Failed",
};

// The states a job can still move on from, so the sweep that advances
// abandoned jobs has one definition rather than a repeated list.
export const TRANSCRIPTION_IN_FLIGHT_STATUSES: readonly TranscriptionStatus[] = [
  TRANSCRIPTION_STATUSES.QUEUED,
  TRANSCRIPTION_STATUSES.TRANSCRIBING,
  TRANSCRIPTION_STATUSES.SUMMARISING,
];

export const TRANSCRIPTION_SOURCES = {
  UPLOAD: "upload",
  RECORDING: "recording",
} as const;

export type TranscriptionSource = (typeof TRANSCRIPTION_SOURCES)[keyof typeof TRANSCRIPTION_SOURCES];

// -------------------------------------------------------------------
// One speaker turn.
//
// Azure Speech diarization labels speakers by number, not by name - it
// can tell voices apart but has no idea who they belong to. The UI says
// "Speaker 1" for that reason rather than inventing an identity.
// -------------------------------------------------------------------
export type TranscriptionSegment = {
  speaker: number | null;
  startMs: number;
  endMs: number;
  text: string;
};

// -------------------------------------------------------------------
// Transcriptions
//
// The MEDIA is not here: `storageKey` points at a blob. A Postgres
// cascade therefore removes the row and leaves the file, so every delete
// path clears storage first - the same rule as chat attachments.
// -------------------------------------------------------------------
export interface Transcriptions {
  id: string;
  userId: string;
  title: string;
  source: TranscriptionSource;
  status: Generated<TranscriptionStatus>;
  storageKey: string;
  mediaType: string;
  byteSize: number | null;
  durationSeconds: number | null;
  speechJobId: string | null;
  transcript: string | null;
  segments: ColumnType<TranscriptionSegment[] | null, string | null, string | null>;
  summary: string | null;
  error: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
  completedAt: Date | null;
}

export type Transcription = Selectable<Transcriptions>;
export type NewTranscription = Insertable<Transcriptions>;
export type UpdateTranscription = Updateable<Transcriptions>;

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
// Staff Targets
//
// What a person is contracted to work and expected to bill. The only table in
// the timesheet model that is NOT derived from Jira, so it survives a rebuild
// of everything else and has to be re-entered if lost.
//
// Days are tenths (50 = 5 days) and hours are minutes (450 = 7.5h), both
// integers. See migration 003 for why nothing here is NUMERIC.
// -------------------------------------------------------------------
export interface StaffTargets {
  personId: string;
  personName: string | null;
  workingDaysTenths: Generated<number>;
  minutesPerDay: Generated<number>;
  billableTargetPercent: number | null;
  notes: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type StaffTarget = Selectable<StaffTargets>;
export type NewStaffTarget = Insertable<StaffTargets>;
export type UpdateStaffTarget = Updateable<StaffTargets>;

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
// -------------------------------------------------------------------
// Push Subscriptions
//
// One row per DEVICE. `installationId` is a random id the browser keeps in
// localStorage and is the natural key - it is how a device that
// re-subscribes updates its row rather than leaving a dead one behind.
//
// The three credential columns are issued by the browser vendor's push
// service, not by us. They are not secrets in the sense a password is, but
// they identify a person's device, so nothing reads them except the send
// path.
// -------------------------------------------------------------------
export interface PushSubscriptions {
  id: string;
  installationId: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
  lastUsedAt: Date | null;
}

export type PushSubscription = Selectable<PushSubscriptions>;
export type NewPushSubscription = Insertable<PushSubscriptions>;
export type UpdatePushSubscription = Updateable<PushSubscriptions>;

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
  enquiryCategories: EnquiryCategories;
  enquirySubmissions: EnquirySubmissions;
  aiChatSubjects: AiChatSubjects;
  aiChatMessages: AiChatMessages;
  aiChatAttachments: AiChatAttachments;
  aiChatRequestLogs: AiChatRequestLogs;
  transcriptions: Transcriptions;
  pushSubscriptions: PushSubscriptions;
  auditLogs: AuditLogs;
  // Timesheet read model, derived from Jira and rebuildable from it.
  jiraProject: JiraProjects;
  jiraIssue: JiraIssues;
  worklogFact: WorklogFacts;
  syncWatermark: SyncWatermarks;
  staffTarget: StaffTargets;
}
