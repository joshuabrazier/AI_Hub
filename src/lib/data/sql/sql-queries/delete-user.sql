-- -------------------------------------------------------------------
-- Delete a single user, and everything that would otherwise block it.
--
-- An operational helper, not part of the schema. Prefer DEACTIVATING a person
-- (users.is_active = FALSE), which keeps the audit trail attributable; use this
-- only when the record genuinely has to be removed.
--
-- Set the email below, then run the whole file. It runs in a transaction, so a
-- failure part-way through deletes nothing.
--
-- What happens to related rows:
--   cascaded automatically  two_factor, notifications, document_signatures
--   set to NULL             audit_logs.actor_user_id and other created_by
--                           columns declared ON DELETE SET NULL
--   deleted here            accounts, sessions, and any invitations this user
--                           SENT - user_invitations.inviter_id is a plain FK
--                           with no ON DELETE rule, so those rows would
--                           otherwise reject the delete
--
-- The audit trail deliberately survives: actor_name and actor_role are
-- snapshotted onto each row, so history stays readable once the account is gone.
-- -------------------------------------------------------------------

BEGIN;

DO $$
DECLARE
    -- >>> Set this before running. <<<
    var_email   TEXT := 'replace-me@example.com';
    var_user_id TEXT;
BEGIN
    SELECT id INTO var_user_id
    FROM public.users
    WHERE lower(email) = lower(var_email);

    IF var_user_id IS NULL THEN
        RAISE EXCEPTION 'No user found with email %', var_email;
    END IF;

    DELETE FROM public.user_invitations WHERE inviter_id = var_user_id;
    DELETE FROM public.accounts         WHERE user_id    = var_user_id;
    DELETE FROM public.sessions         WHERE user_id    = var_user_id;
    DELETE FROM public.users            WHERE id         = var_user_id;

    RAISE NOTICE 'Deleted user % (%)', var_email, var_user_id;
END $$;

COMMIT;
