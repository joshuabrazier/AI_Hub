---------------------------------------------------------------------
-- Delivery: clients, projects, phases, tasks and the time logged to them
--
-- This is the app's own delivery model, and it REPLACES Jira as the source
-- of truth for what work exists and how long it took. The Jira tables
-- (jira_project, jira_issue, worklog_fact, manual_worklog, staff_rate,
-- staff_target) are deliberately left alone by this migration: they hold
-- real history, and nothing is dropped until the reporting screens have
-- been re-pointed and the numbers reconciled. Retiring them is a separate,
-- later, deliberate act.
--
-- THE SHAPE, and where it differs from Jira's:
--
--   client -> project -> PHASE -> task -> time entry
--
-- Jira had no phase. It is a real level here, because a board is split by
-- phase and a phase is how a project is actually reported on internally.
--
-- FOUR DECISIONS BAKED INTO THIS FILE, all of them answers to questions
-- that had more than one reasonable answer:
--
--   1. TIME IS INTEGER MINUTES, never a float of hours. "0.5" and "1.5"
--      are what somebody types; 30 and 90 are what is stored. Totalling a
--      month of floating-point hours drifts, and a billing total that is
--      out by a cent for no visible reason is the worst kind of wrong.
--
--   2. MONEY IS INTEGER CENTS, matching staff_rate, for the same reason.
--
--   3. A RATE IS CAPTURED ON THE TIME ENTRY, not derived when a report
--      runs. An hour is worth what it was worth when it was worked. If
--      somebody's rate changes in July, June's margin must not silently
--      restate itself - and correcting history should be a deliberate act
--      rather than a side effect of a rate edit.
--
--   4. work_date IS A `DATE`, so it arrives as a 'YYYY-MM-DD' STRING.
--      The pg type parser in kysely-database-client.ts maps DATE to a
--      string on purpose - timezone-safe and React-renderable. Type it as
--      `string` in TypeScript and compare it lexicographically. Do NOT
--      turn it into a Date.
--
--      (CLAUDE.md still says no table has a DATE column. That was true of
--      the base repo and is not true here: worklog_fact.work_date,
--      manual_worklog.work_date and staff_rate.effective_from all predate
--      this migration, and are all typed as strings for the same reason.)
---------------------------------------------------------------------

BEGIN;

---------------------------------------------------------------------
-- Enumerations
---------------------------------------------------------------------

-- Where a project is up to. `archived` is the soft delete: time entries
-- reference tasks, so a project is never actually removed.
CREATE TYPE project_status AS ENUM (
    'active',
    'on_hold',
    'completed',
    'archived'
);

-- The three rates a person can be charged at. Which one applies is decided
-- PER PROJECT MEMBER, so one person can be discounted on one client and
-- standard on another.
CREATE TYPE rate_band AS ENUM (
    'discounted',
    'standard',
    'high'
);

-- The four columns of every board. Fixed rather than configurable: a board
-- whose columns differ per project cannot be reported on across projects,
-- and "blocked" as a first-class column is the whole reason to have it.
CREATE TYPE task_column AS ENUM (
    'todo',
    'in_progress',
    'blocked',
    'done'
);

---------------------------------------------------------------------
-- Clients
--
-- Who the work is for. Created inline while setting up a project, or
-- picked from the ones that exist - which is why the name is unique
-- case-insensitively. Without that, "Perks" and "perks" both exist and
-- every report about either is half right.
---------------------------------------------------------------------
CREATE TABLE clients (
    id         TEXT NOT NULL PRIMARY KEY,
    name       TEXT NOT NULL,
    notes      TEXT NULL,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT clients_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX idx_clients_name_unique ON clients (lower(btrim(name)));

---------------------------------------------------------------------
-- Projects
--
-- One project belongs to one client. ON DELETE RESTRICT on the client
-- rather than CASCADE: deleting a client that has projects would take
-- their time entries with it, which is billing history.
--
-- `budget_assigned_at` is the one odd column and it is deliberate. When a
-- project is created, the setup screen shows a progress bar of how much of
-- the project's budget has been assigned to tasks. That prompt is a
-- one-time nudge, not a rule: it stops appearing once the budget has been
-- allocated once, and it does NOT come back if the estimate later drops
-- below the total again. A timestamp rather than a boolean, because
-- knowing when somebody finished planning is occasionally useful and costs
-- nothing.
---------------------------------------------------------------------
CREATE TABLE projects (
    id          TEXT NOT NULL PRIMARY KEY,
    client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    title       TEXT NOT NULL,
    description TEXT NULL,
    -- Whether the time on it can go on an invoice. Same meaning as the
    -- Jira-era `billable` flag, but a real boolean rather than three-valued:
    -- there is no "unset" here because a project is created by an admin who
    -- is asked the question.
    is_billable BOOLEAN NOT NULL DEFAULT TRUE,
    status      project_status NOT NULL DEFAULT 'active',
    budget_assigned_at TIMESTAMPTZ NULL,
    created_by  TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT projects_title_not_blank CHECK (length(btrim(title)) > 0),
    -- Needed so phases and tasks can carry a composite foreign key back to
    -- the project they claim to be in. Redundant against the primary key,
    -- and that is fine - it exists to be referenced.
    CONSTRAINT projects_id_self_unique UNIQUE (id, client_id)
);

CREATE INDEX idx_projects_client ON projects (client_id, status);

---------------------------------------------------------------------
-- Project membership
--
-- THE SECURITY BOUNDARY OF THIS WHOLE MODULE. Only somebody in this table
-- can see a project, its board or its tasks; an admin sees everything.
-- Every read in the feature carries a predicate against it, in the same
-- way team membership works elsewhere in the app.
--
-- `is_lead` is the second gate: only a lead may create or edit tasks.
-- Ordinary members log time against the tasks a lead created.
--
-- `rate_band` lives HERE rather than on the user, because which of a
-- person's three rates applies is a per-project decision - the same person
-- can be discounted for one client and standard for another.
---------------------------------------------------------------------
CREATE TABLE project_members (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_lead    BOOLEAN NOT NULL DEFAULT FALSE,
    rate_band  rate_band NOT NULL DEFAULT 'standard',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, user_id)
);

-- The left-hand nav: every project this person is on. The hottest query in
-- the feature, run on every page load.
CREATE INDEX idx_project_members_user ON project_members (user_id);

---------------------------------------------------------------------
-- Budget groups
--
-- "These two interns have 400 hours between them; this principal has 50."
-- A named bundle of specific people with a POOLED budget, created per
-- project - not a global seniority band, because the split that makes
-- sense differs from one engagement to the next.
--
-- A person may be in AT MOST ONE group per project, and that is enforced
-- by the database rather than by remembering to check: `project_id` is
-- carried on the membership row so a unique index can cover
-- (project_id, user_id), and a composite foreign key stops that column
-- disagreeing with the group's own project.
---------------------------------------------------------------------
CREATE TABLE project_budget_groups (
    id             TEXT NOT NULL PRIMARY KEY,
    project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    budget_minutes INTEGER NOT NULL DEFAULT 0,
    position       INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT budget_groups_name_not_blank CHECK (length(btrim(name)) > 0),
    CONSTRAINT budget_groups_minutes_non_negative CHECK (budget_minutes >= 0),
    -- Referenced by the composite key below.
    CONSTRAINT budget_groups_id_project_unique UNIQUE (id, project_id)
);

CREATE INDEX idx_budget_groups_project ON project_budget_groups (project_id, position);

CREATE TABLE project_budget_group_members (
    group_id   TEXT NOT NULL,
    project_id TEXT NOT NULL,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id),
    -- One group per person per project.
    CONSTRAINT budget_group_members_one_per_project UNIQUE (project_id, user_id),
    FOREIGN KEY (group_id, project_id)
        REFERENCES project_budget_groups (id, project_id) ON DELETE CASCADE
);

---------------------------------------------------------------------
-- Phases
--
-- The level Jira did not have. A project's board is split into one board
-- per phase, so a phase is a heading with an order rather than a status.
---------------------------------------------------------------------
CREATE TABLE phases (
    id         TEXT NOT NULL PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT phases_name_not_blank CHECK (length(btrim(name)) > 0),
    CONSTRAINT phases_id_project_unique UNIQUE (id, project_id)
);

CREATE INDEX idx_phases_project ON phases (project_id, position);

---------------------------------------------------------------------
-- Tasks
--
-- `project_id` IS DENORMALISED ONTO THIS TABLE ON PURPOSE. Every board
-- read, every authorization check and every timesheet row needs to know
-- which project a task belongs to, and joining through phases to find out
-- would put a join in front of the most common query in the feature. The
-- composite foreign key against (phase_id, project_id) is what stops the
-- two disagreeing, so the denormalisation cannot rot.
--
-- `position` orders a task within its column. A float or a gap-based
-- integer would avoid rewriting siblings on every drag; plain integers are
-- used because a column holds tens of cards, not thousands, and rewriting
-- ten rows is cheaper than explaining fractional ordering to the next
-- person to read this.
---------------------------------------------------------------------
CREATE TABLE tasks (
    id           TEXT NOT NULL PRIMARY KEY,
    phase_id     TEXT NOT NULL,
    project_id   TEXT NOT NULL,
    title        TEXT NOT NULL,
    description  TEXT NULL,
    estimate_minutes INTEGER NOT NULL DEFAULT 0,
    board_column task_column NOT NULL DEFAULT 'todo',
    position     INTEGER NOT NULL DEFAULT 0,
    assignee_id  TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_by   TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT tasks_title_not_blank CHECK (length(btrim(title)) > 0),
    CONSTRAINT tasks_estimate_non_negative CHECK (estimate_minutes >= 0),
    FOREIGN KEY (phase_id, project_id) REFERENCES phases (id, project_id) ON DELETE CASCADE,
    -- Referenced by time_entries, so an entry cannot claim a task in a
    -- different project from the one it bills.
    CONSTRAINT tasks_id_project_unique UNIQUE (id, project_id)
);

CREATE INDEX idx_tasks_board ON tasks (project_id, phase_id, board_column, position);

-- "My work": every task assigned to one person across all their projects,
-- which the per-project board cannot show. Partial, because most tasks are
-- unassigned and indexing those buys nothing.
CREATE INDEX idx_tasks_assignee ON tasks (assignee_id)
    WHERE assignee_id IS NOT NULL;

---------------------------------------------------------------------
-- Task attachments
--
-- Metadata only. THE FILE ITSELF LIVES IN AZURE BLOB, addressed by
-- `storage_key`, exactly as chat attachments and transcription media do -
-- and it carries the same sharp edge: a Postgres cascade CANNOT delete a
-- blob. Every path that removes these rows has to clear storage FIRST, and
-- the monthly job needs a reconciliation pass for whatever a cascade
-- removed behind its back.
---------------------------------------------------------------------
CREATE TABLE task_attachments (
    id          TEXT NOT NULL PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL UNIQUE,
    file_name   TEXT NOT NULL,
    -- Server-derived from the bytes, never taken from the browser.
    media_type  TEXT NOT NULL,
    byte_size   BIGINT NOT NULL,
    uploaded_by TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT task_attachments_size_positive CHECK (byte_size > 0)
);

CREATE INDEX idx_task_attachments_task ON task_attachments (task_id);

---------------------------------------------------------------------
-- Rates
--
-- Three named bands per person, EFFECTIVE-DATED. The dating is what keeps
-- history honest: raising somebody's rate in July must not restate June's
-- margin. A rate is looked up by the latest `effective_from` on or before
-- the work date.
--
-- Keyed on users(id), unlike the Jira-era staff_rate which keyed on an
-- Atlassian account id. That table is left in place for the history it
-- holds and is not read by this module.
--
-- Admin-only, in the service. There is nothing in this schema that stops a
-- read, so the guard is not optional.
---------------------------------------------------------------------
CREATE TABLE user_rates (
    id                TEXT NOT NULL PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    band              rate_band NOT NULL,
    charge_rate_cents INTEGER NOT NULL,
    -- What the hour costs the business. Nullable because charge rates are
    -- known long before anybody wants to model cost, and a project is
    -- perfectly reportable on revenue alone until then.
    cost_rate_cents   INTEGER NULL,
    effective_from    DATE NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_rates_one_per_band_per_day UNIQUE (user_id, band, effective_from),
    CONSTRAINT user_rates_charge_non_negative CHECK (charge_rate_cents >= 0),
    CONSTRAINT user_rates_cost_non_negative
        CHECK (cost_rate_cents IS NULL OR cost_rate_cents >= 0)
);

CREATE INDEX idx_user_rates_lookup ON user_rates (user_id, band, effective_from DESC);

---------------------------------------------------------------------
-- Time entries
--
-- One person, one task, one day, some minutes. Enterable from a task on
-- the board or from the timesheet grid; there is no difference in the row,
-- which is why both screens can show the same entry.
--
-- THE RATES ARE SNAPSHOTS. See the note at the top of this file: an hour
-- is worth what it was worth when it was worked. They are nullable because
-- a non-billable project has nothing to charge, and because cost may not
-- be modelled yet.
--
-- ON DELETE RESTRICT on user_id, and it is safe: this app DE-IDENTIFIES
-- dormant people in place rather than deleting them, so the row survives a
-- scrub and keeps a valid reference. What the restriction does buy is a
-- guarantee that nobody can make a quarter of billing history disappear by
-- removing an account.
---------------------------------------------------------------------
CREATE TABLE time_entries (
    id         TEXT NOT NULL PRIMARY KEY,
    task_id    TEXT NOT NULL,
    project_id TEXT NOT NULL,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    -- 'YYYY-MM-DD'. A string in TypeScript - see the note at the top.
    work_date  DATE NOT NULL,
    minutes    INTEGER NOT NULL,
    notes      TEXT NULL,
    charge_rate_cents INTEGER NULL,
    cost_rate_cents   INTEGER NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- A day has 1440 minutes. Anything beyond it is a typo, and the same
    -- sanity check manual_worklog already applies.
    CONSTRAINT time_entries_minutes_sane CHECK (minutes > 0 AND minutes <= 1440),
    FOREIGN KEY (task_id, project_id) REFERENCES tasks (id, project_id) ON DELETE RESTRICT
);

-- The timesheet grid: one person's week.
CREATE INDEX idx_time_entries_person_week ON time_entries (user_id, work_date);

-- Budget rollups, and the project board's logged-versus-estimate figures.
CREATE INDEX idx_time_entries_project ON time_entries (project_id, work_date);

-- A task's own log, shown on the card.
CREATE INDEX idx_time_entries_task ON time_entries (task_id);

---------------------------------------------------------------------
-- Estimate changes
--
-- An append-only record of every adjustment to a task's estimate, kept
-- BESIDE the current value on `tasks` rather than replacing it.
--
-- Why it earns a table: the spec allows an estimate to be increased either
-- by adding to the project's total or by TAKING the minutes from another
-- task, possibly in a different phase. That second form is a transfer, and
-- a transfer with no record is indistinguishable from someone quietly
-- moving budget around to hide an overrun. When a project goes over, the
-- first question is what moved and who moved it.
--
-- `from_task_id` NULL means the project's total went up. Non-null means
-- these minutes came out of that task.
---------------------------------------------------------------------
CREATE TABLE estimate_changes (
    id           TEXT NOT NULL PRIMARY KEY,
    task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    from_task_id TEXT NULL REFERENCES tasks(id) ON DELETE SET NULL,
    -- Signed: a reduction is a negative number, so the log sums to the
    -- difference between the original estimate and the current one.
    minutes      INTEGER NOT NULL,
    reason       TEXT NULL,
    changed_by   TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT estimate_changes_not_zero CHECK (minutes <> 0),
    -- Taking minutes from the task they are being added to is a no-op
    -- dressed up as an audit entry.
    CONSTRAINT estimate_changes_not_self CHECK (from_task_id IS NULL OR from_task_id <> task_id)
);

CREATE INDEX idx_estimate_changes_task ON estimate_changes (task_id, created_at DESC);

INSERT INTO schema_migrations (filename) VALUES ('016_delivery_projects.sql');

COMMIT;
