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
--                           Not an error, and nothing to do about it.
--
-- ORDER MATTERS. Apply anything marked PENDING in the order listed, top to
-- bottom - a later migration generally assumes an earlier one worked.
--
-- DESTRUCTIVE ones are flagged. Those DROP tables or columns and their rows
-- cannot be recovered afterwards; read the file's own header before running
-- one, and export anything worth keeping first. `scripts/apply-migrations.mjs`
-- refuses them unless you pass --include-destructive, which is the safer way
-- to run them if you can point a script at the database.
--
-- This file is GENERATED from the migrations directory. Regenerate it when
-- migrations are added - it is a snapshot of the repo, not of any database.
-- Generated against 27 migration file(s).
---------------------------------------------------------------------

WITH in_repo (filename, destructive) AS (
  VALUES
    ('001_timesheet_read_model.sql', false),
    ('002_jira_project.sql', false),
    ('003_staff_target.sql', false),
    ('004_timesheet_ai_summary.sql', false),
    ('005_timesheet_report.sql', false),
    ('006_timesheet_query_kind.sql', false),
    ('007_staff_rate.sql', false),
    ('008_manual_worklog.sql', false),
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
    ('025_transcription_filing_approval.sql', false)
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


---------------------------------------------------------------------
-- Just the count, if that is all you want:
---------------------------------------------------------------------
-- WITH in_repo (filename) AS (VALUES ('001_timesheet_read_model.sql'), ('002_jira_project.sql'), ... )
-- SELECT count(*) AS pending
--   FROM in_repo r
--  WHERE NOT EXISTS (SELECT 1 FROM schema_migrations a WHERE a.filename = r.filename);
