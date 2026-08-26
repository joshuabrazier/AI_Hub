---------------------------------------------------------------------
-- Per-session two-factor verification
--
-- WHY THIS TABLE EXISTS AT ALL, because it is not how 2FA normally works.
--
-- Better Auth's twoFactor plugin challenges on the PASSWORD sign-in path
-- only - its hook matches /sign-in/email, /sign-in/username and
-- /sign-in/phone-number. Sign-in here is Microsoft, which never touches
-- those endpoints, so the plugin's own challenge never fires and a social
-- sign-in lands with a fully valid session having presented one factor.
--
-- So the second factor is enforced as a GATE ON THE SESSION rather than as
-- part of sign-in: the session exists, and is refused everywhere until it
-- has been verified once. This table is that state.
--
-- It is keyed on the SESSION, not the user, and cascades with it. Two
-- consequences, both wanted: signing out or having a session revoked
-- discards the verification, and a second device has to verify on its own
-- rather than riding on the first one's.
---------------------------------------------------------------------

BEGIN;

---------------------------------------------------------------------
-- Session Two Factor Table
--
-- One row per session that has ATTEMPTED verification - the row is created
-- on the first attempt, not on success, because the failure counters have
-- to survive a wrong code.
--
-- verified_at NULL therefore means "tried and did not get in", which is a
-- different state from having no row at all, and the gate treats both as
-- unverified.
--
-- failed_count / locked_until are this feature's own rate limiting and are
-- not optional. Better Auth's verifyTOTP applies its attempt limiter only
-- on the sign-in path (`beginAttempt` is null when a session already
-- exists), so on this path there is nothing between an attacker holding a
-- stolen session cookie and unlimited six-digit guesses.
---------------------------------------------------------------------
CREATE TABLE session_two_factor (
    session_id   TEXT NOT NULL PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    verified_at  TIMESTAMPTZ NULL,
    failed_count INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The gate reads this on every guarded request, keyed on the session id, so
-- the primary key already serves it. No second index is needed.

INSERT INTO schema_migrations (filename) VALUES ('011_session_two_factor.sql');

COMMIT;
