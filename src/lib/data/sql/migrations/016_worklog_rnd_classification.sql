-- -------------------------------------------------------------------
-- R&D classification, frozen onto each worklog at sync time
--
-- Two labels now exist site-wide in Jira and are applied to work items
-- across every space, client spaces included:
--
--   RnD-core
--   RnD-supporting
--
-- Classification is therefore PER WORK ITEM and cuts across spaces. It is
-- not a property of the space, so a worklog on a TSSS item can be R&D and
-- must appear in the R&D totals alongside RDP.
--
-- ===================================================================
-- WHY THIS IS SNAPSHOTTED RATHER THAN JOINED
-- ===================================================================
-- Jira labels are MUTABLE and Jira keeps no queryable history of them.
-- Deriving R&D status live - by joining jira_issue or asking Jira at query
-- time - means somebody adding a label in December silently reclassifies
-- every hour logged since July, and removing one makes hours disappear
-- from a period that was already reported.
--
-- This data may support an R&D Tax Incentive claim. A claim figure has to
-- be reproducible: what was classified, and when. So the classification is
-- frozen at the moment it was made, and any later change is recorded in
-- worklog_rnd_history rather than overwriting history in place.
--
-- The same reasoning already governs billable, category, parent_key and
-- person_name on this table - all denormalised at sync time so the fact
-- table can be read alone. This adds three more columns to that pattern
-- rather than introducing a different one.
--
-- GRAIN. One row per worklog, never per issue. Reporting reads worklog_fact
-- on its own; joining an issue-level table to pick up labels would fan out,
-- and an issue with six worklogs would count every hour six times.
-- -------------------------------------------------------------------

BEGIN;

ALTER TABLE worklog_fact
    -- The issue's FULL label array as seen at sync time, comma separated.
    -- The whole array rather than just the two we care about: when a
    -- classification is questioned later, "what did this item actually look
    -- like" is the question, and a filtered copy cannot answer it.
    ADD COLUMN labels_snapshot TEXT NULL,

    -- 'core' | 'supporting' | NULL. Free text rather than an enum, matching
    -- `billable` and `category` above it, so a value nobody expected lands
    -- in the read model and surfaces as a finding instead of failing the
    -- write and losing the worklog with it.
    ADD COLUMN rnd_class TEXT NULL,

    -- When the classification above was made. NULL means never classified,
    -- which is different from classified as not-R&D - the first is a gap in
    -- the data, the second is a decision.
    ADD COLUMN classified_at TIMESTAMPTZ NULL;

-- Reporting splits hours by class over a date window, so the class leads.
-- Partial, because rows that were never classified are not what this index
-- is for and a full index would carry them for nothing.
CREATE INDEX idx_worklog_fact_rnd ON worklog_fact (rnd_class, work_date)
    WHERE rnd_class IS NOT NULL;

-- -------------------------------------------------------------------
-- Reclassification history
--
-- One row every time a sync changes an existing worklog's rnd_class. This
-- is what answers "what was classified when" without relying on anyone's
-- memory, and it is the reason a label edit in Jira is recoverable rather
-- than merely destructive.
--
-- worklog_id is a SOFT reference with no foreign key, deliberately. A
-- worklog deleted in Jira has its worklog_fact row removed by the sync, and
-- the record that it was once classified as core must outlive that - the
-- hours were claimed on the strength of it. Same rule as audit_logs.
--
-- Only CHANGES are written. A sync that re-reads the same labels and
-- reaches the same answer writes nothing, so the table stays a record of
-- what moved rather than a log of every run.
-- -------------------------------------------------------------------
CREATE TABLE worklog_rnd_history (
    id              TEXT PRIMARY KEY,
    worklog_id      TEXT NOT NULL,

    old_rnd_class   TEXT NULL,
    new_rnd_class   TEXT NULL,

    -- Both label arrays, comma separated, so the change can be explained
    -- and not merely observed: "core to null" is a fact, "core to null
    -- because RnD-core was removed" is an answer.
    old_labels      TEXT NULL,
    new_labels      TEXT NULL,

    changed_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- "What happened to this worklog" is the question asked of this table.
CREATE INDEX idx_worklog_rnd_history_worklog
    ON worklog_rnd_history (worklog_id, changed_at DESC);

-- "What changed in this period" is the other one, for a claim review.
CREATE INDEX idx_worklog_rnd_history_changed
    ON worklog_rnd_history (changed_at DESC);

INSERT INTO schema_migrations (filename) VALUES ('016_worklog_rnd_classification.sql');

COMMIT;
