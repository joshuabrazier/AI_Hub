---------------------------------------------------------------------
-- WHICH MIGRATIONS DOES THIS DATABASE STILL NEED?
--
-- READ ONLY. It creates nothing, changes nothing and locks nothing, so it is
-- safe to paste straight into a production console.
--
-- Run it against any environment - prod, dev, a fresh database - and it tells
-- you, for every migration in the repo:
--
--   PENDING                 in the repo, NOT applied here. Run it.
--   applied                 already recorded here. Do nothing.
--   applied - NOT IN REPO   recorded here but the file is gone from the repo.
--                           Usually an older branch or a squashed history.
--
-- ONE STATEMENT, AND NOT ONE CHARACTER MORE. Some consoles split a script on
-- semicolons before sending it, which understands neither comments nor string
-- literals. So this file carries exactly one semicolon, the one that ends the
-- query, and the generator asserts it - an earlier version had a commented-out
-- variant below the query and the console ran the comment.
--
-- IT READS THE LEDGER, NOT THE SCHEMA. schema_migrations records what was RUN,
-- which is not the same as what is THERE. A column added by hand, or a
-- migration applied from a branch that was never pushed, will not line up. For
-- the migrations that add a COLUMN or an ENUM VALUE rather than a table,
-- confirm the object itself before trusting a line here.
--
-- RUN IT FROM THE BRANCH YOU ARE ABOUT TO DEPLOY. The list below is baked in
-- from the migrations directory when this file is generated, so a migration
-- that exists only on the incoming branch cannot show up as PENDING if you
-- generated this from an older one. That is the failure worth knowing about,
-- because it does not warn - it simply never mentions the migration.
--
-- ORDER MATTERS. Apply anything marked PENDING in the order listed, top to
-- bottom. A later migration generally assumes an earlier one worked.
--
-- DESTRUCTIVE ones are flagged. Those DROP tables or columns, and the rows
-- cannot be recovered afterwards - read the file's own header before running
-- one, and export anything worth keeping first. Five of them (003, 004, 005,
-- 007, 008) do it in a way that is easy to miss: they OPEN with DROP TABLE and
-- then recreate the table empty, so they are safe only on a database that has
-- never had them. scripts/apply-migrations.mjs refuses every one of them
-- unless you pass --include-destructive, which is the safer way to run one if
-- you can point a script at the database.
--
-- This file is GENERATED from the migrations directory. Regenerate it when
-- migrations are added - it is a snapshot of the repo, not of any database.
-- Generated against 29 migration file(s).
---------------------------------------------------------------------

WITH in_repo (filename, destructive) AS (
  VALUES
    ('001_timesheet_read_model.sql', false),
    ('002_jira_project.sql', false),
    ('003_staff_target.sql', true),
    ('004_timesheet_ai_summary.sql', true),
    ('005_timesheet_report.sql', true),
    ('006_timesheet_query_kind.sql', false),
    ('007_staff_rate.sql', true),
    ('008_manual_worklog.sql', true),
    ('009_staff_target_weekdays.sql', false),
    ('009_transcription.sql', false),
    ('010_drop_timesheet_summary_and_report.sql', true),
    ('010_push_subscriptions.sql', false),
    ('011_session_two_factor.sql', false),
    ('012_sharepoint_inventory.sql', false),
    ('013_text_summary_request_kind.sql', false),
    ('014_transcription_teams_source.sql', false),
    ('015_transcription_summary_attempts.sql', false),
    ('016_worklog_rnd_classification.sql', false),
    ('017_worklog_rnd_source.sql', false),
    ('018_teams_auto_import.sql', false),
    ('019_transcription_filing.sql', false),
    ('020_delivery_projects.sql', false),
    ('021_meeting_filing_request_kind.sql', false),
    ('022_ai_chat_request_phases.sql', false),
    ('023_project_charged_time.sql', false),
    ('024_drop_teams.sql', true),
    ('025_transcription_filing_approval.sql', false),
    ('026_personal_access_tokens.sql', false),
    ('027_project_plan_request_kind.sql', false)
)
SELECT
    COALESCE(r.filename, a.filename)                             AS migration,
    CASE
        WHEN a.filename IS NULL THEN 'PENDING'
        WHEN r.filename IS NULL THEN 'applied - NOT IN REPO'
        ELSE 'applied'
    END                                                          AS status,
    CASE
        WHEN r.destructive AND a.filename IS NULL
            THEN 'DESTRUCTIVE - read the file and export first'
        WHEN r.destructive
            THEN 'was destructive'
        ELSE ''
    END                                                          AS warning,
    a.applied_at
FROM in_repo r
FULL OUTER JOIN schema_migrations a ON a.filename = r.filename
ORDER BY COALESCE(r.filename, a.filename);
