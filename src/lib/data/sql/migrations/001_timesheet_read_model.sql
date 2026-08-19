---------------------------------------------------------------------
-- 001 Timesheet read model
--
-- The Jira-derived read model. Jira remains the source of truth for time;
-- everything here is derived and can be dropped and rebuilt from Jira at any
-- point. That property is what makes it safe to iterate on, so nothing in
-- this file may be the only copy of anything.
--
-- Apply manually (there is no migration runner), then it records itself:
--   psql "$DATABASE_URL" -f src/lib/data/sql/migrations/001_timesheet_read_model.sql
--
---------------------------------------------------------------------
-- On why there is no NUMERIC column in here
--
-- node-postgres returns NUMERIC and BIGINT as JavaScript STRINGS, to avoid
-- silently losing precision. Nothing warns you: `total + row.hours` then
-- concatenates instead of adding, and "7.5" + "2.5" is "7.52.5". On a page
-- that decides an invoice, that is not a bug you want to be one type parser
-- away from.
--
-- So every quantity here is an INTEGER in its smallest natural unit - seconds
-- for durations, seconds-past-midnight for clock positions. int4 is parsed to
-- a real JavaScript number, sums are exact with no floating point drift, and
-- hours are derived for display (seconds / 3600.0) rather than stored. That
-- also satisfies the rule against storing a total you can recompute.
---------------------------------------------------------------------
BEGIN;

---------------------------------------------------------------------
-- Jira Issues Table
-- The issue cache behind the facts: the deliverable a worklog was booked to,
-- and the Project item above it. Held so aggregation and narrative drafting
-- can read issue detail without going back to the Jira API.
--
-- `billable` is what the issue ITSELF declares, which is frequently NULL - on
-- every entry seen so far the value is inherited from the parent rather than
-- set on the item. The fact table records which of the two it came from,
-- because re-parenting an issue silently changes its billing status.
---------------------------------------------------------------------
CREATE TABLE jira_issue (
    issue_key         TEXT NOT NULL PRIMARY KEY,
    parent_key        TEXT NULL,
    project_key       TEXT NOT NULL,
    issue_type        TEXT NULL,
    summary           TEXT NOT NULL,
    description       TEXT NULL,
    -- 'Internal' | 'External', as set in Jira. Free text on purpose: a value
    -- nobody expected must land in the read model and surface as a finding,
    -- not be rejected at write time and lose the worklog with it.
    category          TEXT NULL,
    -- 'Billable' | 'Non-billable' | NULL when the item does not declare it.
    billable          TEXT NULL,
    -- Budget. baseline is what was agreed at the start, current the latest
    -- view. Actuals are never stored here - they are summed from worklog_fact.
    baseline_estimate_seconds INTEGER NULL,
    current_estimate_seconds  INTEGER NULL,
    status            TEXT NULL,
    jira_updated_at   TIMESTAMPTZ NULL,
    synced_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_jira_issue_parent  ON jira_issue(parent_key);
CREATE INDEX idx_jira_issue_project ON jira_issue(project_key);

---------------------------------------------------------------------
-- Worklog Fact Table
-- One row per worklog, never per issue. The grain is the thing: an issue-level
-- row cannot answer "who did this, on what day", and cannot be re-synced
-- idempotently.
--
-- Four rules hold this table together:
--   1. The primary key is Jira's own worklog ID, so re-running a sync
--      overwrites rather than duplicates. This is the single most important
--      defence against double-counting, and therefore against over-invoicing.
--   2. person_id is the Atlassian accountId, never a display name. People
--      change surnames; their history must not detach when they do.
--   3. work_date is Adelaide-local, not UTC. A 9am Adelaide entry is 23:30 the
--      previous day in UTC, so a UTC date is wrong for part of every day, and
--      wrong differently either side of the October DST change.
--   4. No derived total lives here. Sum the facts. A cached total is how two
--      reports start disagreeing about the same month.
---------------------------------------------------------------------
CREATE TABLE worklog_fact (
    worklog_id      TEXT NOT NULL PRIMARY KEY,
    issue_key       TEXT NOT NULL,
    -- Denormalised from jira_issue at sync time so the fact table can be
    -- aggregated on its own. Refreshed whenever the issue is re-synced.
    parent_key      TEXT NULL,
    project_key     TEXT NOT NULL,
    category        TEXT NULL,
    person_id       TEXT NOT NULL,
    -- Display name at sync time, so a name can be shown without a second
    -- lookup. Never join on this and never group by it: it is a label,
    -- person_id is the identity.
    person_name     TEXT NULL,
    work_date       DATE NOT NULL,
    -- Seconds past Adelaide-local midnight, so two entries booked over the
    -- same clock time can be detected as an overlap. NULL when Jira gave no
    -- start time, in which case the overlap rule SKIPS that worklog rather
    -- than assuming it starts at midnight and inventing a collision.
    start_second    INTEGER NULL,
    -- Whole seconds exactly as Jira recorded them. Hours are derived for
    -- display (time_spent_seconds / 3600.0), never stored.
    time_spent_seconds INTEGER NOT NULL,
    -- 'Billable' | 'Non-billable' | NULL. Resolved at sync time from the
    -- issue, falling back to the parent.
    billable        TEXT NULL,
    -- 'issue' | 'parent' | 'unset'. Which of the two the value above came
    -- from. An inherited value is a finding, not an error: it still bills,
    -- but it changes silently if the item is re-parented.
    billable_source TEXT NOT NULL DEFAULT 'unset',
    -- The client-readable work description as it stands in Jira.
    narrative       TEXT NULL,
    -- Generated, never written by hand, so it cannot drift from the text it
    -- describes.
    has_narrative   BOOLEAN GENERATED ALWAYS AS (
        narrative IS NOT NULL AND length(btrim(narrative)) > 0
    ) STORED,
    jira_updated_at TIMESTAMPTZ NULL,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The questions every dashboard panel asks.
CREATE INDEX idx_worklog_fact_person_date ON worklog_fact(person_id, work_date);
CREATE INDEX idx_worklog_fact_date        ON worklog_fact(work_date);
CREATE INDEX idx_worklog_fact_project     ON worklog_fact(project_key, work_date);
CREATE INDEX idx_worklog_fact_issue       ON worklog_fact(issue_key);
CREATE INDEX idx_worklog_fact_parent      ON worklog_fact(parent_key);

---------------------------------------------------------------------
-- Sync Watermark Table
-- One row per sync job, holding the point the last SUCCESSFUL run reached.
--
-- The watermark advances LAST, in the same transaction as the writes it
-- describes. If the job dies halfway the next run repeats the window instead
-- of skipping it: repeating is free because worklog_fact is keyed on Jira's
-- worklog ID, whereas skipping loses billable time silently and nothing
-- downstream would ever notice it had gone.
--
-- Stored as TIMESTAMPTZ rather than epoch milliseconds because BIGINT comes
-- back from node-postgres as a string; the job converts with getTime() at the
-- one point it calls Jira.
---------------------------------------------------------------------
CREATE TABLE sync_watermark (
    job_name           TEXT NOT NULL PRIMARY KEY,
    last_synced_at     TIMESTAMPTZ NOT NULL,
    last_run_at        TIMESTAMPTZ NULL,
    last_success_at    TIMESTAMPTZ NULL,
    last_error         TEXT NULL,
    -- Counters from the last run, for the sync health panel.
    last_updated_count INTEGER NOT NULL DEFAULT 0,
    last_deleted_count INTEGER NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO schema_migrations (filename) VALUES ('001_timesheet_read_model.sql');

COMMIT;
