-- -------------------------------------------------------------------
-- Record WHICH rule classified each worklog.
--
-- Classification used to have one source, an item's Jira labels, so the
-- answer implied its own provenance. It now has two: a space listed in
-- RND_CORE_PROJECT_KEYS makes its unlabelled work core by default, because
-- a space that exists solely to hold the R&D programme should not need
-- every item in it labelled by hand.
--
-- WITH TWO RULES, THE ANSWER ALONE STOPS BEING ENOUGH. A claim has to be
-- able to say why an hour is core, and "our code treats that project as
-- R&D" is a materially weaker answer than "the item carried this label, and
-- here is the snapshot of it". Without this column the two are
-- indistinguishable after the fact, and the weaker evidence would be
-- indistinguishable from the stronger.
--
-- A LABEL ALWAYS WINS. The space default only decides items carrying
-- neither label, so an item in the R&D space deliberately marked
-- RnD-supporting stays supporting. This column is how that stays visible.
--
-- The same reasoning already governs billable_source on this table, which
-- records whether a billable status came from the item or was inherited
-- from its parent. This is that pattern, for the same reason.
-- -------------------------------------------------------------------

BEGIN;

ALTER TABLE worklog_fact
    -- 'label' | 'space' | NULL. Free text rather than an enum, matching
    -- billable_source beside it: a value nobody expected should land in the
    -- read model and surface as a finding, not fail the write and lose the
    -- worklog with it.
    --
    -- NULL means unclassified, which is the same thing rnd_class NULL means.
    -- The two move together.
    ADD COLUMN rnd_source TEXT NULL;

-- The history table records what a classification CHANGED FROM and TO, and
-- a change of source is as real as a change of class: an hour that was core
-- because somebody labelled it, and is now core only because of where it
-- lives, is a weaker claim than it was. Both are nullable for the same
-- reason the class columns are.
ALTER TABLE worklog_rnd_history
    ADD COLUMN old_rnd_source TEXT NULL,
    ADD COLUMN new_rnd_source TEXT NULL;

INSERT INTO schema_migrations (filename) VALUES ('017_worklog_rnd_source.sql');

COMMIT;
