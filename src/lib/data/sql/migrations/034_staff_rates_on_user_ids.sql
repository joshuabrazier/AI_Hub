---------------------------------------------------------------------
-- Staff rates move off Atlassian ids, like the targets did
--
-- NUMBERED 034, NOT 030, AND THE GAP IS NOT AN ACCIDENT. It was written as
-- 030 before 030 and 031 were vacated by a collision renumber, and by the
-- time it merged, 032 and 033 had already been applied to the databases.
-- Leaving it at 030 would have put a file EARLIER in the directory than two
-- migrations that genuinely ran before it - so anybody reading the folder in
-- order would have the sequence wrong. Nothing here depends on 032 or 033
-- (they add a project kind and a recording reminder), so the renumber is
-- about the reading and not about the running.
--
-- 028 re-keyed `staff_target.person_id` from an Atlassian accountId to
-- `users.id`, because the reports identify a person that way now. It missed
-- `staff_rate`, which is keyed exactly the same way and is read by exactly
-- the same figures.
--
-- WHAT THE MISS WOULD HAVE COST. `computeRevenue` looks a person's rate up by
-- the fact's `personId`. With the rates still on Atlassian ids and the facts
-- on user ids, NOTHING matches - so every hour lands in `unratedSeconds` and
-- the chargeable value, the cost and the margin all come out as nothing
-- earned on a period that was fully booked.
--
-- It would at least have been LOUD rather than silent: the engine counts
-- unrated and uncosted seconds separately and the screen reports them, which
-- is the whole reason those two counters exist. "Every hour is unrated" is a
-- finding somebody would chase. It would still have been wrong for however
-- long it took to chase.
--
-- SAME SHAPE AS 028, for the same reasons: joined on
-- `users.atlassian_account_id`, which is the mapping and is kept; rows that
-- match are rewritten and rows that do not are left exactly as they are
-- rather than deleted; and no foreign key is added, because it would fail
-- this migration on precisely the row that most needs to survive long enough
-- for somebody to look at it.
--
-- `person_name` is deliberately not touched. It is a label carried for
-- display when a rate outlives the account it belongs to, and rewriting it
-- from `users` would replace a name recorded at the time with today's.
---------------------------------------------------------------------
BEGIN;

UPDATE staff_rate AS r
SET person_id = u.id,
    updated_at = NOW()
FROM users AS u
WHERE u.atlassian_account_id = r.person_id;

INSERT INTO schema_migrations (filename) VALUES ('034_staff_rates_on_user_ids.sql');

COMMIT;
