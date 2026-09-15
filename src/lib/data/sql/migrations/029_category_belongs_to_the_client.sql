---------------------------------------------------------------------
-- Internal or external is a fact about the CLIENT, not the project
--
-- 028 put `category` on `projects` an hour ago. That was wrong, and it is
-- worth correcting in its own migration rather than by editing that file,
-- because a migration that has run is a record of what the database did.
--
-- WHY THE CLIENT IS RIGHT: it is where Jira had it, and Jira was right. The
-- value lived on the SPACE - `jira_project.category`, which the timesheet
-- engine calls the client - and the sync copied it DOWNWARD onto every
-- issue:
--
--     category: normaliseText(project.projectCategory?.name)
--
-- so a worklog fact's category was always its client's, inherited rather
-- than declared. The option list the reports build their Internal/External
-- filter from is `getJiraProjectsRepo()`, which is the list of spaces. Both
-- halves of the feature already assume the value belongs to the client.
--
-- And it is the better model independently of what Jira did. "Is this our own
-- work or somebody else's" is a fact about WHO THE WORK IS FOR. Set once per
-- client, inherited by every project and every hour beneath it.
--
-- IT ALSO REMOVES A FIELD THAT COULD BE WRONG. A per-project category
-- defaulting to 'external' is a default that is wrong every single time
-- somebody adds internal work and does not think to change it - and internal
-- work is precisely what must not be counted as external in a report about
-- what the business earned.
--
-- What it costs is expressiveness nobody asked for: an internal project under
-- an external client can no longer be marked as such. If that turns out to be
-- a real arrangement, the answer is a nullable override on the project that
-- falls back to the client, and NOT a second independent column - see what
-- `billableSource` had to become in the engine once two levels could both
-- declare the same thing.
--
-- `projects.is_billable` is untouched and still answers a different question:
-- an external client's project can be non-billable (an absorbed overrun,
-- goodwill work, a pitch), while internal work never is.
---------------------------------------------------------------------
BEGIN;

-- The type already exists from 028 and is reused as it stands.
ALTER TABLE clients
    ADD COLUMN category project_category NOT NULL DEFAULT 'external';

---------------------------------------------------------------------
-- CARRIED ACROSS FIRST, so a client whose projects were all marked internal
-- keeps that. It is a no-op on this database - 028 landed an hour ago and
-- nothing has written a non-default value - but a migration that drops a
-- column without moving what was in it is a migration that only works by
-- luck about when it runs.
--
-- ALL, not ANY. A client is marked internal only when EVERY project under it
-- was, because "some of this client's work was internal" does not make the
-- client internal, and guessing the other way round would relabel a real
-- client's revenue as overhead.
---------------------------------------------------------------------
UPDATE clients AS c
SET category = 'internal',
    updated_at = NOW()
WHERE EXISTS (SELECT 1 FROM projects p WHERE p.client_id = c.id)
  AND NOT EXISTS (
      SELECT 1 FROM projects p
      WHERE p.client_id = c.id
        AND p.category <> 'internal'
  );

ALTER TABLE projects
    DROP COLUMN category;

INSERT INTO schema_migrations (filename) VALUES ('029_category_belongs_to_the_client.sql');

COMMIT;
