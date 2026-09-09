-- -------------------------------------------------------------------
-- Where a transcription's notes were filed in SharePoint, and why.
--
-- ONE ROW PER TRANSCRIPTION, and it exists for three separate reasons.
--
-- IDEMPOTENCY FIRST. The sweep that files these runs every few minutes and
-- retries what it could not finish. Without a record of "this one is done",
-- a transcription would be uploaded again on every pass - and SharePoint
-- would happily accept every copy, because a second upload of the same name
-- is a new version or a "document (2)", not an error. The unique constraint
-- is the only thing standing between one meeting and a folder full of it.
--
-- SECOND, WHY IS AS IMPORTANT AS WHERE. The destination is chosen by three
-- different mechanisms of very different confidence: a client-name match, a
-- model's judgement over inconsistent folder names, or a fallback because
-- nothing was certain. "Notes about client A are in client B's folder" is a
-- confidentiality question, and answering it needs to know which of those
-- three put it there and what its reason was. The answer alone is not
-- enough, exactly as with worklog rnd_source.
--
-- THIRD, IT RECORDS A WRITE WE MADE TO SOMEBODY ELSE'S SYSTEM. Nothing else
-- in this app writes to SharePoint. A Postgres row cannot un-upload a file,
-- so this is the only list of what we put there - and the only way to find
-- it again if a folder turns out to have been the wrong one.
-- -------------------------------------------------------------------

BEGIN;

CREATE TYPE transcription_filing_status AS ENUM (
    -- Chosen but not yet uploaded, or a previous attempt failed and will be
    -- retried.
    'pending',
    'filed',
    -- No destination could be chosen AND no fallback folder is configured,
    -- so there is nowhere to put it. Not an error: it means somebody has to
    -- decide something, and inventing a folder is a write nobody asked for.
    'nowhere',
    -- Graph refused in a way that will not fix itself: the write scope is
    -- missing, the folder was deleted, permissions changed.
    'failed'
);

-- How the destination was decided. Free text rather than an enum, matching
-- billable_source and rnd_source: a value nobody expected should land in the
-- read model and surface as a finding, not fail the write.
--   'client-name'  the folder name matched the client deterministically
--   'model'        a model chose it from the catalogued folders
--   'fallback'     nothing was certain, so the holding folder
CREATE TABLE transcription_filing (
    id                TEXT NOT NULL PRIMARY KEY,

    -- Cascades: if the transcription goes, the record of filing it is of no
    -- further use. The FILE in SharePoint is NOT removed by that - see the
    -- note above about a Postgres row being unable to un-upload anything.
    transcription_id  TEXT NOT NULL REFERENCES transcriptions(id) ON DELETE CASCADE,

    -- Whose transcription it was. Denormalised from transcriptions on
    -- purpose: every read here is scoped by owner, and the upload runs on
    -- that person's own delegated token.
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    drive_id          TEXT NULL,
    -- The Graph item id of the destination folder, and its path at the time
    -- the decision was made. The path is a SNAPSHOT: folders get renamed and
    -- moved, and "where we put it" has to stay answerable afterwards.
    folder_item_id    TEXT NULL,
    folder_path       TEXT NULL,

    decided_via       TEXT NULL,
    -- The model's one-sentence reason, or the reason nothing matched. Always
    -- shown beside the destination, because a coarse decision the reader
    -- cannot see the basis of cannot be checked.
    reason            TEXT NULL,

    status            transcription_filing_status NOT NULL DEFAULT 'pending',
    attempts          INTEGER NOT NULL DEFAULT 0,

    -- What Graph created, once it has. The web URL is what a person clicks;
    -- the item id is what a later correction would address.
    file_item_id      TEXT NULL,
    file_web_url      TEXT NULL,
    file_name         TEXT NULL,

    error             TEXT NULL,
    filed_at          TIMESTAMPTZ NULL,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- ONE FILING PER TRANSCRIPTION. The defence against a folder filling up
    -- with copies of one meeting, and the reason a retry is safe.
    CONSTRAINT transcription_filing_unique UNIQUE (transcription_id)
);

-- The sweep's query: what still needs uploading. Partial, because a row that
-- has been filed is never looked at by the sweep again.
CREATE INDEX idx_transcription_filing_pending
    ON transcription_filing (created_at)
    WHERE status = 'pending';

CREATE INDEX idx_transcription_filing_user ON transcription_filing (user_id, created_at DESC);

INSERT INTO schema_migrations (filename) VALUES ('019_transcription_filing.sql');

COMMIT;
