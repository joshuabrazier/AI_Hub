---------------------------------------------------------------------
-- Keep what was summarised, and what came back
--
-- THIS REVERSES A DELIBERATE DECISION, and the reasoning it reverses is
-- worth stating rather than deleting. Summaries stored nothing on purpose:
-- the input is whatever somebody pasted - a contract, a medical letter, a
-- client's board paper - so keeping a copy of it alongside the model's
-- reading of it makes this the most sensitive table in the application.
-- That was judged not worth it for a feature nobody had asked to be able
-- to return to.
--
-- Somebody has now asked. So the cost is paid deliberately and the
-- consequences are handled here rather than discovered later:
--
--   IT IS PER PERSON. user_id is the boundary, exactly as it is for chat
--   and transcription. There is no shared view of these and no admin
--   screen over them - the only path to a row is the person who made it.
--
--   IT CASCADES. Deleting or de-identifying a user takes their summaries
--   with them, in the database, without any application code running.
--
--   IT AGES OUT. TEXT_SUMMARY_RETENTION_DAYS, swept by the monthly
--   retention job. An unbounded table of pasted contracts is a liability
--   that grows on its own.
--
--   THE SCREEN NO LONGER PROMISES OTHERWISE. The page said a refresh lost
--   the summary, which was true and is now a lie. That copy changes in the
--   same commit as this file, because a privacy promise and the schema
--   behind it must never be able to drift apart.
--
-- WHAT IS NOT HERE: token counts. ai_chat_request_logs already records
-- them per call under the text_summary kind, and a second copy on a second
-- retention window would disagree with the first one eventually.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f src/lib/data/sql/migrations/034_text_summaries.sql
---------------------------------------------------------------------

BEGIN;

---------------------------------------------------------------------
-- Which of the three questions was asked.
--
-- The styles are three different PROMPTS rather than one prompt with a
-- length, so this is not a presentation flag - it records what the model
-- was actually asked for, and a summary reread six months later is only
-- interpretable next to it.
---------------------------------------------------------------------
CREATE TYPE text_summary_style AS ENUM (
    'detailed',
    'summary',
    'executive'
);

CREATE TABLE IF NOT EXISTS text_summaries (
    id            TEXT NOT NULL PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Derived from the first line of the source, so the list can be read
    -- without loading the source itself. Stored rather than computed on
    -- read because the whole point of the column is that the list query
    -- never has to touch source_text.
    title         TEXT NOT NULL,
    style         text_summary_style NOT NULL,

    -- The pasted material. The sensitive half, and the reason for every
    -- note above.
    source_text   TEXT NOT NULL,

    -- The model's answer. NULL while it is still streaming, and on a row
    -- whose call failed before a single token arrived. A row can also hold
    -- a PARTIAL summary and an error together - the reader closed the tab
    -- part way - which is worth keeping rather than discarding, because
    -- half an answer to a long document is still an answer.
    summary       TEXT NULL,

    -- Why it is not finished, when it is not. NULL on a complete row.
    error         TEXT NULL,

    -- Cheap enough to store and expensive to derive: length(source_text)
    -- on a 400,000 character column, per row, on every list render.
    input_chars   INTEGER NOT NULL,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Set when the stream ended without error. NULL means it did not.
    completed_at  TIMESTAMPTZ NULL
);

-- The only read this table has: one person's own summaries, newest first.
CREATE INDEX IF NOT EXISTS idx_text_summaries_user_created
    ON text_summaries (user_id, created_at DESC);

-- The retention sweep, which deletes by age across every owner.
CREATE INDEX IF NOT EXISTS idx_text_summaries_created_at
    ON text_summaries (created_at);

INSERT INTO schema_migrations (filename) VALUES ('034_text_summaries.sql');

COMMIT;
