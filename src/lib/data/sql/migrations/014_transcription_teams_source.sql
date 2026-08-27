---------------------------------------------------------------------
-- Transcriptions imported from Teams
--
-- A third source alongside 'upload' and 'recording'. Teams transcribes the
-- meeting itself, against each participant's own microphone and signed-in
-- identity, and this app fetches the result through Microsoft Graph.
--
-- SUCH A ROW HAS NO MEDIA. Nothing is uploaded, nothing goes to blob
-- storage, and no Speech job is created - it arrives with its transcript
-- already in hand. That is what the two DROP NOT NULLs below are for, and
-- it is a better answer than inventing a storage key that points at
-- nothing: a column called storage_key holding a key with no blob behind
-- it is the kind of thing that reads as a bug for years.
--
-- Worth its own source value rather than reusing 'upload', because the
-- three fail in completely different ways and which one it was is the first
-- thing anybody looks at when one goes wrong.
--
-- ADD VALUE inside a transaction is allowed from Postgres 12 on; the new
-- member simply cannot be USED until this commits, which is fine - nothing
-- below uses it, and the first row that does is written at runtime.
---------------------------------------------------------------------

BEGIN;

ALTER TYPE transcription_source ADD VALUE IF NOT EXISTS 'teams';

---------------------------------------------------------------------
-- No media, and no media type to describe it with.
--
-- storage_key keeps its UNIQUE constraint: Postgres does not consider two
-- NULLs equal, so any number of Teams rows coexist while an upload still
-- cannot collide with another upload.
---------------------------------------------------------------------
ALTER TABLE transcriptions ALTER COLUMN storage_key DROP NOT NULL;
ALTER TABLE transcriptions ALTER COLUMN media_type DROP NOT NULL;

---------------------------------------------------------------------
-- What this row was imported FROM, in the source system's own terms.
--
-- For 'teams' it is the Graph transcript id - the transcript, not the
-- meeting, because a recurring series is one meeting with many
-- occurrences and each occurrence has its own. NULL for anything recorded
-- or uploaded here, which came from nowhere but this app.
--
-- It exists to make importing IDEMPOTENT. Without it, clicking Import
-- twice - or opening the same weekly stand-up again next week - produces a
-- second copy of the same meeting and pays for a second model summary of
-- it. With it, the screen can say "already imported" and link to the one
-- that exists.
--
-- Unique PER PERSON, not globally: two people in the same meeting each
-- import their own copy, and the whole feature is per-person by design.
-- Partial, so the NULLs on every other row cost nothing.
---------------------------------------------------------------------
ALTER TABLE transcriptions ADD COLUMN IF NOT EXISTS source_ref TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transcriptions_source_ref
    ON transcriptions(user_id, source_ref)
    WHERE source_ref IS NOT NULL;

INSERT INTO schema_migrations (filename) VALUES ('014_transcription_teams_source.sql');

COMMIT;
