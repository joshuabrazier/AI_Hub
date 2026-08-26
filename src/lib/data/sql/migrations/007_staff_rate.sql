---------------------------------------------------------------------
-- 007 Staff charge rates
--
-- What an hour of somebody's time is charged at, and optionally what it costs.
-- This is the table that turns an hours dashboard into a financial one:
-- without it there is no revenue, no margin, no effective rate and no WIP
-- value, which is most of what a leadership pack is actually about.
--
-- RATES HAVE HISTORY, and that is the whole reason this is a table of rows
-- rather than two columns on staff_target. A rate rise in July must not
-- silently restate what May was worth. Each row says "from this date, this
-- rate", and a worklog is valued at the rate in force ON THE DAY IT WAS
-- WORKED - resolveRateFor in lib/timesheet/revenue.ts. Overwriting a single
-- current rate would rewrite history every time somebody got a pay review.
--
-- MONEY IN CENTS, INTEGERS ONLY, for exactly the reason migration 001 gives
-- about durations: node-postgres hands NUMERIC back as a STRING, so
-- "150.50" + "100" silently becomes "150.50100" rather than 250.50. Cents are
-- exact and they add up.
--
-- WORK BEFORE THE EARLIEST RATE HAS NO RATE, and is reported as unvalued
-- rather than as zero. A missing rate that reads as free work would
-- understate revenue and nobody would see why.
--
-- COST IS OPTIONAL because margin is a more sensitive number than revenue and
-- plenty of firms will want one without the other. Null cost means margin is
-- unknown, never zero.
--
-- SENSITIVITY. These are commercial figures and individual pay proxies. The
-- table is admin-only like the rest of the timesheet feature, and cost rates
-- in particular should not be handed to a model unless a report genuinely
-- needs them - see docs/timesheet-sync.md.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f src/lib/data/sql/migrations/007_staff_rate.sql
---------------------------------------------------------------------
BEGIN;

DROP TABLE IF EXISTS staff_rate;

CREATE TABLE staff_rate (
    id                TEXT NOT NULL PRIMARY KEY,
    -- The Atlassian accountId, like everything else in the read model.
    person_id         TEXT NOT NULL,
    -- Snapshotted for display, so a rate row still reads sensibly for
    -- somebody with no time in the period being viewed. Never joined on.
    person_name       TEXT NULL,
    -- The rate applies to work done on or after this date, until superseded
    -- by a later row for the same person.
    effective_from    DATE NOT NULL,
    -- Charged to the client per hour, in cents.
    charge_rate_cents INTEGER NOT NULL,
    -- What the hour costs the business, in cents. NULL means nobody has
    -- recorded it, so margin is unknown rather than 100%.
    cost_rate_cents   INTEGER NULL,
    notes             TEXT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- One rate per person per start date. Editing "the July rate" is an
    -- update of that row; a new rate is a new row with a new date.
    CONSTRAINT staff_rate_person_from_unique UNIQUE (person_id, effective_from),
    CONSTRAINT staff_rate_charge_non_negative CHECK (charge_rate_cents >= 0),
    CONSTRAINT staff_rate_cost_non_negative CHECK (cost_rate_cents IS NULL OR cost_rate_cents >= 0)
);

-- Rate resolution walks a person's rows backwards from a work date, so that is
-- the index it needs.
CREATE INDEX idx_staff_rate_person_from ON staff_rate(person_id, effective_from DESC);

INSERT INTO schema_migrations (filename) VALUES ('007_staff_rate.sql');

COMMIT;
