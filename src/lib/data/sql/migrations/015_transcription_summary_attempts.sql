---------------------------------------------------------------------
-- Count what a summary has already cost
--
-- Summarising is the most expensive thing the transcription feature does,
-- and nothing owned it. The row was claimed AFTER the model call, not
-- before, so every sweep that found a transcription in `summarising`
-- started its own summary: every open tab polls every six seconds, the
-- page-load sweep runs, and the scheduled background sweep runs. One
-- meeting was observed being summarised three times inside ninety seconds,
-- and paid for all three.
--
-- WHY A COLUMN RATHER THAN REUSING updated_at. A lease needs to record
-- "somebody is working on this, started at T". updated_at cannot carry
-- that, because the give-up rule already reads it to decide how long the
-- row has been stuck - so a lease that touched updated_at would reset the
-- give-up timer on every attempt, and a row that could never be summarised
-- would retry forever. The two facts are genuinely different and need
-- different columns.
--
-- AND WHY A COUNT RATHER THAN A TIMESTAMP. Giving up after fifteen minutes
-- was measuring the wrong thing. Minutes are not what a failing summary
-- costs; attempts are, and three concurrent attempts inside one minute
-- spent three times what the timer believed it was allowing. A count is
-- the quantity that actually bounds the spend, and it makes the worst case
-- knowable in advance rather than dependent on how many tabs were open.
--
-- The lease itself is `summary_started_at`: NULL when nobody holds the
-- row, and a timestamp older than the lease window when a previous holder
-- died without finishing.
---------------------------------------------------------------------

BEGIN;

ALTER TABLE transcriptions
    ADD COLUMN IF NOT EXISTS summary_attempts INT NOT NULL DEFAULT 0;

ALTER TABLE transcriptions
    ADD COLUMN IF NOT EXISTS summary_started_at TIMESTAMPTZ NULL;

---------------------------------------------------------------------
-- Existing rows sitting in `summarising` have already had at least one
-- attempt spent on them, whatever happened to it. Left at 0 they would be
-- handed the full allowance again on the next sweep, which is the
-- behaviour this migration exists to bound.
--
-- Deliberately conservative: 1, not the maximum. A row that was one
-- timeout away from working should still get its remaining tries.
---------------------------------------------------------------------
UPDATE transcriptions
   SET summary_attempts = 1
 WHERE status = 'summarising'
   AND summary_attempts = 0;

INSERT INTO schema_migrations (filename) VALUES ('015_transcription_summary_attempts.sql');

COMMIT;
