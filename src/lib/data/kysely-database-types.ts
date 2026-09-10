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
  // RETIRED. Period summaries and saved reports were removed, but rows
  // carrying these kinds are already in the log and a Postgres enum value
  // cannot be dropped. They stay so the admin viewer can still label real
  // history; nothing writes them.
  TIMESHEET_SUMMARY: "timesheet_summary",
  TIMESHEET_REPORT: "timesheet_report",
  // Turning a typed question into dashboard filters. Small and frequent, where
  // a report is large and rare - telling them apart in the log is the point.
  TIMESHEET_QUERY: "timesheet_query",
  // Summarising text somebody pasted in, in a chosen style. Distinct from
  // the two below because the input is a document rather than a
  // conversation or a recording, and because it is the one kind where the
  // person chose how long the answer should be.
  TEXT_SUMMARY: "text_summary",
  // Summarising a meeting transcript. Not a chat call, but a call to the
  // same model on the organisation's account, so it belongs in the same
  // record rather than in a second log nobody remembers to read.
  TRANSCRIPTION: "transcription",
  // Choosing which SharePoint folder a meeting's notes belong in. Its own
  // kind rather than sharing 'transcription', because the two say different
  // things about the same meeting: one is what the summary cost, this is
  // what the app thought about where the note should live. A note in the
  // wrong client's folder is investigated by reading the second.
  MEETING_FILING: "meeting_filing",
  // Reading a pasted project brief into a plan. Its own kind rather than
  // sharing 'text_summary': both take a document, but a summary hands back
  // prose and this hands back a structure that becomes a project. "What did
  // the model propose to create" is a different question from "what did it
  // summarise".
  PROJECT_PLAN: "project_plan",
} as const;

export type AiChatRequestKind = (typeof AI_CHAT_REQUEST_KINDS)[keyof typeof AI_CHAT_REQUEST_KINDS];

export const AI_CHAT_REQUEST_KIND_LABELS: Record<AiChatRequestKind, string> = {
  [AI_CHAT_REQUEST_KINDS.CHAT]: "Reply",
  [AI_CHAT_REQUEST_KINDS.SUMMARY]: "Compaction",
  [AI_CHAT_REQUEST_KINDS.TIMESHEET_SUMMARY]: "Timesheet summary",
  [AI_CHAT_REQUEST_KINDS.TIMESHEET_REPORT]: "Timesheet report",
  [AI_CHAT_REQUEST_KINDS.TIMESHEET_QUERY]: "Timesheet question",
  [AI_CHAT_REQUEST_KINDS.TEXT_SUMMARY]: "Text summary",
  [AI_CHAT_REQUEST_KINDS.TRANSCRIPTION]: "Meeting summary",
  [AI_CHAT_REQUEST_KINDS.MEETING_FILING]: "Meeting filing",
  [AI_CHAT_REQUEST_KINDS.PROJECT_PLAN]: "Project plan",
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
  // The Atlassian accountId this person's time is filed under, linking an app
  // account to the read model - which is keyed on accountId and knows nothing
  // about app users. SERVER-ASSIGNED like `role`: letting somebody choose it
  // would let them log hours as somebody else. NULL means unlinked, and
  // self-service time entry is unavailable rather than guessed at.
  atlassianAccountId: string | null;
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
// User Invitations Table
// An invitation is not a gate - anybody in the tenant on an allowed domain
// gets an account. It says what ROLE the person lands with, and nothing
// else: it used to pre-assign a team too, and teams are gone.
// -------------------------------------------------------------------
export interface UserInvitations {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: InvitationStatus;
  expiresAt: Date;
  inviterId: string;
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
  // Imported from Teams, which transcribed it itself. No media ever reaches
  // this app for one of these - there is nothing to upload, nothing in blob
  // storage, and no Speech job. The row arrives already complete.
  TEAMS: "teams",
} as const;

export type TranscriptionSource = (typeof TRANSCRIPTION_SOURCES)[keyof typeof TRANSCRIPTION_SOURCES];

// How a transcription got here, as a past-tense verb, for the line under a
// title: "Recorded 3 March", "Imported from Teams 3 March".
export const TRANSCRIPTION_SOURCE_LABELS: Record<TranscriptionSource, string> = {
  [TRANSCRIPTION_SOURCES.UPLOAD]: "Uploaded",
  [TRANSCRIPTION_SOURCES.RECORDING]: "Recorded",
  [TRANSCRIPTION_SOURCES.TEAMS]: "Imported from Teams",
};

// The same fact written for the header of a downloaded transcript, where
// there is room for a sentence and no surrounding screen to give it context.
export const TRANSCRIPTION_SOURCE_DESCRIPTIONS: Record<TranscriptionSource, string> = {
  [TRANSCRIPTION_SOURCES.UPLOAD]: "Source: uploaded file",
  [TRANSCRIPTION_SOURCES.RECORDING]: "Source: recorded in the browser",
  [TRANSCRIPTION_SOURCES.TEAMS]: "Source: imported from a Microsoft Teams meeting",
};

// -------------------------------------------------------------------
// One speaker turn.
//
// Azure Speech diarization labels speakers by number, not by name - it
// can tell voices apart but has no idea who they belong to. The UI says
// "Speaker 1" for that reason rather than inventing an identity.
// -------------------------------------------------------------------
export type TranscriptionSegment = {
  // Azure diarization numbers voices it has told apart but cannot name.
  // Null when it could not separate them at all, which is what a single
  // microphone in a room usually produces.
  speaker: number | null;
  // A REAL NAME, and only Teams can supply one. It transcribes each
  // participant's own microphone against their signed-in identity, so it is
  // not clustering voices - it knows who is speaking. Null for anything
  // recorded or uploaded here, where no such identity exists.
  //
  // Both fields rather than one: they are different kinds of certainty, and
  // collapsing them would either lose the name or imply a name where there
  // is only a guess.
  speakerName?: string | null;
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
//
// A 'teams' row has NO media and no Speech job: it is imported complete
// through Microsoft Graph, so `storageKey`, `mediaType` and `speechJobId`
// are all null on it and `sourceRef` says where it came from.
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// A standing intent to import ONE meeting when it ends.
//
// Written when somebody confirms they have started transcription in Teams;
// read by the sweep, which imports on their behalf and on their own token.
// See migration 018 for why this is a row rather than "import everything
// recent".
// -------------------------------------------------------------------
export const TEAMS_AUTO_IMPORT_STATUSES = {
  PENDING: "pending",
  IMPORTED: "imported",
  // No transcript ever appeared. Almost always means nobody started one,
  // which is an ordinary outcome rather than a failure - the prompt asks, it
  // does not compel - so it is told apart from FAILED on screen.
  NO_TRANSCRIPT: "no_transcript",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type TeamsAutoImportStatus =
  (typeof TEAMS_AUTO_IMPORT_STATUSES)[keyof typeof TEAMS_AUTO_IMPORT_STATUSES];

export interface TeamsAutoImports {
  id: string;
  userId: string;
  eventId: string;
  subject: string | null;
  endsAt: Date;
  status: Generated<TeamsAutoImportStatus>;
  attempts: Generated<number>;
  lastAttemptAt: Date | null;
  transcriptionId: string | null;
  error: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type TeamsAutoImport = Selectable<TeamsAutoImports>;
export type NewTeamsAutoImport = Insertable<TeamsAutoImports>;
export type TeamsAutoImportUpdate = Updateable<TeamsAutoImports>;

export interface Transcriptions {
  id: string;
  userId: string;
  title: string;
  source: TranscriptionSource;
  status: Generated<TranscriptionStatus>;
  // NULL on a Teams import, which has no media at all - Teams transcribed
  // the meeting itself and only the text was fetched. Every path that
  // reaches storage has to say what it does with that, which is the point
  // of the column being nullable rather than holding a key to nothing.
  storageKey: string | null;
  mediaType: string | null;
  // What this row was imported from, in the source system's own terms - the
  // Graph transcript id for 'teams', NULL for anything that originated
  // here. Unique per person, so importing the same meeting twice finds the
  // copy that already exists instead of paying for a second summary.
  sourceRef: string | null;
  byteSize: number | null;
  durationSeconds: number | null;
  speechJobId: string | null;
  transcript: string | null;
  segments: ColumnType<TranscriptionSegment[] | null, string | null, string | null>;
  summary: string | null;
  // How many model calls this row's summary has already cost. Counted rather
  // than timed, because attempts are what a failing summary spends - see
  // migration 015.
  summaryAttempts: Generated<number>;
  // The lease. Non-null while a sweep is summarising this row; a value older
  // than the lease window means that attempt died without finishing and the
  // row is free again. Deliberately NOT updatedAt, which the give-up rule
  // already reads for a different question.
  summaryStartedAt: Date | null;
  error: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
  completedAt: Date | null;
}

export type Transcription = Selectable<Transcriptions>;
export type NewTranscription = Insertable<Transcriptions>;
export type UpdateTranscription = Updateable<Transcriptions>;

// -------------------------------------------------------------------
// Where a meeting's notes were filed in SharePoint, and why
//
// ONE ROW PER TRANSCRIPTION, and the unique constraint behind it is the
// whole idempotency story: SharePoint accepts a second upload of the same
// name as a new version rather than an error, so without a record of "this
// one is done" a retrying sweep would fill a folder with copies of one
// meeting. See migration 019.
//
// WHY IS AS LOAD-BEARING AS WHERE. Three mechanisms of very different
// confidence choose the destination, and "notes about client A are in
// client B's folder" is a confidentiality question that cannot be answered
// by the answer alone. Same argument as worklogFact.rndSource.
// -------------------------------------------------------------------
export const TRANSCRIPTION_FILING_STATUSES = {
  // A destination has not been worked out yet, or working it out failed and
  // the sweep will try again. This is the only status the sweep acts on.
  PENDING: "pending",
  // -----------------------------------------------------------------
  // A destination is PROPOSED and a person has to say yes.
  //
  // THE OPPOSITE OF PENDING, which is why it is not the same value: nothing
  // will happen to this row until somebody acts, and the sweep must leave it
  // alone. One value for both would make the sweep either abandon its
  // retries or keep re-deciding something nobody has answered.
  //
  // NOTHING HAS BEEN WRITTEN TO SHAREPOINT while a row sits here. The
  // proposal is a folder id, or a path for the holding folder that is not
  // created until the answer is yes, or nothing at all when nothing matched
  // and the person has to choose.
  // -----------------------------------------------------------------
  AWAITING_APPROVAL: "awaiting_approval",
  FILED: "filed",
  // No library could be resolved, which a person choosing a folder cannot
  // fix - it is a configuration fault. Narrower than it used to be: "nothing
  // matched" is now AWAITING_APPROVAL with no proposal, because somebody is
  // going to look at it either way.
  NOWHERE: "nowhere",
  // Graph refused. Retryable by a person, not by the sweep.
  FAILED: "failed",
} as const;

export type TranscriptionFilingStatus =
  (typeof TRANSCRIPTION_FILING_STATUSES)[keyof typeof TRANSCRIPTION_FILING_STATUSES];

export const TRANSCRIPTION_FILING_STATUS_LABELS: Record<TranscriptionFilingStatus, string> = {
  [TRANSCRIPTION_FILING_STATUSES.PENDING]: "Working out where to file it",
  [TRANSCRIPTION_FILING_STATUSES.AWAITING_APPROVAL]: "Waiting for you to confirm the folder",
  [TRANSCRIPTION_FILING_STATUSES.FILED]: "Filed in SharePoint",
  [TRANSCRIPTION_FILING_STATUSES.NOWHERE]: "SharePoint filing is not set up",
  [TRANSCRIPTION_FILING_STATUSES.FAILED]: "Could not be filed",
};

export interface TranscriptionFilings {
  id: string;
  transcriptionId: string;
  // Denormalised from transcriptions deliberately: every read here is
  // scoped by owner, and the upload runs on that person's own delegated
  // token.
  userId: string;
  driveId: string | null;
  folderItemId: string | null;
  // A SNAPSHOT of the path at the moment the decision was made. Folders get
  // renamed and moved, and "where we put it" has to stay answerable.
  folderPath: string | null;
  // 'client-name' | 'model' | 'fallback'. Text rather than an enum, matching
  // rndSource: a value nobody expected should surface as a finding in the
  // read model, not fail the write.
  decidedVia: string | null;
  reason: string | null;
  status: Generated<TranscriptionFilingStatus>;
  attempts: Generated<number>;
  fileItemId: string | null;
  fileWebUrl: string | null;
  fileName: string | null;
  error: string | null;
  filedAt: Date | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type TranscriptionFiling = Selectable<TranscriptionFilings>;
export type NewTranscriptionFiling = Insertable<TranscriptionFilings>;
export type UpdateTranscriptionFiling = Updateable<TranscriptionFilings>;

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
// -------------------------------------------------------------------
// One turn's phase timeline, as stored.
//
// Declared here rather than imported from the guard that produces it,
// because a stored shape and a runtime shape are allowed to diverge and the
// database is the one that has to keep reading old rows. A field added to
// the guard is optional here until every row has it.
// -------------------------------------------------------------------
export type TurnPhaseLog = {
  totalMs: number;
  currentPhase: string | null;
  timedOutPhase: string | null;
  readerLeft: boolean;
  // Added after the first rows were written, so optional: a row from before
  // the overall ceiling existed simply does not say.
  ceilingHit?: boolean;
  phases: {
    name: string;
    ms: number;
    budgetMs: number;
    kind: "duration" | "idle";
    timedOut: boolean;
  }[];
  notes: Record<string, string | number | boolean>;
};

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
  // -----------------------------------------------------------------
  // The phase timeline: where the duration above actually went.
  //
  // duration_ms says a turn took twenty seconds; this says nineteen of them
  // were spent compacting the thread before the model was asked anything.
  // Without it the log could describe a failure without being able to
  // explain one, which is how "the model sent nothing for 20 seconds" stood
  // as a diagnosis for weeks. See migration 022 for the shape.
  //
  // NULL is ordinary: rows written before this existed have none, and a
  // compaction call is one request inside somebody else's turn.
  // -----------------------------------------------------------------
  phases: ColumnType<TurnPhaseLog | null, string | null, string | null>;
  createdAt: Date;
}

export type AiChatRequestLog = Selectable<AiChatRequestLogs>;
export type NewAiChatRequestLog = Insertable<AiChatRequestLogs>;

// -------------------------------------------------------------------
// Audit Logs
// Append-only trail of sensitive-data changes and auth events. `actor_*` are
// snapshotted so the trail survives a user being renamed or deleted.
// `changes`/`metadata` are JSONB. subjectUserId is a SOFT reference (no FK)
// so deleting the subject never removes its history.
// -------------------------------------------------------------------
export interface AuditLogs {
  id: string;
  actorUserId: string | null;
  actorRole: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
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
  // -----------------------------------------------------------------
  // R&D classification, FROZEN at sync time.
  //
  // Jira labels are mutable and Jira keeps no history of them, so deriving
  // this live would let a label added in December reclassify every hour
  // logged since July. These figures may support an R&D Tax Incentive
  // claim, so what was classified and when has to be reproducible.
  //
  // Never join jira_issue to obtain these. The grain here is one row per
  // WORKLOG; an issue with six worklogs would have every hour counted six
  // times. See migration 016.
  // -----------------------------------------------------------------
  labelsSnapshot: string | null;
  // 'core' | 'supporting' | null. See RndClass in jira-mapping.ts.
  rndClass: string | null;
  // NULL means never classified, which is not the same as classified as
  // not-R&D: the first is a gap, the second is a decision.
  classifiedAt: Date | null;
  // 'label' | 'space' | null. WHICH rule produced rndClass. With two rules
  // able to produce one, the answer alone cannot defend a claim - see
  // migration 017.
  rndSource: string | null;
}

export type WorklogFact = Selectable<WorklogFacts>;
export type NewWorklogFact = Insertable<WorklogFacts>;
export type UpdateWorklogFact = Updateable<WorklogFacts>;

// -------------------------------------------------------------------
// Reclassification history
//
// One row whenever a sync changes an existing worklog's rnd_class. Only
// CHANGES, so this stays a record of what moved rather than a log of every
// run.
//
// `worklogId` is a SOFT reference with no foreign key: a worklog deleted in
// Jira loses its worklog_fact row, and the record that it was once
// classified as core has to outlive that, because hours were claimed on the
// strength of it. Same rule as audit_logs.
// -------------------------------------------------------------------
export interface WorklogRndHistories {
  id: string;
  worklogId: string;
  oldRndClass: string | null;
  newRndClass: string | null;
  oldLabels: string | null;
  newLabels: string | null;
  // A change of SOURCE matters as much as a change of class: an hour that
  // was core because somebody labelled it, and is now core only because of
  // where it lives, is a weaker claim than it was.
  oldRndSource: string | null;
  newRndSource: string | null;
  changedAt: Generated<Date>;
}

export type WorklogRndHistory = Selectable<WorklogRndHistories>;
export type NewWorklogRndHistory = Insertable<WorklogRndHistories>;

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
  // ISO weekday numbers, 1 = Monday. Null when only a count is recorded, which
  // is what every row started as - see migration 009. Null is NOT an empty
  // array: "unspecified" and "works no days" are different arrangements.
  workingWeekdays: number[] | null;
  minutesPerDay: Generated<number>;
  billableTargetPercent: number | null;
  notes: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

// -------------------------------------------------------------------
// Staff Rates
//
// What an hour of somebody's time is charged at, with HISTORY: one row per
// person per effective-from date, and a worklog is valued at whichever row was
// in force on the day it was worked. See migration 007 and
// lib/timesheet/revenue.ts.
//
// Money is INTEGER CENTS, for the same reason durations are integer seconds:
// node-postgres returns NUMERIC as a string, so "150.50" + "100" becomes
// "150.50100". Cents are exact and they sum.
// -------------------------------------------------------------------
export interface StaffRates {
  id: string;
  personId: string;
  personName: string | null;
  // `effective_from` is a DATE, so it arrives as a 'YYYY-MM-DD' string - see
  // the type parser note in kysely-database-client.ts. Compared
  // lexicographically, never parsed into a Date.
  effectiveFrom: string;
  chargeRateCents: number;
  // Null means nobody has recorded a cost, so margin is UNKNOWN, not 100%.
  costRateCents: number | null;
  notes: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

// -------------------------------------------------------------------
// Manual Worklogs
//
// Time entered IN THIS APP rather than synced from Jira. The one timesheet
// table that is NOT derived and NOT rebuildable - it is the only copy of what
// it holds, so it belongs in the backup. See migration 008.
//
// `billable` is deliberately absent: it is resolved from the issue at read
// time, exactly as the Jira read model does, so nobody can mark their own
// hours chargeable.
// -------------------------------------------------------------------
export interface ManualWorklogs {
  id: string;
  personId: string;
  personName: string | null;
  enteredBy: string | null;
  enteredByName: string | null;
  issueKey: string;
  // `work_date` is a DATE, so it arrives as a 'YYYY-MM-DD' string - see the
  // type parser note in kysely-database-client.ts. Compared lexicographically.
  workDate: string;
  timeSpentSeconds: number;
  notes: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type ManualWorklog = Selectable<ManualWorklogs>;
export type NewManualWorklog = Insertable<ManualWorklogs>;
export type UpdateManualWorklog = Updateable<ManualWorklogs>;

export type StaffRate = Selectable<StaffRates>;
export type NewStaffRate = Insertable<StaffRates>;
export type UpdateStaffRate = Updateable<StaffRates>;

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

// -------------------------------------------------------------------
// Session Two Factor Table
//
// Whether a given SESSION has cleared the second factor. Keyed on the
// session and cascading with it, so signing out discards the verification
// and a second device has to verify on its own.
//
// It exists because Better Auth's twoFactor plugin only challenges on the
// password sign-in path, and sign-in here is Microsoft - see
// migrations/011_session_two_factor.sql for the full reasoning.
//
// `verifiedAt` NULL means attempted and not yet through, which the gate
// treats the same as no row. The counters are this feature's own rate
// limiting: the plugin's attempt limiter does not run when a session
// already exists.
// -------------------------------------------------------------------
export interface SessionTwoFactors {
  sessionId: string;
  verifiedAt: Date | null;
  failedCount: Generated<number>;
  lockedUntil: Date | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type SessionTwoFactor = Selectable<SessionTwoFactors>;
export type NewSessionTwoFactor = Insertable<SessionTwoFactors>;
export type UpdateSessionTwoFactor = Updateable<SessionTwoFactors>;

// -------------------------------------------------------------------
// SharePoint inventory
//
// A read-only picture of a document library, crawled through the Graph
// delta endpoint. See migrations/012_sharepoint_inventory.sql for the
// reasoning behind each column; the notes here are only the ones a
// TypeScript caller can get wrong.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Where a crawl got to.
//
// Two of these are not failures and must not be rendered as one.
// PAUSED_THROTTLED means Graph asked us to stop and the run resumes by
// itself; NEEDS_REAUTH means a named person has to sign in again and no
// amount of waiting will fix it. Collapsing either into FAILED would send
// somebody looking for a bug that is not there.
// -------------------------------------------------------------------
export const SHAREPOINT_CRAWL_STATUSES = {
  QUEUED: "queued",
  RUNNING: "running",
  PAUSED_THROTTLED: "paused_throttled",
  NEEDS_REAUTH: "needs_reauth",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type SharepointCrawlStatus =
  (typeof SHAREPOINT_CRAWL_STATUSES)[keyof typeof SHAREPOINT_CRAWL_STATUSES];

export const SHAREPOINT_CRAWL_STATUS_LABELS: Record<SharepointCrawlStatus, string> = {
  [SHAREPOINT_CRAWL_STATUSES.QUEUED]: "Queued",
  [SHAREPOINT_CRAWL_STATUSES.RUNNING]: "Running",
  [SHAREPOINT_CRAWL_STATUSES.PAUSED_THROTTLED]: "Paused, SharePoint is throttling",
  [SHAREPOINT_CRAWL_STATUSES.NEEDS_REAUTH]: "Needs sign-in",
  [SHAREPOINT_CRAWL_STATUSES.COMPLETED]: "Finished",
  [SHAREPOINT_CRAWL_STATUSES.FAILED]: "Failed",
};

// The states a crawl can still move on from. One definition, because the
// sweep that picks work up and the guard that stops a second crawl on the
// same drive must agree about what "in flight" means - if they disagree,
// either work is dropped or two crawls walk the same drive at once.
export const SHAREPOINT_CRAWL_UNFINISHED_STATUSES: readonly SharepointCrawlStatus[] = [
  SHAREPOINT_CRAWL_STATUSES.QUEUED,
  SHAREPOINT_CRAWL_STATUSES.RUNNING,
  SHAREPOINT_CRAWL_STATUSES.PAUSED_THROTTLED,
];

// -------------------------------------------------------------------
// A nominated document library.
//
// `deltaLink` is the resumption token for the NEXT crawl and is written
// only when a walk finishes. A half-finished walk leaves it alone, because
// storing it early would claim we had seen the whole library.
// -------------------------------------------------------------------
export interface SharepointDrives {
  driveId: string;
  siteId: string;
  siteName: string;
  driveName: string;
  webUrl: string;
  nominatedBy: string | null;
  nominatedByName: string | null;
  deltaLink: string | null;
  deltaLinkUpdatedAt: Date | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type SharepointDrive = Selectable<SharepointDrives>;
export type NewSharepointDrive = Insertable<SharepointDrives>;
export type UpdateSharepointDrive = Updateable<SharepointDrives>;

// -------------------------------------------------------------------
// One run of a crawl.
//
// `runAsUserId` is whose delegated token the run uses, and therefore whose
// SharePoint permissions bound it. It is the access-control story of the
// whole feature, which is why it is NOT NULL here as well as in the schema.
// -------------------------------------------------------------------
export interface SharepointCrawls {
  id: string;
  driveId: string;
  status: Generated<SharepointCrawlStatus>;
  runAsUserId: string;
  nextLink: string | null;
  itemsSeen: Generated<number>;
  pagesDone: Generated<number>;
  throttledUntil: Date | null;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type SharepointCrawl = Selectable<SharepointCrawls>;
export type NewSharepointCrawl = Insertable<SharepointCrawls>;
export type UpdateSharepointCrawl = Updateable<SharepointCrawls>;

// -------------------------------------------------------------------
// One file or folder, as we last saw it.
//
// `sizeBytes` is BIGINT and is typed as a string on the way out, because
// that is what node-postgres returns for int8 and silently coercing it in
// the type would be a lie about values above 2^53. Callers that need to
// add sizes up should do it in SQL, where the sum is also a bigint.
//
// `hasUniquePermissions` is deliberately never written by phase 1. NULL
// means "not established", which is a gap; false would mean "safe to move",
// which would be a guess presented as a fact.
// -------------------------------------------------------------------
export interface SharepointItems {
  driveId: string;
  itemId: string;
  parentId: string | null;
  name: string;
  path: string | null;
  depth: number | null;
  isFolder: boolean;
  sizeBytes: ColumnType<string | null, number | null, number | null>;
  childCount: number | null;
  quickXorHash: string | null;
  createdAtRemote: Date | null;
  modifiedAtRemote: Date | null;
  modifiedByName: string | null;
  hasUniquePermissions: boolean | null;
  deletedAt: Date | null;
  firstSeenAt: Generated<Date>;
  lastSeenAt: Generated<Date>;
}

export type SharepointItem = Selectable<SharepointItems>;
export type NewSharepointItem = Insertable<SharepointItems>;
export type UpdateSharepointItem = Updateable<SharepointItems>;

// -------------------------------------------------------------------
// ===================================================================
// DELIVERY: clients, projects, phases, tasks, time
// ===================================================================
//
// The app's own delivery model, which REPLACES Jira as the source of truth
// for what work exists and how long it took. Migration 016 has the full
// reasoning; the three things worth knowing before writing a query:
//
//   TIME IS INTEGER MINUTES. Never a float of hours. Somebody types 1.5
//   and 90 is stored, because totalling a month of floating-point hours
//   drifts and a billing figure that is quietly out by a cent is worse
//   than one that is obviously wrong.
//
//   MONEY IS INTEGER CENTS, matching the Jira-era staff_rate.
//
//   `workDate` AND `effectiveFrom` ARE STRINGS. They are Postgres DATE
//   columns, and the type parser maps DATE to 'YYYY-MM-DD' on purpose -
//   timezone-safe and React-renderable. Compare them lexicographically and
//   never turn one into a Date.
// -------------------------------------------------------------------

export const PROJECT_STATUSES = {
  ACTIVE: "active",
  ON_HOLD: "on_hold",
  COMPLETED: "completed",
  // The soft delete. Time entries reference tasks, so a project is never
  // actually removed - archiving is how it leaves the screen.
  ARCHIVED: "archived",
} as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[keyof typeof PROJECT_STATUSES];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  [PROJECT_STATUSES.ACTIVE]: "Active",
  [PROJECT_STATUSES.ON_HOLD]: "On hold",
  [PROJECT_STATUSES.COMPLETED]: "Completed",
  [PROJECT_STATUSES.ARCHIVED]: "Archived",
};

// -------------------------------------------------------------------
// The three rates a person can be charged at.
//
// Which one applies is decided PER PROJECT MEMBER, not per person: the
// same consultant can be discounted for one client and standard for
// another, and the band lives on `project_members` for that reason.
// -------------------------------------------------------------------
export const RATE_BANDS = {
  DISCOUNTED: "discounted",
  STANDARD: "standard",
  HIGH: "high",
} as const;

export type RateBand = (typeof RATE_BANDS)[keyof typeof RATE_BANDS];

export const RATE_BAND_LABELS: Record<RateBand, string> = {
  [RATE_BANDS.DISCOUNTED]: "Discounted",
  [RATE_BANDS.STANDARD]: "Standard",
  [RATE_BANDS.HIGH]: "High",
};

// Cheapest to dearest. Exported for the same reason TASK_COLUMN_ORDER is: a
// screen or a service that iterated Object.values(RATE_BANDS) would inherit
// its order from however the constant happens to be declared, so reordering
// that would silently reorder a rates form and an audit summary. Ordering is
// a decision, and it is made once, here.
export const RATE_BAND_ORDER: readonly RateBand[] = [
  RATE_BANDS.DISCOUNTED,
  RATE_BANDS.STANDARD,
  RATE_BANDS.HIGH,
];

// -------------------------------------------------------------------
// The four columns of every board.
//
// Fixed rather than configurable, and deliberately: a board whose columns
// differ per project cannot be reported on across projects, and having
// `blocked` as a real column rather than a flag is most of the point of
// looking at a board at all.
// -------------------------------------------------------------------
export const TASK_COLUMNS = {
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  BLOCKED: "blocked",
  DONE: "done",
} as const;

export type TaskColumn = (typeof TASK_COLUMNS)[keyof typeof TASK_COLUMNS];

export const TASK_COLUMN_LABELS: Record<TaskColumn, string> = {
  [TASK_COLUMNS.TODO]: "To do",
  [TASK_COLUMNS.IN_PROGRESS]: "In progress",
  [TASK_COLUMNS.BLOCKED]: "Blocked",
  [TASK_COLUMNS.DONE]: "Done",
};

// Left to right on the board. Exported so the UI cannot invent its own
// ordering and disagree with a report.
export const TASK_COLUMN_ORDER: readonly TaskColumn[] = [
  TASK_COLUMNS.TODO,
  TASK_COLUMNS.IN_PROGRESS,
  TASK_COLUMNS.BLOCKED,
  TASK_COLUMNS.DONE,
];

export interface Clients {
  id: string;
  name: string;
  notes: string | null;
  isActive: Generated<boolean>;
  createdBy: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type Client = Selectable<Clients>;
export type NewClient = Insertable<Clients>;
export type UpdateClient = Updateable<Clients>;

export interface Projects {
  id: string;
  clientId: string;
  title: string;
  description: string | null;
  isBillable: Generated<boolean>;
  status: Generated<ProjectStatus>;
  // Set the first time the project's budget has been allocated to tasks,
  // and never cleared. It is what stops the setup progress bar coming back
  // if an estimate is later reduced - a one-time nudge, not a rule.
  budgetAssignedAt: Date | null;
  createdBy: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type Project = Selectable<Projects>;
export type NewProject = Insertable<Projects>;
export type UpdateProject = Updateable<Projects>;

// -------------------------------------------------------------------
// Project membership - THE SECURITY BOUNDARY OF THIS MODULE.
//
// Only somebody with a row here can see a project, its board or its tasks;
// an admin sees everything. Every read carries a predicate against it, the
// same arrangement team membership uses elsewhere.
//
// `isLead` is the second gate: only a lead may create or edit tasks.
// -------------------------------------------------------------------
export interface ProjectMembers {
  projectId: string;
  userId: string;
  isLead: Generated<boolean>;
  rateBand: Generated<RateBand>;
  createdAt: Generated<Date>;
}

export type ProjectMember = Selectable<ProjectMembers>;
export type NewProjectMember = Insertable<ProjectMembers>;
export type UpdateProjectMember = Updateable<ProjectMembers>;

// -------------------------------------------------------------------
// A named bundle of specific people sharing a pooled budget - "these two
// interns have 400 hours between them".
//
// Per project rather than a global seniority band, because the split that
// makes sense differs from one engagement to the next. A person may be in
// at most one group per project, and the database enforces that rather
// than trusting a service to remember.
// -------------------------------------------------------------------
export interface ProjectBudgetGroups {
  id: string;
  projectId: string;
  name: string;
  budgetMinutes: Generated<number>;
  position: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type ProjectBudgetGroup = Selectable<ProjectBudgetGroups>;
export type NewProjectBudgetGroup = Insertable<ProjectBudgetGroups>;
export type UpdateProjectBudgetGroup = Updateable<ProjectBudgetGroups>;

export interface ProjectBudgetGroupMembers {
  groupId: string;
  // Carried so a unique index can cover (projectId, userId) and hold the
  // one-group-per-person rule. A composite foreign key stops it
  // disagreeing with the group's own project.
  projectId: string;
  userId: string;
  createdAt: Generated<Date>;
}

export type ProjectBudgetGroupMember = Selectable<ProjectBudgetGroupMembers>;
export type NewProjectBudgetGroupMember = Insertable<ProjectBudgetGroupMembers>;

// The level Jira did not have. A board is split into one board per phase,
// so a phase is a heading with an order rather than a status.
export interface Phases {
  id: string;
  projectId: string;
  name: string;
  position: Generated<number>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type Phase = Selectable<Phases>;
export type NewPhase = Insertable<Phases>;
export type UpdatePhase = Updateable<Phases>;

// -------------------------------------------------------------------
// `projectId` is DENORMALISED here on purpose: every board read, every
// authorization check and every timesheet row needs it, and joining
// through phases to find out would put a join in front of the most common
// query in the feature. A composite foreign key keeps it honest.
// -------------------------------------------------------------------
export interface Tasks {
  id: string;
  phaseId: string;
  projectId: string;
  title: string;
  description: string | null;
  estimateMinutes: Generated<number>;
  boardColumn: Generated<TaskColumn>;
  position: Generated<number>;
  assigneeId: string | null;
  createdBy: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type Task = Selectable<Tasks>;
export type NewTask = Insertable<Tasks>;
export type UpdateTask = Updateable<Tasks>;

// -------------------------------------------------------------------
// Metadata only. THE FILE LIVES IN AZURE BLOB, addressed by `storageKey`,
// like chat attachments and transcription media - and it carries the same
// sharp edge: a Postgres cascade CANNOT delete a blob. Every path that
// removes these rows clears storage FIRST, and the monthly job needs a
// reconciliation pass for whatever a cascade removed behind its back.
// -------------------------------------------------------------------
export interface TaskAttachments {
  id: string;
  taskId: string;
  storageKey: string;
  fileName: string;
  // Server-derived from the bytes, never taken from the browser.
  mediaType: string;
  byteSize: number;
  uploadedBy: string | null;
  createdAt: Generated<Date>;
}

export type TaskAttachment = Selectable<TaskAttachments>;
export type NewTaskAttachment = Insertable<TaskAttachments>;

// -------------------------------------------------------------------
// Three named bands per person, EFFECTIVE-DATED.
//
// The dating keeps history honest: raising a rate in July must not restate
// June's margin. A rate is the latest `effectiveFrom` on or before the work
// date. Keyed on users(id), unlike the Jira-era staff_rate which keyed on
// an Atlassian account id.
//
// Admin-only, enforced in the service. Nothing in the schema stops a read.
// -------------------------------------------------------------------
export interface UserRates {
  id: string;
  userId: string;
  band: RateBand;
  chargeRateCents: number;
  // Nullable because charge rates are known long before anybody models
  // cost, and a project is reportable on revenue alone until then.
  costRateCents: number | null;
  // A DATE column: 'YYYY-MM-DD', compared lexicographically.
  effectiveFrom: string;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type UserRate = Selectable<UserRates>;
export type NewUserRate = Insertable<UserRates>;
export type UpdateUserRate = Updateable<UserRates>;

// -------------------------------------------------------------------
// One person, one task, one day, some minutes.
//
// Enterable from a task on the board or from the timesheet grid, with no
// difference in the row - which is why both screens show the same entry.
//
// THE RATES ARE SNAPSHOTS, not derived at report time. An hour is worth
// what it was worth when it was worked, so a rate change cannot silently
// restate last quarter. Null on a non-billable project, and cost is null
// until cost is modelled.
// -------------------------------------------------------------------
export interface TimeEntries {
  id: string;
  taskId: string;
  projectId: string;
  userId: string;
  // A DATE column: 'YYYY-MM-DD'.
  workDate: string;
  minutes: number;
  notes: string | null;
  chargeRateCents: number | null;
  costRateCents: number | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export type TimeEntry = Selectable<TimeEntries>;
export type NewTimeEntry = Insertable<TimeEntries>;
export type UpdateTimeEntry = Updateable<TimeEntries>;

// -------------------------------------------------------------------
// Append-only record of every estimate adjustment, kept BESIDE the current
// value on `tasks` rather than replacing it.
//
// It earns a table because an estimate can be increased either by adding
// to the project's total or by TAKING the minutes from another task,
// possibly in another phase. That second form is a transfer, and a
// transfer with no record is indistinguishable from somebody quietly
// moving budget to hide an overrun. When a project goes over, the first
// question is what moved and who moved it.
//
// `fromTaskId` null means the project's total went up. `minutes` is
// SIGNED, so the log sums to the difference between the original estimate
// and the current one.
// -------------------------------------------------------------------
export interface EstimateChanges {
  id: string;
  taskId: string;
  fromTaskId: string | null;
  minutes: number;
  reason: string | null;
  changedBy: string | null;
  createdAt: Generated<Date>;
}

export type EstimateChange = Selectable<EstimateChanges>;
export type NewEstimateChange = Insertable<EstimateChanges>;

// -------------------------------------------------------------------
// A credential for something that is not a browser.
//
// See migration 026 for the whole argument, and for the one property that
// matters most: a token bypasses the second factor, because there is no
// session for isTwoFactorSatisfied to check. It is narrow, expiring,
// revocable and recorded for exactly that reason.
//
// Only the HASH is here. A token is 32 random bytes, so a single SHA-256 is
// the right function - stretching defends against guessing, and there is
// nothing to guess.
// -------------------------------------------------------------------
export interface PersonalAccessTokens {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  // The first few characters, in clear, so a person can tell their own
  // tokens apart and match a leaked string to the row to revoke.
  prefix: string;
  // Which surface this token may reach. A route opts IN to a scope, so
  // widening a service cannot quietly widen every token.
  scope: string;
  lastUsedAt: Date | null;
  // NULL does not expire, which is allowed and is not the default.
  expiresAt: Date | null;
  // A timestamp rather than a delete, so "this was turned off on the 3rd"
  // stays answerable.
  revokedAt: Date | null;
  createdAt: Generated<Date>;
}

export type PersonalAccessToken = Selectable<PersonalAccessTokens>;
export type NewPersonalAccessToken = Insertable<PersonalAccessTokens>;

export interface Database {
  users: Users;
  sessions: Sessions;
  accounts: Accounts;
  verifications: Verifications;
  twoFactor: TwoFactor;
  userInvitations: UserInvitations;
  siteContent: SiteContentTable;
  enquiryCategories: EnquiryCategories;
  enquirySubmissions: EnquirySubmissions;
  aiChatSubjects: AiChatSubjects;
  aiChatMessages: AiChatMessages;
  aiChatAttachments: AiChatAttachments;
  aiChatRequestLogs: AiChatRequestLogs;
  teamsAutoImport: TeamsAutoImports;
  transcriptions: Transcriptions;
  transcriptionFiling: TranscriptionFilings;
  pushSubscriptions: PushSubscriptions;
  personalAccessTokens: PersonalAccessTokens;
  sessionTwoFactor: SessionTwoFactors;
  auditLogs: AuditLogs;
  // Timesheet read model, derived from Jira and rebuildable from it.
  jiraProject: JiraProjects;
  jiraIssue: JiraIssues;
  worklogFact: WorklogFacts;
  worklogRndHistory: WorklogRndHistories;
  syncWatermark: SyncWatermarks;
  staffTarget: StaffTargets;
  staffRate: StaffRates;
  manualWorklog: ManualWorklogs;
  // -----------------------------------------------------------------
  // Delivery. THE APP'S OWN DATA, and the reason this paragraph reads
  // differently from the two below it: everything under Jira and
  // SharePoint is a mirror that can be rebuilt from its source, and none
  // of this can. It is the record.
  // -----------------------------------------------------------------
  clients: Clients;
  projects: Projects;
  projectMembers: ProjectMembers;
  projectBudgetGroups: ProjectBudgetGroups;
  projectBudgetGroupMembers: ProjectBudgetGroupMembers;
  phases: Phases;
  tasks: Tasks;
  taskAttachments: TaskAttachments;
  userRates: UserRates;
  timeEntries: TimeEntries;
  estimateChanges: EstimateChanges;
  // SharePoint inventory, crawled read-only through Graph. Rebuildable
  // from SharePoint, but not cheaply - a full crawl of a large library is
  // tens of thousands of Graph calls.
  sharepointDrive: SharepointDrives;
  sharepointCrawl: SharepointCrawls;
  sharepointItem: SharepointItems;
}
