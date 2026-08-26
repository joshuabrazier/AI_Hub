---------------------------------------------------------------------
-- 004 Timesheet AI summaries
--
-- A cache of model-written prose about a period, plus the request kind that
-- labels those calls in the AI request log.
--
-- WHY A CACHE AND NOT A LOG. The summary is derived: given the same numbers
-- it should say the same thing, and two admins looking at the same week
-- should read the same words rather than two differently worded answers to
-- one question. It is also the difference between one Opus call per period
-- and one per page view.
--
-- WHAT MAKES A ROW STALE is `data_fingerprint`, not age. It is a hash of the
-- FIGURES that were summarised, so the next Jira sync that changes them
-- invalidates the prose automatically. Keying on time instead would leave a
-- confident paragraph describing numbers that had since moved, which is
-- worse than no paragraph.
--
-- The primary key is the cache key: one row per (scope, period, filters), so
-- a regenerate replaces rather than accumulates.
--
-- THIS TABLE HOLDS STAFF PERFORMANCE TEXT - who is under capacity, who is
-- not billing. It is admin-only like the rest of the timesheet feature, and
-- the retention job sweeps it, because a cache of judgements about people is
-- not something to keep indefinitely when it can be regenerated in seconds.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f src/lib/data/sql/migrations/004_timesheet_ai_summary.sql
---------------------------------------------------------------------
BEGIN;

-- Timesheet summaries are a THIRD kind of call, distinct from 'chat' and the
-- 'summary' compaction pass, so an admin reading the request log can tell
-- what spent the tokens. Adding a value inside a transaction is allowed from
-- PG12 on, provided nothing uses it before the commit - nothing here does.
ALTER TYPE ai_chat_request_kind ADD VALUE IF NOT EXISTS 'timesheet_summary';

DROP TABLE IF EXISTS timesheet_ai_summary;

CREATE TABLE timesheet_ai_summary (
    -- A hash of scope + period + filters. Also the upsert target, so
    -- regenerating the same view replaces its row instead of adding one.
    cache_key        TEXT NOT NULL PRIMARY KEY,
    -- Which screen asked: 'overview' or 'staff'. Not called "view", which is
    -- a reserved word and needs quoting in every hand-written statement.
    scope            TEXT NOT NULL,
    -- The filter tuple, stored in the clear as well as hashed. Redundant on
    -- purpose: without it a stale or suspect row is an opaque hash, and the
    -- first question anybody asks of a cache is what it is a cache OF.
    granularity      TEXT NOT NULL,
    period_start     DATE NOT NULL,
    category         TEXT NOT NULL,
    project          TEXT NOT NULL,
    person           TEXT NOT NULL,
    -- Hash of the figures summarised. Compared on read; a mismatch means
    -- regenerate.
    data_fingerprint TEXT NOT NULL,
    -- The model's markdown, as returned. Rendered through AiChatMarkdown,
    -- which emits React elements, so it is never turned into an HTML string.
    summary          TEXT NOT NULL,
    model_id         TEXT NOT NULL,
    region           TEXT NOT NULL,
    -- Usage for the call that produced this row. With prompt caching on,
    -- total input is input + cache_read + cache_write; see CLAUDE.md.
    input_tokens       INT NULL,
    output_tokens      INT NULL,
    cache_read_tokens  INT NULL,
    cache_write_tokens INT NULL,
    -- Who pressed the button. SET NULL rather than CASCADE: the summary
    -- describes a period, not a person, so de-identifying the admin who
    -- generated it should not delete a cache entry about everybody else.
    generated_by     TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The retention sweep deletes by age, so that is the index it needs.
CREATE INDEX idx_timesheet_ai_summary_created ON timesheet_ai_summary(created_at);

INSERT INTO schema_migrations (filename) VALUES ('004_timesheet_ai_summary.sql');

COMMIT;
