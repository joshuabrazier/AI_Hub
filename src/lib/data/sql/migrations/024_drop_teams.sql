---------------------------------------------------------------------
-- Remove teams
--
-- WHAT WENT. `teams` and `team_members`, the team-role enum, the two columns
-- on `user_invitations` that pre-assigned somebody into a team, and the
-- `team_id` column on `audit_logs`.
--
-- WHY IT IS SAFE TO REMOVE AT ALL. Teams were described as the app's security
-- boundary, and that was true when the manager area was a list of teams. It
-- had stopped being true: the ONLY consumer of team scoping was the teams
-- feature itself. Every other thing in /manage is scoped by something nearer
-- the data - a project by `project_members`, and chat, summaries,
-- transcription and the timesheet by the session user. So nothing widens
-- here; a boundary that only guarded its own screens is removed along with
-- them.
--
-- THIS IS DESTRUCTIVE AND NOT REVERSIBLE. Dropping a table takes its rows.
-- Anybody applying this to an environment with real memberships should decide
-- deliberately that the grouping is not worth keeping - the code is in git,
-- the rows are not.
--
-- -------------------------------------------------------------------
-- THE AUDIT COLUMN IS THE ONE TO THINK ABOUT.
--
-- `audit_logs` is APPEND-ONLY and is the record of who changed what. Dropping
-- `team_id` from it destroys one field of history that cannot be
-- reconstructed - and unlike the tables above, those rows are not being
-- removed, so the trail survives with a hole in it.
--
-- It goes anyway, for one reason: the column is a SOFT reference with no
-- foreign key, and the teams it named are about to stop existing. A column
-- pointing at ids in a dropped table is not history, it is a set of numbers
-- nothing can resolve - the screen already rendered "(removed team)" for any
-- team that had gone. The `summary` text on each row names what happened in
-- words and is untouched, which is the part somebody reads.
--
-- The team-membership ACTIONS ('team.member_added' and the rest) are left in
-- place as rows. They are plain strings in `action`, not an enum, so nothing
-- refuses them - and deleting audit rows to tidy up a removed feature is
-- exactly what an append-only trail exists to prevent. They will render with
-- their raw action name once the label map no longer carries them, which is
-- the honest outcome: it happened, and the feature it happened in is gone.
-- -------------------------------------------------------------------

BEGIN;

-- Invitations first: they reference nothing, but the CHECK constraint has to
-- go with the columns it constrains.
ALTER TABLE user_invitations
    -- The name as database-schema.sql actually declares it. This was written
    -- as _requires_team, which matches nothing, so the IF EXISTS made it a
    -- silent no-op - the migration only ever succeeded because DROP COLUMN
    -- takes the constraints on a column with it. Belt and braces, correctly
    -- named, rather than braces alone.
    DROP CONSTRAINT IF EXISTS user_invitations_team_role_needs_team,
    DROP COLUMN IF EXISTS team_role,
    DROP COLUMN IF EXISTS team_id;

ALTER TABLE audit_logs
    DROP COLUMN IF EXISTS team_id;

-- team_members references teams, so it goes first.
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;

-- Only after every column using it has gone.
DROP TYPE IF EXISTS team_role;

INSERT INTO schema_migrations (filename) VALUES ('024_drop_teams.sql');

COMMIT;
