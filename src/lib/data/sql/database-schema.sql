BEGIN;

---------------------------------------------------------------------
-- Drop objects if exist
-- Ordered so dependants go before their dependencies.
---------------------------------------------------------------------

DROP TABLE IF EXISTS schema_migrations;
DROP TABLE IF EXISTS enquiry_submissions;
DROP TABLE IF EXISTS enquiry_categories;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS site_content;
DROP TABLE IF EXISTS two_factor;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS verifications;
DROP TABLE IF EXISTS user_invitations;
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS users;

DROP TABLE IF EXISTS ai_chat_request_logs;
DROP TABLE IF EXISTS ai_chat_attachments;
DROP TABLE IF EXISTS ai_chat_messages;
DROP TABLE IF EXISTS ai_chat_subjects;

DROP TYPE IF EXISTS user_role;
DROP TYPE IF EXISTS team_role;
DROP TYPE IF EXISTS invitation_status;
DROP TYPE IF EXISTS ai_chat_role;
DROP TYPE IF EXISTS ai_chat_request_kind;
DROP TYPE IF EXISTS ai_chat_attachment_kind;

---------------------------------------------------------------------
-- ENUM Types
---------------------------------------------------------------------

---------------------------------------------------------------------
-- User Roles (platform-wide)
--  admin   - full access to everything
--  manager - internal staff, scoped to the teams they are assigned to
--  member  - end user; sees their own portal only
---------------------------------------------------------------------
CREATE TYPE user_role AS ENUM (
    'admin',
    'manager',
    'member'
);

---------------------------------------------------------------------
-- Team Roles (a user's role WITHIN one team)
-- Separate from the platform role above: the platform role decides which
-- area you can reach, the team role decides what you can do inside a team
-- you belong to. An admin assigns a manager to a team by creating a
-- team_members row with team_role = 'manager'.
---------------------------------------------------------------------
CREATE TYPE team_role AS ENUM (
    'manager',
    'member'
);

---------------------------------------------------------------------
-- Invitation Status
---------------------------------------------------------------------
CREATE TYPE invitation_status AS ENUM (
    'pending',
    'completed',
    'expired',
    'revoked'
);

---------------------------------------------------------------------
-- AI Chat Role
-- Who authored one turn of a conversation. Deliberately only the two
-- roles the Bedrock Converse API accepts in `messages` - a system prompt
-- is a separate top-level field there, not a message role, so it must
-- never be stored as one.
---------------------------------------------------------------------
CREATE TYPE ai_chat_role AS ENUM (
    'user',
    'assistant'
);

---------------------------------------------------------------------
-- AI Chat Request Kind
-- Which of the two calls the app makes to the model a log row records.
-- 'chat' is a reply to the user. 'summary' is the compaction call, which
-- the user never sees and which would otherwise be invisible spend.
---------------------------------------------------------------------
CREATE TYPE ai_chat_request_kind AS ENUM (
    'chat',
    'summary'
);

---------------------------------------------------------------------
-- AI Chat Attachment Kind
-- Which Converse content block a stored file becomes. The two are NOT
-- interchangeable and have different limits imposed by Bedrock (20 images
-- vs 5 documents per request), so the distinction is recorded rather than
-- re-derived from the format on every send.
---------------------------------------------------------------------
CREATE TYPE ai_chat_attachment_kind AS ENUM (
    'image',
    'document'
);

---------------------------------------------------------------------
-- Tables
---------------------------------------------------------------------

---------------------------------------------------------------------
-- Users Table
-- The centre of the model: every person is a user. Better Auth owns the
-- authentication columns; the app adds role, is_active and a small profile
-- block.
---------------------------------------------------------------------
CREATE TABLE users (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    preferred_name TEXT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    image TEXT NULL,
    role user_role NOT NULL DEFAULT 'member',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    banned BOOLEAN NOT NULL DEFAULT FALSE,
    ban_reason TEXT NULL,
    ban_expires TIMESTAMPTZ NULL,
    two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    phone_number TEXT NULL,
    -- Data retention: set when this person's personal data has been
    -- de-identified (irreversible). NULL = still identifiable.
    deidentified_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_is_active ON users(is_active);

---------------------------------------------------------------------
-- Two Factor Table (better-auth two-factor plugin)
-- One row per user who has set up TOTP 2FA. `secret` and `backup_codes`
-- are encrypted by better-auth (with BETTER_AUTH_SECRET). Managed by the
-- plugin; the app never writes here directly.
---------------------------------------------------------------------
CREATE TABLE two_factor (
    id                        TEXT NOT NULL PRIMARY KEY,
    user_id                   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    secret                    TEXT NOT NULL,
    backup_codes              TEXT NOT NULL,
    verified                  BOOLEAN NOT NULL DEFAULT TRUE,
    failed_verification_count INTEGER NOT NULL DEFAULT 0,
    locked_until              TIMESTAMPTZ NULL
);

CREATE INDEX idx_two_factor_user ON two_factor(user_id);

---------------------------------------------------------------------
-- Sessions Table (better-auth) - login sessions.
---------------------------------------------------------------------
CREATE TABLE sessions (
    id TEXT NOT NULL PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL,
    token TEXT NOT NULL UNIQUE,
    ip_address TEXT NULL,
    user_agent TEXT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    impersonated_by TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

---------------------------------------------------------------------
-- Accounts Table (better-auth)
---------------------------------------------------------------------
CREATE TABLE accounts (
    id TEXT NOT NULL PRIMARY KEY,
    account_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    access_token TEXT NULL,
    refresh_token TEXT NULL,
    id_token TEXT NULL,
    access_token_expires_at TIMESTAMPTZ NULL,
    refresh_token_expires_at TIMESTAMPTZ NULL,
    scope TEXT NULL,
    password TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_accounts_user_provider ON accounts(user_id, provider_id);

---------------------------------------------------------------------
-- Verifications Table (better-auth)
---------------------------------------------------------------------
CREATE TABLE verifications (
    id TEXT NOT NULL PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

---------------------------------------------------------------------
-- Teams Table
-- An explicitly created, named grouping of users (a cohort, a department,
-- a client organisation). Nothing creates a team implicitly: an admin makes
-- one and then adds people to it.
---------------------------------------------------------------------
CREATE TABLE teams (
    id          TEXT NOT NULL PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_teams_is_active ON teams(is_active);

---------------------------------------------------------------------
-- Team Members Table
-- Many-to-many, and optional in both directions: a user can be in no team,
-- one team, or several, and a team can be empty. team_role is the user's
-- role INSIDE this team - 'manager' is how an admin assigns a manager to a
-- team. Team membership is the app's security boundary: services resolve a
-- user's teams from the SESSION and refuse anything outside them.
---------------------------------------------------------------------
CREATE TABLE team_members (
    id         TEXT NOT NULL PRIMARY KEY,
    team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_role  team_role NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (team_id, user_id)
);

CREATE INDEX idx_team_members_team ON team_members(team_id);
CREATE INDEX idx_team_members_user ON team_members(user_id);
-- Serves "which teams does this user manage?", the manager portal's hot path.
CREATE INDEX idx_team_members_user_role ON team_members(user_id, team_role);

---------------------------------------------------------------------
-- User Invitations Table
-- Sign-up is invite-only. An invitation may optionally place the new user
-- straight into a team with a given team role.
---------------------------------------------------------------------
CREATE TABLE user_invitations (
    id         TEXT NOT NULL PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    role       user_role NOT NULL DEFAULT 'member',
    status     invitation_status NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    inviter_id TEXT NOT NULL REFERENCES users(id),
    -- Optional: drop the invitee into this team on acceptance.
    team_id    TEXT NULL REFERENCES teams(id) ON DELETE SET NULL,
    team_role  team_role NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- team_role only means anything alongside a team_id.
    CONSTRAINT user_invitations_team_role_needs_team
        CHECK (team_role IS NULL OR team_id IS NOT NULL)
);

CREATE INDEX idx_user_invitations_email ON user_invitations(email);
CREATE INDEX idx_user_invitations_team ON user_invitations(team_id);

---------------------------------------------------------------------
-- Site Content Table
-- Admin-editable content for the public site: the marketing pages, the
-- legal pages, and the structured blocks that make up the home page.
-- One row per key. Values are either sanitised HTML (rich text) or a JSON
-- string, depending on the key - see SITE_CONTENT_KEYS in the app.
---------------------------------------------------------------------
CREATE TABLE site_content (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    content_name  TEXT NOT NULL UNIQUE,
    content_value TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

---------------------------------------------------------------------
-- Enquiry Categories Table
-- Admin-managed options for the public enquiry form's category dropdown.
-- Enquiries are emailed rather than stored, so the chosen option's name is
-- all that is used; deactivating one just hides it from the form.
---------------------------------------------------------------------
CREATE TABLE enquiry_categories (
    id         TEXT NOT NULL PRIMARY KEY,
    name       TEXT NOT NULL,
    order_by   INT NOT NULL DEFAULT 1,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

---------------------------------------------------------------------
-- Enquiry Submissions Table
-- A throttling ledger: one row per enquiry email actually sent from the
-- public form, used to rate-limit per IP. The enquiry content itself is
-- emailed, never stored here. Rows are pruned after a day.
---------------------------------------------------------------------
CREATE TABLE enquiry_submissions (
    id         TEXT NOT NULL PRIMARY KEY,
    ip_address TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_enquiry_submissions_ip_created ON enquiry_submissions(ip_address, created_at);

---------------------------------------------------------------------
-- AI Chat Subjects Table
-- One conversation thread, owned by exactly one user. The sidebar lists
-- these; `title` is derived from the first message and is editable.
--
-- user_id is the ONLY authorization boundary on chat: a conversation is
-- private to its owner, and every query is scoped to the SESSION user id.
-- There is no sharing and no role override on THIS table - not even an
-- admin reads another user's rows through it.
--
-- That is not the same as "nobody else can ever see what was said": every
-- request sent to the model is copied into ai_chat_request_logs, which
-- admins can read. See the note on that table. The distinction is real -
-- these transcripts are personal working notes, and the log exists so the
-- organisation stays accountable for what it sends to a third party - but
-- do not read the paragraph above as a promise of secrecy from the
-- organisation, because it is not one.
--
-- last_message_at orders the sidebar. It is separate from updated_at so
-- renaming a conversation does not reorder the list.
---------------------------------------------------------------------
CREATE TABLE ai_chat_subjects (
    id              TEXT NOT NULL PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    last_message_at TIMESTAMPTZ NULL,
    -- Auto-compaction. `summary` replaces the turns up to and including
    -- `summary_through_message_id` in the REQUEST sent to the model; the
    -- original turns stay in ai_chat_messages and the user can still read
    -- them. NULL on a thread that has never been compacted.
    --
    -- The cursor is a message id rather than a count so it stays correct
    -- regardless of what is inserted afterwards, and it is a plain column
    -- with no foreign key: the summary must survive even if the message it
    -- points at is ever removed, and a dangling cursor degrades to "summary
    -- covers nothing" rather than breaking the thread.
    summary                    TEXT NULL,
    summary_through_message_id TEXT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Serves the sidebar: this user's conversations, most recently active first.
CREATE INDEX idx_ai_chat_subjects_user ON ai_chat_subjects(user_id, last_message_at DESC NULLS LAST);

---------------------------------------------------------------------
-- AI Chat Messages Table
-- One turn of a conversation, in the order it happened. The whole thread
-- is replayed to the model on every send, so this table IS the
-- conversation state - there is nothing stored model-side.
--
-- Token counts are recorded per assistant turn from the Converse
-- response's usage block, so spend is attributable without a separate
-- telemetry store. They are NULL on user turns and on any assistant turn
-- whose stream ended before the usage metadata arrived.
--
-- IMPORTANT: with prompt caching on, `input_tokens` is only the
-- NON-CACHED portion. Total input for a turn is
-- input_tokens + cache_read_tokens + cache_write_tokens. Reading
-- input_tokens alone under-reports, which is exactly the mistake that
-- makes caching look like it is not working.
---------------------------------------------------------------------
CREATE TABLE ai_chat_messages (
    id                 TEXT NOT NULL PRIMARY KEY,
    subject_id         TEXT NOT NULL REFERENCES ai_chat_subjects(id) ON DELETE CASCADE,
    role               ai_chat_role NOT NULL,
    content            TEXT NOT NULL,
    input_tokens       INT NULL,
    output_tokens      INT NULL,
    -- Billed at roughly a tenth of the input rate; the whole point of the
    -- cache point on the request.
    cache_read_tokens  INT NULL,
    -- Billed ABOVE the input rate. Small per turn (only the delta since the
    -- last request is written), but worth seeing.
    cache_write_tokens INT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Replaying a thread reads it in insertion order. `id` is the tiebreaker
-- because a user turn and its assistant reply can land in the same
-- microsecond, and without it Postgres may return them in either order -
-- which would send the model its own reply before the question.
CREATE INDEX idx_ai_chat_messages_subject ON ai_chat_messages(subject_id, created_at, id);

---------------------------------------------------------------------
-- AI Chat Attachments Table
-- Files a user attached to a turn - photos and documents - stored as bytes
-- and replayed to the model alongside the text on every send.
--
-- WHY THE BYTES LIVE IN POSTGRES. The Converse API takes file content
-- inline in the request, so the bytes have to be readable at send time.
-- There is no object store in this base repo, and adding one would put a
-- second stateful dependency (plus its credentials, lifecycle and its own
-- access-control surface) behind a chat feature. Keeping them here means
-- one backup, one restore, one retention policy, and deletion that cannot
-- silently leave orphaned objects paid for in a bucket. Revisit only if a
-- project starts storing files far larger than the caps below.
--
-- STAGING. `message_id` is NULL between "uploaded" and "sent": the composer
-- uploads a file as soon as it is chosen, and the turn it belongs to does
-- not exist until Send. A staged row is already owned and scoped
-- (user_id + subject_id are NOT NULL), so it is never anonymous; the send
-- claims every staged row for that conversation by setting message_id.
-- Rows still unclaimed after AI_CHAT_STAGED_ATTACHMENT_HOURS are swept by
-- the monthly job - somebody attached a file and closed the tab.
--
-- LIMITS come from Bedrock and are enforced in code, not here, because
-- they are per REQUEST rather than per row: up to 20 images of 3.75 MB and
-- 8000x8000 px, and up to 5 documents of 4.5 MB, inside a 20 MB payload.
-- Since every send replays the whole thread, those are effectively limits
-- on the conversation, not on one message - see buildConverseRequest.
--
-- PRIVACY. These bytes are as private as the transcript they belong to and
-- are served only to their owner. The admin request log records that a file
-- was sent, its name, kind and size - never its content.
---------------------------------------------------------------------
CREATE TABLE ai_chat_attachments (
    id         TEXT NOT NULL PRIMARY KEY,
    -- Denormalised owner. Ownership is derivable through message -> subject,
    -- but a staged row has no message yet, and every query in this feature
    -- is meant to carry the user id in its WHERE clause rather than reach it
    -- through a join. This column is what makes that possible on every read.
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL REFERENCES ai_chat_subjects(id) ON DELETE CASCADE,
    -- NULL while staged; set to the user turn that carried it once sent.
    message_id TEXT NULL REFERENCES ai_chat_messages(id) ON DELETE CASCADE,
    kind       ai_chat_attachment_kind NOT NULL,
    -- The Converse format token ('png', 'pdf', ...), decided by SNIFFING THE
    -- BYTES at upload - never from the filename or the browser's
    -- Content-Type, both of which the client controls.
    format     TEXT NOT NULL,
    -- The original filename, for display and download. Untrusted text: it is
    -- rendered as a text node, and a separate sanitised form is what goes to
    -- the model (Bedrock restricts the character set of a document name).
    file_name  TEXT NOT NULL,
    -- Derived from `format` server-side, for the Content-Type when serving
    -- the file back. Never the value the browser claimed at upload.
    media_type TEXT NOT NULL,
    byte_size  INT NOT NULL,
    -- Image pixel dimensions, parsed from the file header at upload so an
    -- oversized image is refused immediately rather than by Bedrock after
    -- the user has waited for a send. NULL on documents.
    width      INT NULL,
    height     INT NULL,
    bytes      BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Replaying a thread loads every attachment for the conversation in one
-- pass and groups them by message.
CREATE INDEX idx_ai_chat_attachments_subject ON ai_chat_attachments(subject_id, message_id);

-- Serves the staged-row sweep, which looks only at unclaimed rows.
CREATE INDEX idx_ai_chat_attachments_staged ON ai_chat_attachments(created_at) WHERE message_id IS NULL;

---------------------------------------------------------------------
-- AI Chat Request Logs Table
-- What was ACTUALLY sent to the model on each call, for admin review.
--
-- Deliberately not reconstructable from ai_chat_messages: once a thread has
-- been compacted, the request carries a summary in place of the old turns,
-- so replaying the transcript would show something that was never sent.
-- This table is the record of the real payload.
--
-- PRIVACY. These rows contain the full text of private conversations, and
-- an admin can read them. That is the point of the feature, and it is a
-- deliberate exception to the rule that a chat belongs only to its owner -
-- so the page that reads this table is admin-only, opening one payload
-- writes an audit entry naming the admin and the subject user, and the chat
-- UI tells users their conversations are visible to administrators. Do not
-- widen access to this table without revisiting all three.
--
-- STORAGE. Every send logs the whole conversation as sent, so a thread of N
-- turns writes N rows of up to N turns each - storage grows with the SQUARE
-- of thread length. Compaction bounds it in practice, and
-- AI_CHAT_LOG_RETENTION_DAYS (shorter than the chat window by default) is
-- what actually keeps it in check. Watch this table's size before widening
-- that window.
---------------------------------------------------------------------
CREATE TABLE ai_chat_request_logs (
    id            TEXT NOT NULL PRIMARY KEY,
    -- Soft references: a log row outlives the conversation it describes, and
    -- deleting a chat must not erase the record that it was sent. The user
    -- reference does cascade, because a de-identified person's transcripts
    -- should not survive them.
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id    TEXT NULL,
    kind          ai_chat_request_kind NOT NULL,
    model_id      TEXT NOT NULL,
    region        TEXT NOT NULL,
    -- The exact request as sent. `system_blocks` and `messages` are the two
    -- arrays handed to Converse, verbatim, including the cachePoint marker.
    system_blocks JSONB NOT NULL,
    messages      JSONB NOT NULL,
    -- True when the payload was too large to store whole (see the cap in the
    -- repository). Recorded so a truncated row never passes as complete.
    truncated     BOOLEAN NOT NULL DEFAULT FALSE,
    -- Usage, mirroring ai_chat_messages. NULL when the call failed before
    -- returning any.
    input_tokens       INT NULL,
    output_tokens      INT NULL,
    cache_read_tokens  INT NULL,
    cache_write_tokens INT NULL,
    -- NULL when the call succeeded; the error name/message when it did not.
    -- A failed call is exactly when an admin most wants to see the payload.
    error         TEXT NULL,
    duration_ms   INT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The viewer lists newest-first, optionally filtered to one person.
CREATE INDEX idx_ai_chat_request_logs_created ON ai_chat_request_logs(created_at DESC);
CREATE INDEX idx_ai_chat_request_logs_user ON ai_chat_request_logs(user_id, created_at DESC);

---------------------------------------------------------------------
-- Audit Logs Table
-- Append-only trail of changes to sensitive data and of authentication
-- events, so an owner can trace who changed what and when. `actor_*` are
-- snapshotted so the trail survives a user being renamed or deleted.
-- `changes`/`metadata` are JSONB. entity/team/user ids are soft references
-- (no FK) so deleting the subject never removes or blocks its history.
---------------------------------------------------------------------
CREATE TABLE audit_logs (
    id             TEXT NOT NULL PRIMARY KEY,
    actor_user_id  TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    actor_role     TEXT NULL,
    actor_name     TEXT NULL,
    action         TEXT NOT NULL,
    entity_type    TEXT NOT NULL,
    entity_id      TEXT NULL,
    -- Soft scope references for filtering the trail.
    team_id        TEXT NULL,
    subject_user_id TEXT NULL,
    summary        TEXT NULL,
    changes        JSONB NULL,
    metadata       JSONB NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_team       ON audit_logs(team_id, created_at DESC);
CREATE INDEX idx_audit_logs_subject    ON audit_logs(subject_user_id, created_at DESC);
CREATE INDEX idx_audit_logs_actor      ON audit_logs(actor_user_id);
CREATE INDEX idx_audit_logs_action     ON audit_logs(action);
CREATE INDEX idx_audit_logs_entity     ON audit_logs(entity_type, entity_id);

---------------------------------------------------------------------
-- Schema Migrations Table
-- Records which delta files have been applied. This file is the baseline;
-- later changes go in migrations/NNN_*.sql.
---------------------------------------------------------------------
CREATE TABLE schema_migrations (
    filename   TEXT NOT NULL PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO schema_migrations (filename) VALUES ('000_initial_schema.sql');

COMMIT;
