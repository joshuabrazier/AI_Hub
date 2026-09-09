---------------------------------------------------------------------
-- Choosing a SharePoint folder is a model call, so it needs a name
--
-- The filing decision has a middle tier: when no client name matches a
-- folder name, the model is handed the catalogue and asked to pick one.
-- That is a call to Bedrock on the organisation's account, and
-- ai_chat_request_logs promises to record every one of them.
--
-- ITS OWN KIND RATHER THAN 'transcription', because the two answer
-- different questions about the same meeting and the log is where somebody
-- goes to ask them. 'transcription' is "what did this meeting cost to
-- summarise"; this is "what did the app think about where it belongs". A
-- note filed in the wrong client's folder is investigated by reading the
-- second, and finding it mixed in with the first would mean reading every
-- summary call to find the one filing call.
--
-- ADD VALUE inside a transaction is allowed from Postgres 12 on; the new
-- member cannot be USED until this commits, which costs nothing - the
-- first row using it is written at runtime, long afterwards.
---------------------------------------------------------------------

BEGIN;

ALTER TYPE ai_chat_request_kind ADD VALUE IF NOT EXISTS 'meeting_filing';

INSERT INTO schema_migrations (filename) VALUES ('021_meeting_filing_request_kind.sql');

COMMIT;
