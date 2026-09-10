---------------------------------------------------------------------
-- Nothing is filed until a person says where
--
-- Filing chose a folder and uploaded in one movement. The choice is made by
-- three mechanisms of very different confidence - a client-name match, a
-- model reading inconsistently named folders, or a configured holding
-- folder - and the worst outcome of the middle one is not "unfiled", it is
-- a client's meeting notes sitting in another client's folder where people
-- who should not read them will find them and nobody is looking for them.
--
-- Every guard around that was about making a wrong answer VISIBLE after the
-- fact: the reason is recorded, the decision method is recorded, the screen
-- shows both. This is the guard that makes a wrong answer impossible
-- instead, by putting a person between the decision and the write.
--
-- 'awaiting_approval' IS NOT 'pending'. Pending means the sweep will come
-- back and try again on its own; this means the opposite - nothing will
-- happen until somebody acts, and the sweep must leave it alone. Giving
-- them one value would make the sweep either abandon retries or spam a
-- decision nobody has answered.
--
-- WHAT THE ROW HOLDS WHILE IT WAITS, using columns that already exist:
--
--   folder_item_id + folder_path   a catalogued folder we propose
--   folder_path only               the configured holding folder, which is
--                                  NOT created until the answer is yes
--   neither                        nothing matched; the person chooses
--
-- So a proposal costs no write to SharePoint at all. That is the point:
-- until somebody confirms, this app has put nothing anywhere.
--
-- 'nowhere' survives and still means something narrower than it did: no
-- library could be resolved, which is a configuration fault a person
-- choosing a folder cannot fix. Rows already carrying the old meaning stay
-- readable, and a Postgres enum value cannot be dropped in any case.
--
-- ADD VALUE inside a transaction is allowed from Postgres 12 on; the new
-- member cannot be USED until this commits, which costs nothing - the first
-- row using it is written at runtime.
---------------------------------------------------------------------

BEGIN;

ALTER TYPE transcription_filing_status ADD VALUE IF NOT EXISTS 'awaiting_approval';

INSERT INTO schema_migrations (filename) VALUES ('023_transcription_filing_approval.sql');

COMMIT;
