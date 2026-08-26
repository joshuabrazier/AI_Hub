---------------------------------------------------------------------
-- 009 Which days a person works
--
-- staff_target has always recorded how MANY days a week somebody is
-- contracted to and never WHICH, and that gap has been paid for all over the
-- feature:
--
--   - capacity was prorated across every weekday, so a three-day person had
--     three fifths of a day of capacity on all five;
--   - the forecast could only say "three days remain" as an average, never
--     "Tuesday and Wednesday remain";
--   - the per-person chart drew a full-day line on days somebody does not
--     work, and the summary prompts had to carry an explicit rule telling the
--     model not to read an empty weekday as a day missed.
--
-- ISO WEEKDAY NUMBERS, 1 = Monday through 7 = Sunday, matching the ISO-8601
-- convention and one addition away from JavaScript's getUTCDay(). An array
-- rather than seven booleans because it reads plainly in psql ({1,2,3}) and
-- rather than a bitmask because a bitmask is unreadable in exactly the place
-- somebody looks when a figure seems wrong.
--
-- NULL MEANS UNSPECIFIED, not "no days". Every existing row is NULL, and those
-- keep the old prorating behaviour exactly - which is the honest default,
-- because nothing in this system knows which days anybody works until a person
-- says so. The engine falls back rather than guessing.
--
-- working_days_tenths STAYS as the capacity authority. It supports half days,
-- which a list of whole weekdays cannot express, so the two are not redundant:
-- the list says WHERE the hours fall, the tenths say HOW MANY. When a list is
-- present the engine counts its days in the period; when it is not, it
-- prorates as before.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f src/lib/data/sql/migrations/009_staff_target_weekdays.sql
---------------------------------------------------------------------
BEGIN;

ALTER TABLE staff_target ADD COLUMN IF NOT EXISTS working_weekdays SMALLINT[] NULL;

-- Every entry must be a real ISO weekday, and there can be at most seven.
--
-- UNIQUENESS IS NOT CHECKED HERE. A duplicated Tuesday would double that day's
-- capacity, so it does matter - but expressing "no repeats" needs a subquery
-- and Postgres does not allow one in a CHECK. It is enforced where it can be:
-- the Zod schema rejects duplicates, and the form offers checkboxes, which
-- cannot produce one. Worth knowing that a hand-written INSERT could.
ALTER TABLE staff_target DROP CONSTRAINT IF EXISTS staff_target_weekdays_valid;

ALTER TABLE staff_target ADD CONSTRAINT staff_target_weekdays_valid CHECK (
    working_weekdays IS NULL
    OR (
        array_length(working_weekdays, 1) BETWEEN 1 AND 7
        AND working_weekdays <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[]
    )
);

INSERT INTO schema_migrations (filename) VALUES ('009_staff_target_weekdays.sql');

COMMIT;
