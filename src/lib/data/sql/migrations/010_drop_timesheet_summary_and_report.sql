---------------------------------------------------------------------
-- 010 Remove the timesheet AI summaries and saved reports
--
-- Both features were removed from the application. This drops what they
-- stored. Migrations 004 and 005 created these tables; nothing reads or
-- writes them any more.
--
-- THIS DESTROYS DATA AND CANNOT BE UNDONE. The two tables differ in how much
-- that matters, and the difference is worth stating before anyone runs it:
--
--   timesheet_ai_summary was a CACHE. Every row was derived prose that could
--   be regenerated from the figures, so losing it costs nothing.
--
--   timesheet_report was a RECORD. Each row snapshotted the figures its prose
--   quoted, precisely so an old write-up stayed verifiable after the read
--   model moved on. Those rows CANNOT be reconstructed - the numbers they
--   describe are gone from the current data. Export anything worth keeping
--   before running this.
--
-- The ai_chat_request_logs rows for these calls are deliberately LEFT ALONE.
-- That table records what was actually sent to the model and admins read it in
-- full; deleting the entries for a retired feature would quietly turn that
-- promise into "every call except the ones we later removed the feature for".
-- The 'timesheet_summary' and 'timesheet_report' enum values stay for the same
-- reason - a Postgres enum value cannot be dropped while rows still carry it,
-- and those rows are history.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f src/lib/data/sql/migrations/010_drop_timesheet_summary_and_report.sql
---------------------------------------------------------------------
BEGIN;

DROP TABLE IF EXISTS timesheet_ai_summary;
DROP TABLE IF EXISTS timesheet_report;

INSERT INTO schema_migrations (filename) VALUES ('010_drop_timesheet_summary_and_report.sql');

COMMIT;
