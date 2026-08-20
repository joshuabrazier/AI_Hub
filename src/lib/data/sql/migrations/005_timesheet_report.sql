---------------------------------------------------------------------
-- 005 Timesheet reports
--
-- A saved, named write-up of one period, drawing on all four timesheet
-- screens: business totals, staff against their targets, job budget health,
-- and the data-quality findings still outstanding.
--
-- A REPORT IS A RECORD, NOT A CACHE, and every difference from
-- timesheet_ai_summary follows from that one sentence:
--
--   - No data_fingerprint and no staleness. A summary describes how things
--     ARE and goes stale when they move; a report describes how things WERE
--     when somebody wrote it up. Marking one stale because Jira changed
--     afterwards would be marking history wrong.
--   - `facts` snapshots the figures it was written from. Without them the
--     prose is unverifiable a month later, because re-deriving the numbers
--     from a read model that has since re-synced gives different ones. This
--     is what makes a report answerable rather than merely readable.
--   - It has a title and an author, both chosen by a person.
--   - Nothing overwrites it. Writing again makes another report.
--
-- `created_by_name` is snapshotted alongside the id, the same way audit_logs
-- snapshots its actor: the report should still say who wrote it after that
-- account is renamed, or de-identified, or gone.
--
-- WHAT IT HOLDS is prose about how named individuals are performing, so it
-- gets a retention window like the chat tables have rather than living
-- forever. See TIMESHEET_REPORT_RETENTION_DAYS - it is longer than the
-- summary cache's because this one is an artefact somebody deliberately made,
-- not a derived convenience.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f src/lib/data/sql/migrations/005_timesheet_report.sql
---------------------------------------------------------------------
BEGIN;

-- A fourth kind of model call, so the request log can tell a report apart
-- from a summary. Allowed inside a transaction from PG12 on, as long as
-- nothing uses the new value before the commit - nothing here does.
ALTER TYPE ai_chat_request_kind ADD VALUE IF NOT EXISTS 'timesheet_report';

DROP TABLE IF EXISTS timesheet_report;

CREATE TABLE timesheet_report (
    id               TEXT NOT NULL PRIMARY KEY,
    -- What the person called it. Their words, so the list reads like their
    -- filing rather than a generated index.
    title            TEXT NOT NULL,
    -- The period and filters it covers, kept in the clear. `period_label` is
    -- snapshotted because it is presentation that has to stay put: deriving
    -- it again later, after a copy change to how periods are written, would
    -- silently relabel every historical report.
    granularity      TEXT NOT NULL,
    period_start     DATE NOT NULL,
    period_label     TEXT NOT NULL,
    category         TEXT NOT NULL,
    project          TEXT NOT NULL,
    person           TEXT NOT NULL,
    -- The model's markdown, as returned. Rendered through AiChatMarkdown,
    -- which emits React elements, so it never becomes an HTML string.
    body             TEXT NOT NULL,
    -- The figures the prose was written from, verbatim. The report's evidence.
    facts            JSONB NOT NULL,
    model_id         TEXT NOT NULL,
    region           TEXT NOT NULL,
    input_tokens       INT NULL,
    output_tokens      INT NULL,
    cache_read_tokens  INT NULL,
    cache_write_tokens INT NULL,
    -- SET NULL, with the name snapshotted beside it: de-identifying the
    -- author must not delete a report about everybody else, and the report
    -- should still say who wrote it.
    created_by       TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_by_name  TEXT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The list is newest-first, and the retention sweep deletes by age. One index
-- serves both.
CREATE INDEX idx_timesheet_report_created ON timesheet_report(created_at DESC);

INSERT INTO schema_migrations (filename) VALUES ('005_timesheet_report.sql');

COMMIT;
