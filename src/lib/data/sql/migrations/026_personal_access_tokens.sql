---------------------------------------------------------------------
-- A credential for something that is not a browser
--
-- Every guarded surface in this app resolves its actor from a Better Auth
-- session cookie, which is right for a person at a screen and impossible
-- for Claude Code, a script, or anything else calling in from outside. This
-- is the other way in: a token a signed-in person mints for themselves,
-- which names them to the app.
--
-- IT BYPASSES THE SECOND FACTOR, AND THAT IS THE WHOLE COST OF IT. requireUser
-- gates on isTwoFactorSatisfied against session_two_factor, and a bearer
-- token has no session to be satisfied. That is the same trade every
-- personal access token makes, and the mitigations are the usual ones and
-- all of them matter:
--
--   MINTED FROM A FULLY AUTHENTICATED SESSION. You cannot create one without
--   having already passed the factor you are about to be able to skip.
--   EXPIRING by default, because a credential with no end is one nobody ever
--   gets round to removing.
--   REVOCABLE in one act, and revocation is a timestamp rather than a delete
--   so "this was turned off on the 3rd" stays answerable.
--   NARROW. `scope` says which surface a token may reach, and a route has to
--   opt IN to accepting token auth. It is deliberately not a general
--   replacement for a session: a token that could do anything a person can
--   would be a way around the second factor for the whole app rather than
--   for one endpoint.
--   RECORDED. last_used_at is what answers "is this still being used" before
--   somebody revokes it, and what shows a leaked one being used at all.
--
-- ONLY THE HASH IS STORED. A token is high-entropy random, so a single
-- SHA-256 is the right function here - the stretching a password needs
-- exists to make guessing expensive, and there is nothing to guess in 32
-- random bytes. Storing the plaintext would make this table worth stealing.
--
-- `prefix` is the first few characters, kept in clear so a person can tell
-- their tokens apart in a list and match one to a leaked string, which is
-- the whole reason tokens carry a readable prefix at all.
---------------------------------------------------------------------

BEGIN;

CREATE TABLE personal_access_tokens (
    id           TEXT NOT NULL PRIMARY KEY,

    -- Cascades. A token is that person's credential and means nothing once
    -- the account is gone.
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Typed by the person who made it, so they can tell "my laptop" from
    -- "the build box" when deciding which to revoke.
    name         TEXT NOT NULL,

    -- SHA-256 of the token. UNIQUE so a collision is a constraint violation
    -- rather than two accounts answering to one string.
    token_hash   TEXT NOT NULL UNIQUE,
    prefix       TEXT NOT NULL,

    -- What this token may reach. A route opts in to a scope; a token
    -- carrying a different one is refused by the route rather than by the
    -- service, so a widened service cannot quietly widen every token.
    scope        TEXT NOT NULL,

    last_used_at TIMESTAMPTZ NULL,
    -- NULL means it does not expire, which is allowed and is not the
    -- default. The screen that creates one says so.
    expires_at   TIMESTAMPTZ NULL,
    -- A timestamp rather than a delete, so "this was turned off on the 3rd"
    -- stays answerable after the fact.
    revoked_at   TIMESTAMPTZ NULL,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The verification path: one lookup by hash on every authenticated request,
-- so it is the one index that has to be there. UNIQUE above already provides
-- it; this is the list a person sees of their own.
CREATE INDEX idx_personal_access_tokens_user ON personal_access_tokens (user_id, created_at DESC);

INSERT INTO schema_migrations (filename) VALUES ('026_personal_access_tokens.sql');

COMMIT;
