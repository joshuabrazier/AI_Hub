---------------------------------------------------------------------
-- 002 Jira projects
--
-- The project list, with its category.
--
-- Why this table exists: the dashboard's Internal/External selector was built
-- from the categories present in worklog_fact, which meant a category with no
-- time logged simply did not appear. "Internal Operations exists and has zero
-- hours against it" and "there is no such thing as Internal" then looked
-- identical on screen, and they are completely different facts - one of them
-- says time is being recorded somewhere other than Jira.
--
-- Same principle as a Project item with a budget and no deliverables under it:
-- the empty row is the one worth seeing.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f src/lib/data/sql/migrations/002_jira_project.sql
---------------------------------------------------------------------
BEGIN;

CREATE TABLE jira_project (
    project_key   TEXT NOT NULL PRIMARY KEY,
    name          TEXT NOT NULL,
    -- 'Internal' | 'External', named by the Jira admin. NULL when the project
    -- has no category set, which is itself worth surfacing.
    category      TEXT NULL,
    project_type  TEXT NULL,
    synced_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_jira_project_category ON jira_project(category);

INSERT INTO schema_migrations (filename) VALUES ('002_jira_project.sql');

COMMIT;
