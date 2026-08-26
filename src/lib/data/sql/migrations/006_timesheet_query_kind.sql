---------------------------------------------------------------------
-- 006 Timesheet query request kind
--
-- A fourth model call: turning a typed question into a set of dashboard
-- filters. No new table - the answer is a redirect to a URL the app already
-- serves, and nothing about it is worth keeping. What IS kept is the record
-- that the call happened, in ai_chat_request_logs, which is why this needs an
-- enum value at all.
--
-- Its own kind rather than borrowing 'timesheet_summary' because the three
-- calls cost wildly different amounts and an admin reading the log should be
-- able to tell a question from a report at a glance.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f src/lib/data/sql/migrations/006_timesheet_query_kind.sql
---------------------------------------------------------------------
BEGIN;

ALTER TYPE ai_chat_request_kind ADD VALUE IF NOT EXISTS 'timesheet_query';

INSERT INTO schema_migrations (filename) VALUES ('006_timesheet_query_kind.sql');

COMMIT;
