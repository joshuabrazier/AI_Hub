---------------------------------------------------------------------
-- 003 Staff targets
--
-- What each person is expected to deliver, so utilisation and billable share
-- are measured against THEIR arrangement rather than one company-wide
-- assumption.
--
-- Without this, somebody working three days a week reads as 60% utilised and
-- looks like they are underperforming, when they are at 100% of what was
-- agreed. A number that is wrong in a predictable direction is worse than no
-- number, because people learn to ignore it.
--
-- Keyed on the Atlassian accountId, like everything else in the read model.
-- This is the one table here NOT derived from Jira - Jira does not know
-- anyone's contracted days - so it is the only one that would be lost if the
-- read model were dropped and rebuilt. It is therefore deliberately small and
-- quick to re-enter.
--
-- INTEGERS ONLY, for the reason set out in migration 001: node-postgres hands
-- NUMERIC back as a STRING, so "4.5" + "5" silently becomes "4.55" instead of
-- 9.5. Days are stored in tenths and hours in minutes, both exact.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f src/lib/data/sql/migrations/003_staff_target.sql
---------------------------------------------------------------------
BEGIN;

DROP TABLE IF EXISTS staff_target;

CREATE TABLE staff_target (
    person_id             TEXT NOT NULL PRIMARY KEY,
    -- Snapshotted for display, so a target still reads sensibly for someone
    -- with no time in the period being viewed. Never grouped or joined on.
    person_name           TEXT NULL,
    -- Contracted days per week in TENTHS: 50 = 5 days, 30 = 3 days, 45 = 4.5.
    -- Tenths rather than a whole number because half days are common, and
    -- rounding somebody on 4.5 days to 4 or 5 misstates their capacity by a
    -- tenth of their working life.
    working_days_tenths   INTEGER NOT NULL DEFAULT 50,
    -- Minutes in one of their working days. 450 = 7.5h.
    minutes_per_day       INTEGER NOT NULL DEFAULT 450,
    -- Share of logged time expected to be billable, 0 to 100. NULL means no
    -- target set, which is NOT the same as a target of zero: the first shows a
    -- dash, the second shows somebody expected to bill nothing.
    billable_target_percent INTEGER NULL,
    notes                 TEXT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT staff_target_days_range CHECK (working_days_tenths >= 0 AND working_days_tenths <= 70),
    CONSTRAINT staff_target_minutes_range CHECK (minutes_per_day > 0 AND minutes_per_day <= 1440),
    CONSTRAINT staff_target_billable_range CHECK (
        billable_target_percent IS NULL
        OR (billable_target_percent >= 0 AND billable_target_percent <= 100)
    )
);

COMMIT;
