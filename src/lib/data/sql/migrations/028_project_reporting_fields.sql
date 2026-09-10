---------------------------------------------------------------------
-- What the reports need from the app's own projects
--
-- THE REPORTS ARE MOVING OFF JIRA. Everything under /admin/timesheets read
-- a Jira-synced read model - `jira_project`, `jira_issue`, `worklog_fact` -
-- and the app now holds the same shape itself: clients, projects, phases,
-- tasks and time entries. The hierarchies line up almost exactly, which is
-- what makes the switch a mapping rather than a rewrite:
--
--   Jira space        ->  client
--   parent issue      ->  project      (Jira called it the "Project item")
--   issue             ->  task
--   worklog           ->  time entry
--
-- Two fields had no app equivalent, and both are load-bearing for a report
-- somebody actually reads. They are added here.
--
---------------------------------------------------------------------
-- CATEGORY: internal or external.
--
-- The Jira data carries exactly these two values and nothing else - four
-- external projects and two internal - so this is not a new concept, it is
-- the same one moving house. It drives the category filter and the split on
-- the overview.
--
-- IT IS NOT THE SAME QUESTION AS `is_billable`, which is why it is a second
-- column rather than a derivation. An EXTERNAL project can be non-billable:
-- a fixed-price overrun being absorbed, goodwill work, a pitch. Internal
-- work is never billable. So billable implies external, and external implies
-- nothing about billable - one column cannot answer both.
--
-- NOT NULL DEFAULT 'external', because that is what a consultancy's projects
-- overwhelmingly are, and because a nullable category would put an "unset"
-- bucket on every breakdown for a value nobody needs to think about. Where
-- NULL means something in this module it is because "not filled in yet" is a
-- real state worth reporting - `charged_minutes` is that; a category is not.
---------------------------------------------------------------------
BEGIN;

CREATE TYPE project_category AS ENUM ('internal', 'external');

ALTER TABLE projects
    ADD COLUMN category project_category NOT NULL DEFAULT 'external';

---------------------------------------------------------------------
-- R&D CLASSIFICATION: core, supporting, or neither.
--
-- The R&D Tax Incentive report is built entirely on this. Jira held it as
-- issue labels, and the sync FROZE the resolved value onto each worklog.
--
-- NULLABLE, AND NULL IS A DECISION RATHER THAN A GAP. Most work is not
-- claimable. A project with no classification is ordinary delivery, which is
-- why there is no 'none' member: an enum value would invite a breakdown with
-- a third bar on it, where what is wanted is "the claimable work, and
-- everything else".
--
-- ON THE PROJECT, NOT THE TASK. A tax claim is made about an ACTIVITY, and a
-- project is the closest thing this schema has to one. Task-level would be
-- more faithful to the legislation - a single project can contain a core
-- experiment and the supporting work around it - and it is the obvious
-- extension, but it needs a control on every task rather than one on the
-- project, and nobody has asked for that yet.
---------------------------------------------------------------------
CREATE TYPE rnd_class AS ENUM ('core', 'supporting');

ALTER TABLE projects
    ADD COLUMN rnd_class rnd_class NULL;

---------------------------------------------------------------------
-- AND FROZEN ONTO THE TIME ENTRY.
--
-- THIS COLUMN IS NOT A DENORMALISATION FOR SPEED. It is the same rule the
-- Jira sync followed, and the timesheet engine states it plainly: the class
-- is carried "as FROZEN at sync time, carried on the worklog. Never derived
-- here from the issue's current labels: those are mutable, and deriving
-- would let a label edit reclassify history."
--
-- The same hazard exists here and is worse, because a project's fields are
-- edited in this app rather than in a system somebody else owns. Reading the
-- project's CURRENT class when reporting would mean: reclassify a project in
-- March and every hour logged against it since inception silently changes
-- what it was claimed as. An R&D claim is a statement to the ATO about work
-- that was done at a point in time. It has to be recorded at that point.
--
-- There is a second, less obvious reason. `rnd_class` on the project is one
-- value per project; hours are per entry. Joining the project's value in at
-- report time is a GRAIN ERROR waiting to happen - the engine's own note
-- says so - because any aggregation that fans out over entries would count
-- the project's classification once per entry rather than once.
--
-- NULLABLE with no backfill. The two entries that exist predate the field,
-- and inventing a classification for them would be fabricating claim data.
---------------------------------------------------------------------
ALTER TABLE time_entries
    ADD COLUMN rnd_class rnd_class NULL;

---------------------------------------------------------------------
-- STAFF TARGETS MOVE OFF ATLASSIAN IDS.
--
-- `staff_target.person_id` holds an Atlassian accountId, because it was
-- written to sit beside Jira worklogs that identified people that way. The
-- reports now identify a person by `users.id`, so a target keyed on the old
-- identity is a target that matches nobody: capacity, utilisation and the
-- billable-target column would all read as unset for everybody.
--
-- RE-KEYED BY JOINING ON `users.atlassian_account_id`, which is the mapping
-- and is kept. Rows that match a user are rewritten; any that do not are
-- left exactly as they are rather than deleted, so nothing is lost if
-- somebody's link is missing and the join can be re-run.
--
-- NO FOREIGN KEY IS ADDED. It would be the right shape, and it would fail
-- this migration on any row that did not match - which is precisely the row
-- that most needs to survive long enough for somebody to look at it.
---------------------------------------------------------------------
UPDATE staff_target AS t
SET person_id = u.id,
    updated_at = NOW()
FROM users AS u
WHERE u.atlassian_account_id = t.person_id;

INSERT INTO schema_migrations (filename) VALUES ('028_project_reporting_fields.sql');

COMMIT;
