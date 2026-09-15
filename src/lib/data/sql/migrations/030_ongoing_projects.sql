---------------------------------------------------------------------
-- Work that ends, and work that just runs
--
-- A THIRD AXIS, and it is neither of the two already here.
--
--   is_billable       whether the time can go on an invoice (020)
--   clients.category  whose work it is, ours or somebody else's (029)
--   kind              whether the work has a BEGINNING AND AN END
--
-- The three are independent, and each is wrong as a proxy for this one. An
-- internal project can be a real project with a budget - 029 says so in as
-- many words - and an external client's project can be non-billable: an
-- absorbed overrun, goodwill work, a pitch. What neither expresses is a
-- STANDING BUCKET OF TIME CODES: internal meetings, staff reviews, leave.
-- That work never finishes, is never quoted, and has no plan to measure
-- against, so every screen built around a budget, a four-column board and an
-- end reads wrongly for it.
--
-- IT IS NOT A STATUS EITHER. project_status says where a project has got to,
-- and 'completed' is one of its values. An ongoing project is never
-- completed and is never on hold. Folding the two would add a status no
-- project ever leaves, and every status filter in the app would then have to
-- remember to exclude it.
--
-- 'delivery' FIRST, so it is the enum's default-shaped member as well as the
-- column default - the ordering 023 chose for budget_scope, for the same
-- reason. It is 'delivery' rather than 'project' because `kind = 'project'`
-- on the projects table says nothing at all.
--
-- NOT NULL DEFAULT 'delivery', so EVERY EXISTING ROW KEEPS BEHAVING EXACTLY
-- AS IT DOES TODAY. There is no "not filled in yet" state worth reporting
-- for this question, which is the argument 028 made for category and the
-- opposite of charged_minutes, where NULL means nobody has recorded a quote.
--
-- AND NO BACKFILL. Inferring this from is_billable or from the client's
-- category is wrong in both directions. The one or two ongoing projects get
-- flipped by hand by somebody who knows which they are, which is also how
-- the change earns an audit line.
--
-- NO INDEX. Low cardinality on a table of tens of rows, and nothing filters
-- on it alone. The same reasoning 023 wrote for phases.charged_minutes.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f src/lib/data/sql/migrations/030_ongoing_projects.sql
---------------------------------------------------------------------

BEGIN;

-- CREATE TYPE has no IF NOT EXISTS, so the guard is a DO block. The newer
-- habit in this directory is an idempotent statement wherever one is
-- available, because these are applied by hand against a deployed database
-- and a half-applied paste is the expensive failure.
DO $$
BEGIN
    IF to_regtype('project_kind') IS NULL THEN
        CREATE TYPE project_kind AS ENUM ('delivery', 'ongoing');
    END IF;
END
$$;

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS kind project_kind NOT NULL DEFAULT 'delivery';

-- The ledger insert stays plain, matching every other migration here. A
-- second paste fails on this line and the whole transaction rolls back, so a
-- re-run is a loud no-op rather than a quiet half-change - which is the
-- reason the guards above it exist, so the failure lands here and nowhere
-- earlier.
INSERT INTO schema_migrations (filename) VALUES ('030_ongoing_projects.sql');

COMMIT;
