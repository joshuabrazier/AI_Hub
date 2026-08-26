---------------------------------------------------------------------
-- Meeting transcription
--
-- Numbered 009 rather than 004 on purpose. The development database has
-- 000-008 applied, but only 000-003 have files on this branch: 004-008
-- are the timesheet work, which lives on feat/timesheets and has not been
-- merged here. Reusing one of those numbers would make the ordering
-- ambiguous for anybody building a fresh environment later.
--
-- The ALTER TYPE below is additive, so it is safe against a database that
-- already carries the timesheet members on that enum and against one that
-- does not.
---------------------------------------------------------------------

BEGIN;

---------------------------------------------------------------------
-- Where a transcription is up to.
--
-- This is a LONG-RUNNING job, not a request. An hour of audio takes
-- minutes to transcribe, so the row exists before the work is done and
-- moves through these states as it progresses. Every screen reads the
-- status rather than waiting on anything.
--
--   awaiting_media  the row exists, the file has not finished uploading
--   queued          uploaded, handed to the Speech service
--   transcribing    Speech is working on it
--   summarising     transcript is back, the model is summarising it
--   completed       the TRANSCRIPT is stored
--   failed          there is no transcript; `error` says why
--
-- 'summarising' is its own state rather than part of 'transcribing'
-- because the two can fail independently, and that difference is the
-- reason 'completed' is defined by the transcript alone: the transcript
-- is what the person asked for, and a summary that would not generate
-- must not take it down with it. A completed row with a NULL `summary`
-- and a non-NULL `error` is exactly that case, and the screen offers to
-- try the summary again.
---------------------------------------------------------------------
CREATE TYPE transcription_status AS ENUM (
    'awaiting_media',
    'queued',
    'transcribing',
    'summarising',
    'completed',
    'failed'
);

---------------------------------------------------------------------
-- How the media arrived. Recorded in the browser, or uploaded as a file.
-- Kept because the two have different failure modes worth telling apart
-- when something goes wrong: a recording is always WebM and always
-- supported, an upload can be any format the user happened to have.
---------------------------------------------------------------------
CREATE TYPE transcription_source AS ENUM (
    'upload',
    'recording'
);

---------------------------------------------------------------------
-- Summarising a transcript is a call to the model, so it is recorded in
-- ai_chat_request_logs like every other one. The table is named for chat
-- but it is the app's record of what is sent to Bedrock, and a second
-- log with the same purpose would just be a place for one of them to be
-- forgotten.
--
-- ADD VALUE inside a transaction is allowed from Postgres 12 on; the new
-- member simply cannot be USED until this commits, which is fine - the
-- first row that uses it is written at runtime, long afterwards.
---------------------------------------------------------------------
ALTER TYPE ai_chat_request_kind ADD VALUE IF NOT EXISTS 'transcription';

---------------------------------------------------------------------
-- Transcriptions Table
--
-- One row per recording or uploaded file, owned by one person. Same
-- boundary as AI chat: `user_id` is the authorization check and every
-- query carries it, because these are recordings of meetings and are as
-- private as the conversation they capture.
--
-- MEDIA LIVES IN BLOB STORAGE, not here - `storage_key` points at it.
-- A meeting recording is tens or hundreds of megabytes, which is far
-- past anything that belongs in a database column, and Azure Postgres
-- storage cannot be shrunk once grown. The same cascade problem as chat
-- attachments applies: deleting this row cannot remove the blob, so the
-- delete paths clear storage first.
---------------------------------------------------------------------
CREATE TABLE transcriptions (
    id           TEXT NOT NULL PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Named by the person, or derived from the filename on upload.
    title        TEXT NOT NULL,
    source       transcription_source NOT NULL,
    status       transcription_status NOT NULL DEFAULT 'awaiting_media',

    -- 'transcription/{user_id}/{id}' - the media blob. The user prefix
    -- lets everything belonging to one person be removed by prefix when
    -- their account is de-identified, without the rows that name it.
    storage_key  TEXT NOT NULL UNIQUE,
    -- Server-derived, never what the browser claimed.
    media_type   TEXT NOT NULL,
    byte_size    BIGINT NULL,
    duration_seconds INT NULL,

    -- The Speech service's own job id, so a run in flight can be polled
    -- after a page reload or a restart. NULL until the job is created.
    speech_job_id TEXT NULL,

    -- The full transcript as plain text, and the speaker turns behind it.
    -- `segments` is JSONB rather than its own table: it is always read and
    -- written whole, and an hour of speech is a few hundred kilobytes.
    transcript   TEXT NULL,
    segments     JSONB NULL,

    -- The model's summary of the transcript. NULL if summarising has not
    -- run, or failed - which is survivable, the transcript still stands.
    summary      TEXT NULL,

    -- Why something did not work. Usually paired with status 'failed',
    -- but also set on a 'completed' row whose summary would not generate.
    -- Holds an error name and message, never a stack trace or a payload.
    error        TEXT NULL,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ NULL
);

-- The list screen: this person's transcriptions, newest first.
CREATE INDEX idx_transcriptions_user ON transcriptions(user_id, created_at DESC);

-- Partial index for the sweep that advances jobs left in flight when
-- somebody closed the tab. It runs per person, on page load, so it is
-- keyed by owner; the WHERE clause keeps the index to the handful of rows
-- that are actually unfinished rather than everything ever transcribed.
CREATE INDEX idx_transcriptions_pending ON transcriptions(user_id, created_at)
    WHERE status IN ('queued', 'transcribing', 'summarising');

INSERT INTO schema_migrations (filename) VALUES ('009_transcription.sql');

COMMIT;
