BEGIN;

---------------------------------------------------------------------
-- Drop objects if exist
-- Ordered so dependants go before their dependencies.
---------------------------------------------------------------------

DROP TABLE IF EXISTS schema_migrations;
DROP TABLE IF EXISTS enquiry_submissions;
DROP TABLE IF EXISTS enquiry_categories;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS document_signatures;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS notification_broadcasts;
DROP TABLE IF EXISTS notification_templates;
DROP TABLE IF EXISTS notification_types;
DROP TABLE IF EXISTS site_content;
DROP TABLE IF EXISTS two_factor;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS verifications;
DROP TABLE IF EXISTS user_invitations;
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS users;

DROP TABLE IF EXISTS ai_chat_messages;
DROP TABLE IF EXISTS ai_chat_subjects;

DROP TYPE IF EXISTS user_role;
DROP TYPE IF EXISTS team_role;
DROP TYPE IF EXISTS invitation_status;
DROP TYPE IF EXISTS ai_chat_role;

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
-- Tables
---------------------------------------------------------------------

---------------------------------------------------------------------
-- Users Table
-- The centre of the model: every person is a user. Better Auth owns the
-- authentication columns; the app adds role, is_active and the small
-- profile block (phone, notification preferences).
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
    -- Per-notification-type email preferences, keyed by the notification
    -- type's key. An absent key means enabled (opt-out model).
    notification_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
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
-- Documents Table
-- The signable documents, as data rather than a hardcoded enum, so a
-- project can add one without a schema or code change. `content_key` names
-- the site_content row holding the wording; bump `version` when a change
-- should force everyone to re-sign.
---------------------------------------------------------------------
CREATE TABLE documents (
    id          TEXT NOT NULL PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    version     TEXT NOT NULL DEFAULT '1.0',
    content_key TEXT NOT NULL,
    -- Whether every member must sign it before using the portal.
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    order_by    INT NOT NULL DEFAULT 1,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

---------------------------------------------------------------------
-- Document Signatures Table
-- One immutable record per document a user signs. The exact title, version
-- and text signed are snapshotted so later edits never change what was
-- already signed. document_key is snapshotted too, so history survives the
-- document row being renamed or deleted. signer_name and signature_image
-- are encrypted at the application layer (field-level).
---------------------------------------------------------------------
CREATE TABLE document_signatures (
    id               TEXT NOT NULL PRIMARY KEY,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_id      TEXT NULL REFERENCES documents(id) ON DELETE SET NULL,
    document_key     TEXT NOT NULL,
    document_version TEXT NOT NULL,
    document_title   TEXT NOT NULL,
    document_content TEXT NOT NULL,
    signer_name      TEXT NOT NULL,
    signature_image  TEXT NOT NULL,
    signed_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address       TEXT NULL,
    user_agent       TEXT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_document_signatures_user     ON document_signatures(user_id);
CREATE INDEX idx_document_signatures_user_key ON document_signatures(user_id, document_key);

---------------------------------------------------------------------
-- Notification Types Table
-- Admin-managed list of notification categories for the send/template
-- pickers. `key` is the stable value stored on notifications, broadcasts
-- and templates; `name` is the label. Deactivating a type hides it from the
-- pickers without touching history.
---------------------------------------------------------------------
CREATE TABLE notification_types (
    id          TEXT NOT NULL PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT NULL,
    order_by    INT NOT NULL DEFAULT 1,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

---------------------------------------------------------------------
-- Notification Templates Table
-- Reusable content an admin can fill the compose form from, or save the
-- current draft into. Holds type/title/body only - the audience is always
-- chosen at send time.
---------------------------------------------------------------------
CREATE TABLE notification_templates (
    id         TEXT NOT NULL PRIMARY KEY,
    created_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT NULL,
    -- System templates (fixed ids) back a built-in feature and can't be
    -- deleted; looked up by id, not by name.
    is_system  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

---------------------------------------------------------------------
-- Notification Broadcasts Table
-- The message a staff member sends. Each recipient gets their own row in
-- `notifications` referencing the broadcast.
---------------------------------------------------------------------
CREATE TABLE notification_broadcasts (
    id             TEXT NOT NULL PRIMARY KEY,
    created_by     TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    type           TEXT NOT NULL,
    -- Who it was addressed to: 'everyone' | 'teams' | 'users'.
    -- audience_label is a denormalised human summary for display.
    audience_type  TEXT NOT NULL DEFAULT 'everyone',
    audience_label TEXT NULL,
    title          TEXT NOT NULL,
    body           TEXT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

---------------------------------------------------------------------
-- Notifications Table
-- One row per recipient. Backs the portal's Notifications tab, the unread
-- badge in the nav, and the staff notifications view. `broadcast_id` links
-- a recipient's copy to the broadcast it came from; NULL for standalone or
-- system notifications. `read_at` is NULL until the recipient reads it -
-- that is what drives the unread count and the nav dot.
---------------------------------------------------------------------
CREATE TABLE notifications (
    id           TEXT NOT NULL PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    broadcast_id TEXT NULL REFERENCES notification_broadcasts(id) ON DELETE CASCADE,
    type         TEXT NOT NULL,
    title        TEXT NOT NULL,
    body         TEXT NULL,
    read_at      TIMESTAMPTZ NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_user      ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_broadcast ON notifications(broadcast_id);
-- Partial index: the unread badge asks "any unread for me?" on every
-- navigation, and only unread rows are ever in the answer.
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

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
-- There is no sharing, and no staff override - an admin cannot read
-- somebody else's chat, deliberately, because these transcripts are
-- personal working notes rather than organisational records.
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
