-- -------------------------------------------------------------------
-- Remember that somebody wants THIS meeting imported when it ends.
--
-- The in-meeting prompt asks you to start transcription in Teams. Saying
-- "yes, I have" is what writes a row here, and a background sweep collects
-- the transcript afterwards and summarises it without anybody coming back.
--
-- WHY A ROW RATHER THAN JUST IMPORTING EVERYTHING RECENT. A sweep that
-- imported every meeting in everybody's calendar would be wrong twice: it
-- would pay for a model summary of meetings nobody wanted summarised, and it
-- would put transcripts of conversations somebody attended but did not choose
-- to keep into a system they then have to go and delete from. This table is
-- the record of an explicit, per-meeting decision, and the sweep touches
-- nothing that is not in it.
--
-- IT IS ALSO WHAT MAKES THE SWEEP DELEGATED. The import runs as the person
-- who armed it, on their own refresh token, so Graph enforces that they were
-- in the meeting. Nothing here escalates: a row cannot cause a transcript to
-- be fetched for anybody but its own user_id.
-- -------------------------------------------------------------------

BEGIN;

CREATE TYPE teams_auto_import_status AS ENUM (
    -- Waiting for the meeting to end, then for Teams to finalise a
    -- transcript. The ordinary state for most of a row's life.
    'pending',
    -- A transcription row exists. transcription_id says which.
    'imported',
    -- The meeting ended and no transcript ever appeared inside the window.
    -- Almost always means nobody actually started transcription, which is a
    -- perfectly ordinary outcome and NOT an error - the prompt asks, it does
    -- not compel. Kept as its own value so the two are told apart on screen.
    'no_transcript',
    -- Graph refused in a way that will not fix itself: the meeting belongs to
    -- another tenant, the transcript API is switched off, consent is missing.
    'failed',
    -- Somebody dismissed the prompt after arming it.
    'cancelled'
);

CREATE TABLE teams_auto_import (
    id                TEXT NOT NULL PRIMARY KEY,

    -- WHOSE MEETING, and whose token the import runs on. Cascades: if the
    -- account goes, so does any pending intent to fetch their meetings.
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- The calendar event. Fetched with Prefer: IdType="ImmutableId" like
    -- every other id this feature compares, so it survives the event moving
    -- between calendars.
    event_id          TEXT NOT NULL,

    -- Snapshotted for display, so the list reads sensibly without a Graph
    -- call, and still reads sensibly if the meeting is later deleted.
    subject           TEXT NULL,

    -- WHEN TO START LOOKING. The sweep leaves a meeting alone until it has
    -- ended, because a transcript does not exist before then.
    ends_at           TIMESTAMPTZ NOT NULL,

    status            teams_auto_import_status NOT NULL DEFAULT 'pending',

    -- How many times the sweep has asked Graph. Teams takes minutes to
    -- finalise a transcript and sometimes never produces one, so this bounds
    -- the asking rather than letting a meeting nobody transcribed be polled
    -- forever.
    attempts          INTEGER NOT NULL DEFAULT 0,
    last_attempt_at   TIMESTAMPTZ NULL,

    -- What it produced, or why it did not. Both nullable; exactly one is set
    -- once status leaves 'pending'.
    transcription_id  TEXT NULL REFERENCES transcriptions(id) ON DELETE SET NULL,
    error             TEXT NULL,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- ONE INTENT PER PERSON PER MEETING. Arming twice - two tabs, a reload,
    -- a second prompt after a dismissal - must not produce two rows and two
    -- paid summaries of one conversation. The import itself is idempotent on
    -- source_ref as well, so this is the first of two defences rather than
    -- the only one.
    CONSTRAINT teams_auto_import_unique_per_meeting UNIQUE (user_id, event_id)
);

-- The sweep's only query: rows still pending, whose meeting has ended.
-- Partial, because once a row leaves 'pending' it is never looked at by the
-- sweep again and there is no reason to carry it in the index.
CREATE INDEX idx_teams_auto_import_due
    ON teams_auto_import (ends_at)
    WHERE status = 'pending';

-- A person's own list, newest first.
CREATE INDEX idx_teams_auto_import_user ON teams_auto_import (user_id, created_at DESC);

INSERT INTO schema_migrations (filename) VALUES ('018_teams_auto_import.sql');

COMMIT;
