---------------------------------------------------------------------
-- 008 Manual worklogs, and the Jira identity link
--
-- Somewhere for time entered IN THIS APP to live, for the case the whole
-- feature exists for: somebody forgot to fill in their timesheet in Jira.
--
-- WHY NOT worklog_fact. That table is the Jira read model: migration 001 says
-- everything in it is derived and rebuildable, and the sync DELETES rows it no
-- longer sees in Jira. A manual entry written there would be destroyed by the
-- next sync - not a risk, a certainty. So manual time gets its own table, and
-- it is the only copy of what it holds. It is therefore the one timesheet
-- table that is NOT rebuildable and must be included in whatever backs this
-- database up.
--
-- THE COST OF THIS CHOICE, stated plainly because it does not go away: there
-- are now two sources of truth for billable time. The failure mode is DOUBLE
-- COUNTING - somebody enters an hour here, remembers later and logs it in Jira
-- too, and both reach an invoice. Nothing in the schema can prevent that, so
-- it is handled where it can be: manual rows are marked as manual everywhere
-- they surface, and the review pass raises a finding when a Jira worklog
-- appears for the same person, day and issue.
--
-- BILLABLE IS NOT A COLUMN HERE, deliberately. In the read model, billable
-- comes from the issue or its parent, never from the person logging the time.
-- A manual entry inherits it the same way at read time. Letting somebody set
-- it would let them mark their own hours chargeable, which is a decision about
-- an invoice rather than about a timesheet.
--
-- SECONDS AS INTEGERS, like the rest of the read model. See migration 001 for
-- why nothing here is NUMERIC.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f src/lib/data/sql/migrations/008_manual_worklog.sql
---------------------------------------------------------------------
BEGIN;

-- -------------------------------------------------------------------
-- The identity link.
--
-- The read model is keyed on the Atlassian accountId; a user row is keyed on
-- this app's own id, and until now nothing joined the two. That is why the ask
-- box had to match "I" against a DISPLAY NAME, which is fine for choosing a
-- filter and nowhere near good enough for writing time against somebody.
--
-- SERVER-ASSIGNED, like `role` and `is_active`. A person may not choose which
-- Atlassian account their time is filed against - that would let anybody log
-- hours as anybody. An admin sets it from the people the read model already
-- knows about.
--
-- UNIQUE, so two accounts cannot claim the same Jira identity. NULL until set,
-- and a NULL means self-service entry is unavailable for that person rather
-- than guessed at.
-- -------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS atlassian_account_id TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_atlassian_account
    ON users(atlassian_account_id)
    WHERE atlassian_account_id IS NOT NULL;

DROP TABLE IF EXISTS manual_worklog;

CREATE TABLE manual_worklog (
    id                 TEXT NOT NULL PRIMARY KEY,
    -- WHOSE TIME IT IS, as the Atlassian accountId, so it lines up with every
    -- other timesheet table. Not a FK: the read model is rebuildable and its
    -- person rows come and go with the sync, whereas this row must not.
    person_id          TEXT NOT NULL,
    -- Snapshotted for display, so an entry still reads sensibly for somebody
    -- with no synced time in the period being viewed.
    person_name        TEXT NULL,

    -- WHO TYPED IT, which is not always whose time it is: an admin may enter
    -- on somebody's behalf. Kept for accountability, with the name snapshotted
    -- beside the id the way audit_logs does it.
    entered_by         TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    entered_by_name    TEXT NULL,

    -- The Jira issue the time is against. A soft reference to jira_issue for
    -- the same reason as person_id: that table is derived and this one is not.
    -- Billable status and the parent job are resolved through it at read time.
    issue_key          TEXT NOT NULL,

    work_date          DATE NOT NULL,
    time_spent_seconds INTEGER NOT NULL,

    -- What was done. The equivalent of a Jira worklog comment, and the reason
    -- the entry is worth having at all: an hour with no description is not
    -- invoiceable, here or in Jira.
    notes              TEXT NULL,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- A day of somebody's time, bounded either side. Zero is not an entry and
    -- 24 hours in one day on one issue is a typo, not a week of work.
    CONSTRAINT manual_worklog_duration_sane
        CHECK (time_spent_seconds > 0 AND time_spent_seconds <= 86400)
);

-- The two reads this table gets: a person's own week, and a period across
-- everybody for the report merge.
CREATE INDEX idx_manual_worklog_person_date ON manual_worklog(person_id, work_date);
CREATE INDEX idx_manual_worklog_date ON manual_worklog(work_date);
CREATE INDEX idx_manual_worklog_issue ON manual_worklog(issue_key);

INSERT INTO schema_migrations (filename) VALUES ('008_manual_worklog.sql');

COMMIT;
