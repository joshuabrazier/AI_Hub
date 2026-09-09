---------------------------------------------------------------------
-- Where the time went, not just how much of it there was
--
-- ai_chat_request_logs already records duration_ms and an error. Between
-- them they could say a call took 20,001 ms and failed, and nothing at all
-- about WHICH part of it took the time - which is why a chat reliability
-- problem took days rather than an afternoon.
--
-- The turn that produced "the model sent nothing for 20 seconds" had in
-- fact spent nineteen of those seconds inside a compaction call, before the
-- model had been asked anything. No column in this table could have shown
-- that, and duration_ms actively hid it: it was measured from AFTER
-- compaction, so the slowest phase of the turn was outside the number
-- describing the turn.
--
-- WHY A COLUMN AND NOT JUST PROSE IN error. The sentence in `error` names
-- the phase and is what a person reads when they open one row. This is for
-- the other question, the one that finds a pattern rather than explaining
-- an incident: "across every failure this week, which phase overran". That
-- is not answerable by reading prose one row at a time, and it is the
-- question worth being able to ask before the next outage rather than
-- during it.
--
-- JSONB rather than columns per phase, because the phases are a property of
-- the feature and will change; a schema migration per new stage is a tax on
-- exactly the kind of instrumentation that should be cheap to add. Shape:
--
--   {
--     "totalMs": 21004,
--     "currentPhase": "compaction",
--     "timedOutPhase": "compaction",
--     "readerLeft": false,
--     "ceilingHit": false,
--     "phases": [{ "name": "...", "ms": 120, "budgetMs": 15000,
--                  "kind": "duration", "timedOut": false }],
--     "notes": { "turns": 42, "compacted": true }
--   }
--
-- NULLABLE, and null is an ordinary value rather than a gap: every row
-- written before this existed has none, and a compaction call is one
-- request inside somebody else's turn - the turn's own row carries the
-- timeline for both.
--
-- Nothing private goes in here. Phase names, millisecond counts and counts
-- of turns and files. The payload itself already has its own column and its
-- own rules.
---------------------------------------------------------------------

BEGIN;

ALTER TABLE ai_chat_request_logs
    ADD COLUMN IF NOT EXISTS phases JSONB NULL;

-- The reliability query this exists for: the failures, newest first. Partial,
-- because a successful call is not what anybody comes to this column for and
-- indexing them all would double the write cost of every send.
CREATE INDEX IF NOT EXISTS idx_ai_chat_request_logs_failures
    ON ai_chat_request_logs (created_at DESC)
    WHERE error IS NOT NULL;

INSERT INTO schema_migrations (filename) VALUES ('022_ai_chat_request_phases.sql');

COMMIT;
