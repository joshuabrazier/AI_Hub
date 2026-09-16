---------------------------------------------------------------------
-- "Turn the recording on" - and only once
--
-- A push goes out when a Teams meeting starts, telling whoever is in it to
-- press record. Teams is what announces a recording to the room, so the app
-- can only ask; it cannot start one.
--
-- THIS TABLE EXISTS FOR EXACTLY ONE REASON: the sweep runs on a timer and
-- looks BACKWARDS over a window, so the same meeting is in range on several
-- consecutive runs. Without a row saying "this person has been told about
-- this meeting", a two-minute timer with a ten-minute window sends five
-- notifications for one meeting. That is worse than sending none - a
-- notification somebody has learned to dismiss is a notification they will
-- dismiss on the day it mattered.
--
-- THE UNIQUE CONSTRAINT IS THE CLAIM, not a tidy-up. Two sweeps can overlap:
-- a slow run and the next one on the timer, or two instances after a scale
-- out. Whoever inserts the row owns the send and everybody else walks away,
-- which is the same shape transcription_filing and the transition claim use.
-- A check-then-send would race; an insert cannot.
--
-- KEYED ON (user_id, event_id) AND NOT ON THE MEETING. Everybody from here
-- who is in the meeting gets their own nudge - that is the decision, because
-- only one person needs to press record but nobody knows in advance which
-- one will be in a position to. So the row is per PERSON per meeting.
--
-- event_id IS THE IMMUTABLE ID from the calendar read, and it is per mailbox
-- rather than per meeting - each attendee has their own copy of the event.
-- That is exactly right here and exactly wrong for filing, which is why
-- filing matches on the transcript id instead. See
-- transcriptIdFromSourceRef.
--
-- starts_at IS KEPT rather than derived, so the retention sweep can drop old
-- rows by age without a Graph call, and so "why did I get this at 3pm" is
-- answerable afterwards.
--
-- Apply manually:
--   psql "$DATABASE_URL" -f src/lib/data/sql/migrations/033_meeting_recording_reminders.sql
---------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS meeting_recording_reminders (
    id         TEXT NOT NULL PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The calendar event's immutable id, as this person's mailbox holds it.
    event_id   TEXT NOT NULL,
    -- Snapshotted for the audit answer above. NULL when the event had none,
    -- which Graph allows.
    subject    TEXT NULL,
    starts_at  TIMESTAMPTZ NOT NULL,
    sent_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- The claim. See the note above: this is what makes the send happen once
    -- rather than once per sweep.
    CONSTRAINT meeting_recording_reminders_once UNIQUE (user_id, event_id)
);

-- The sweep deletes by age, and nothing else reads this table by anything
-- but the unique key above.
CREATE INDEX IF NOT EXISTS idx_meeting_recording_reminders_starts_at
    ON meeting_recording_reminders (starts_at);

INSERT INTO schema_migrations (filename) VALUES ('033_meeting_recording_reminders.sql');

COMMIT;
