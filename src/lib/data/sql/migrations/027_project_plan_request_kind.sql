---------------------------------------------------------------------
-- Reading a project brief is a model call, so it needs a name
--
-- "Create with AI" on the new project screen takes whatever somebody pastes
-- - a scope of work, an email, a quote - and turns it into a plan they can
-- review. That is a call to Bedrock on the organisation's account, and
-- ai_chat_request_logs promises to record every one of them.
--
-- ITS OWN KIND RATHER THAN 'text_summary', which is the nearest existing
-- one and would be wrong for the reason that log exists. Both take a pasted
-- document, but a summary hands back prose nobody acts on automatically,
-- and this hands back a structure that becomes a project, its phases, its
-- tasks and who is assigned to them. "What did the model propose to create"
-- is a different question from "what did it summarise", and an admin
-- reviewing a project that appeared out of nowhere should be able to find
-- the call that proposed it without reading every summary.
--
-- ADD VALUE inside a transaction is allowed from Postgres 12 on; the new
-- member cannot be USED until this commits, which costs nothing - the first
-- row using it is written at runtime.
---------------------------------------------------------------------

BEGIN;

ALTER TYPE ai_chat_request_kind ADD VALUE IF NOT EXISTS 'project_plan';

INSERT INTO schema_migrations (filename) VALUES ('027_project_plan_request_kind.sql');

COMMIT;
