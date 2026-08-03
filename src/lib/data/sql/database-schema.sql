BEGIN;

---------------------------------------------------------------------
-- Drop objects if exist
-- Ordered so dependants go before their dependencies.
---------------------------------------------------------------------

DROP TABLE IF EXISTS schema_migrations;
DROP TABLE IF EXISTS enquiry_submissions;
DROP TABLE IF EXISTS enquiry_categories;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS closure_days;
DROP TABLE IF EXISTS session_attendees;
DROP TABLE IF EXISTS class_sessions;
DROP TABLE IF EXISTS class_members;
DROP TABLE IF EXISTS classes;
DROP TABLE IF EXISTS locations;
DROP TABLE IF EXISTS programs;
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

DROP TYPE IF EXISTS user_role;
DROP TYPE IF EXISTS team_role;
DROP TYPE IF EXISTS invitation_status;
DROP TYPE IF EXISTS session_status;
DROP TYPE IF EXISTS attendance_status;

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
-- Session Status (one dated occurrence of a class)
---------------------------------------------------------------------
CREATE TYPE session_status AS ENUM (
    'scheduled',
    'completed',
    'cancelled'
);

---------------------------------------------------------------------
-- Attendance Status
-- A member's status for one session (session_attendees.attendance_status).
-- 'booked' is the default written when they join a class; staff set the
-- rest per session.
---------------------------------------------------------------------
CREATE TYPE attendance_status AS ENUM (
    'booked',
    'attended',
    'absent',
    -- Set when a member cancels their own booked place (the session still
    -- runs for everyone else). Kept rather than deleted so the change is on
    -- the record, and excluded from capacity counts so the place frees up.
    'cancelled'
);

---------------------------------------------------------------------
-- Tables
---------------------------------------------------------------------

---------------------------------------------------------------------
-- Users Table
-- The centre of the model: every person is a user. Better Auth owns the
-- authentication columns; the app adds role, is_active and the small
-- profile block (phone, notification preferences, date of birth).
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
-- Sessions Table (better-auth) - login sessions, NOT class sessions.
-- The dated occurrences of a class live in class_sessions.
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
-- a client organisation, a household). Nothing creates a team implicitly:
-- an admin makes one and then adds people to it.
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
-- Programs Table
-- A named offering that classes are instances of (a course, a training
-- track, a service line).
---------------------------------------------------------------------
CREATE TABLE programs (
    id          TEXT NOT NULL PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_programs_is_active ON programs(is_active);

---------------------------------------------------------------------
-- Locations Table
-- Venues where classes run.
---------------------------------------------------------------------
CREATE TABLE locations (
    id         TEXT NOT NULL PRIMARY KEY,
    name       TEXT NOT NULL,
    address    TEXT NOT NULL,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_locations_is_active ON locations(is_active);

---------------------------------------------------------------------
-- Classes Table
-- A recurring class: a program delivered at a location, on one or more
-- weekly days (each with its own time, in the schedule JSONB), between
-- start_date and end_date, with a capacity. Dated occurrences are
-- generated into class_sessions across that range.
--
-- team_id is optional. When set, the class belongs to that team and the
-- team's managers can administer it; when NULL it is admin-only.
---------------------------------------------------------------------
CREATE TABLE classes (
    id           TEXT NOT NULL PRIMARY KEY,
    program_id   TEXT NOT NULL REFERENCES programs(id),
    location_id  TEXT NOT NULL REFERENCES locations(id),
    team_id      TEXT NULL REFERENCES teams(id) ON DELETE SET NULL,
    -- The staff member running it (optional).
    lead_user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    -- JSONB array of { day, startTime, endTime }.
    schedule     JSONB NOT NULL,
    capacity     INT NOT NULL,
    start_date   DATE NOT NULL,
    end_date     DATE NOT NULL,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT classes_capacity_positive CHECK (capacity > 0),
    CONSTRAINT classes_dates_ordered CHECK (end_date >= start_date)
);

CREATE INDEX idx_classes_program  ON classes(program_id);
CREATE INDEX idx_classes_location ON classes(location_id);
CREATE INDEX idx_classes_team     ON classes(team_id);
CREATE INDEX idx_classes_lead     ON classes(lead_user_id);
CREATE INDEX idx_classes_dates    ON classes(start_date, end_date);

---------------------------------------------------------------------
-- Class Members Table
-- A user who is in a class (a row = joined). Joining also writes that
-- user's per-session roster rows into session_attendees.
---------------------------------------------------------------------
CREATE TABLE class_members (
    id         TEXT NOT NULL PRIMARY KEY,
    class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (class_id, user_id)
);

CREATE INDEX idx_class_members_class ON class_members(class_id);
CREATE INDEX idx_class_members_user  ON class_members(user_id);

---------------------------------------------------------------------
-- Class Sessions Table
-- The individual dated occurrences of a class, generated weekly across the
-- class's start_date..end_date range.
---------------------------------------------------------------------
CREATE TABLE class_sessions (
    id            TEXT NOT NULL PRIMARY KEY,
    class_id      TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    lead_user_id  TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    session_date  DATE NOT NULL,
    session_start TIME NOT NULL,
    session_end   TIME NOT NULL,
    status        session_status NOT NULL DEFAULT 'scheduled',
    notes         TEXT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT class_sessions_times_ordered CHECK (session_end > session_start)
);

CREATE INDEX idx_class_sessions_class ON class_sessions(class_id);
CREATE INDEX idx_class_sessions_date  ON class_sessions(session_date);

---------------------------------------------------------------------
-- Session Attendees Table
-- One row per user per session: the roster, plus that user's attendance
-- status for that session.
---------------------------------------------------------------------
CREATE TABLE session_attendees (
    id                TEXT NOT NULL PRIMARY KEY,
    class_session_id  TEXT NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attendance_status attendance_status NOT NULL DEFAULT 'booked',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (class_session_id, user_id)
);

CREATE INDEX idx_session_attendees_session ON session_attendees(class_session_id);
CREATE INDEX idx_session_attendees_user    ON session_attendees(user_id);

---------------------------------------------------------------------
-- Closure Days Table
-- Dates on which no classes run (closed for any reason). Every session on
-- one of these dates is shown as cancelled on the schedule. Non-destructive:
-- removing the day restores its sessions. `reason` is shown to members.
---------------------------------------------------------------------
CREATE TABLE closure_days (
    id         TEXT NOT NULL PRIMARY KEY,
    day_date   DATE NOT NULL UNIQUE,
    reason     TEXT NOT NULL,
    created_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_closure_days_date ON closure_days(day_date);

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
    -- Who it was addressed to: 'everyone' | 'teams' | 'users' | 'classes'.
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
