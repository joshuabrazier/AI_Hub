---------------------------------------------------------------------
-- Summaries of pasted text
--
-- No table. The feature takes text in, hands back a summary and keeps
-- nothing - so the only schema it needs is a name for its model calls in
-- ai_chat_request_logs.
--
-- That log is not optional for it. It is the app's record of what leaves
-- the organisation for Bedrock and what it costs, admins can read it, and a
-- feature whose entire purpose is sending somebody's document to a model
-- had better appear in it. Reusing 'summary' (conversation compaction) or
-- 'transcription' would have made the log lie about where the spend came
-- from.
--
-- ADD VALUE inside a transaction is allowed from Postgres 12 on; the new
-- member simply cannot be USED until this commits, which is fine - the
-- first row that uses it is written at runtime, long afterwards.
---------------------------------------------------------------------

BEGIN;

ALTER TYPE ai_chat_request_kind ADD VALUE IF NOT EXISTS 'text_summary';

INSERT INTO schema_migrations (filename) VALUES ('013_text_summary_request_kind.sql');

COMMIT;
