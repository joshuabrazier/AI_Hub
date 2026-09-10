---------------------------------------------------------------------
-- What a project was CHARGED for, and whether that is set per project or
-- per phase
--
-- THE FIGURE THAT WAS MISSING. A project had no charged hours anywhere: its
-- budget bar measured the SUM OF TASK ESTIMATES against logged time, which
-- is the plan against the actual and never mentions what the client agreed
-- to pay for. So a project quoted at 240 hours whose estimates had crept to
-- 280 showed a healthy bar the whole way, because the goalposts moved every
-- time somebody re-estimated.
--
-- Both figures matter and they are different things:
--
--   CHARGED   what the client agreed to. Set once, at the start, and it
--             does not move because work took longer - that is the nature
--             of a fixed quote.
--   ESTIMATED the sum of the task estimates, which CLIMBS as people revise
--             them. On a project going badly this moves first, long before
--             the logged hours catch up.
--
-- Nothing is added for the estimate: it is already derivable from
-- `tasks.estimate_minutes` and storing a second copy is how the two come to
-- disagree. Only the charged figure is new.
--
-- WHY THE SCOPE IS A COLUMN AND NOT A CONVENTION. Some work is sold as one
-- number for the whole engagement; some is sold phase by phase, where each
-- stage has its own agreed hours. Both are real, and which one a project is
-- cannot be inferred from the data - a project with per-phase hours filled
-- in halfway through looks identical to one that was sold whole and is
-- being annotated. So the intent is recorded, and the report reads it rather
-- than guessing.
--
-- NULLABLE, ON BOTH TABLES, AND THAT IS THE WHOLE NULL CONVENTION OF THIS
-- MODULE. Nought would mean "sold for no hours", which nobody records;
-- NULL means "not filled in yet", which is the ordinary state of a project
-- somebody has just created. The rollup answers null percentages for it
-- rather than a full bar, exactly as it does for a cost rate nobody has
-- recorded - see chargedProgress in delivery.types.ts.
--
-- SWITCHING SCOPE DESTROYS NOTHING. The two columns are independent, so a
-- project flipped to per-phase and back finds its project-level figure
-- exactly where it left it. That is deliberate: the toggle is a question
-- about how this project is sold, and somebody exploring it should not lose
-- the number they typed an hour ago.
--
-- NO DEFAULT ON THE MINUTES and 'project' as the default scope, so every
-- existing row keeps behaving as it does today: one project, no charged
-- figure, a report that falls back to the estimate total until somebody
-- fills the quote in.
---------------------------------------------------------------------

BEGIN;

-- 'project' first, so it is the enum's default-shaped member as well as the
-- column default. There is deliberately no 'group' member: per-person pools
-- already exist as project_budget_groups and answer a different question -
-- who spent the hours, not where they went.
CREATE TYPE budget_scope AS ENUM ('project', 'phase');

ALTER TABLE projects
    ADD COLUMN budget_scope    budget_scope NOT NULL DEFAULT 'project',
    ADD COLUMN charged_minutes INTEGER NULL,
    -- Stored as minutes like every other duration in this schema, because
    -- an hour and a half is 90 and never 1.5. delivery.types.ts converts at
    -- the boundary and nothing below it handles a fractional hour.
    ADD CONSTRAINT projects_charged_minutes_non_negative
        CHECK (charged_minutes IS NULL OR charged_minutes >= 0);

ALTER TABLE phases
    ADD COLUMN charged_minutes INTEGER NULL,
    ADD CONSTRAINT phases_charged_minutes_non_negative
        CHECK (charged_minutes IS NULL OR charged_minutes >= 0);

-- The report reads charged minutes per phase for one project at a time, and
-- phases already have (project_id) covered by the foreign key. Nothing is
-- added here: a project has tens of phases at most, so an index on a
-- nullable column that narrow buys nothing and costs a write on every phase
-- edit.

INSERT INTO schema_migrations (filename) VALUES ('023_project_charged_time.sql');

COMMIT;
