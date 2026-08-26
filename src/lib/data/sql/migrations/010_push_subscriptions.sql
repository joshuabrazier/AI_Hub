---------------------------------------------------------------------
-- Web Push subscriptions
--
-- One row per DEVICE, not per user. Somebody with a laptop and a phone has
-- two, and turning notifications off on one must not silence the other.
---------------------------------------------------------------------

BEGIN;

---------------------------------------------------------------------
-- Push Subscriptions Table
--
-- `installation_id` is a random id the browser keeps in localStorage, and
-- it is the natural key: it is how a device that re-subscribes updates its
-- row instead of leaving a dead one behind, and how "turn off" finds the
-- right row without the client sending an endpoint back.
--
-- It is UNIQUE across the whole table rather than per user, deliberately.
-- Two people sharing a device share an installation id, and the second one
-- to switch notifications on takes it over - which is right, because the
-- browser has exactly one push subscription and it can only deliver to
-- whoever is signed in now.
--
-- endpoint / p256dh / auth are what the push service needs to deliver a
-- message. They are per-device credentials issued by the browser vendor,
-- not secrets of ours, but they identify a person's device and are treated
-- as private: nothing reads them but the send path.
---------------------------------------------------------------------
CREATE TABLE push_subscriptions (
    id              TEXT NOT NULL PRIMARY KEY,
    installation_id TEXT NOT NULL UNIQUE,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Where the browser vendor's push service will accept a message for
    -- this device. Long, and opaque to us.
    endpoint        TEXT NOT NULL,
    -- The device's public key and auth secret, used to encrypt the payload
    -- so the push service relays something it cannot read.
    p256dh          TEXT NOT NULL,
    auth            TEXT NOT NULL,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- When a push was last accepted for this device. Null until the first
    -- one is sent; useful for spotting registrations that never deliver.
    last_used_at    TIMESTAMPTZ NULL
);

-- Sending looks up every device belonging to one person.
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id);

INSERT INTO schema_migrations (filename) VALUES ('010_push_subscriptions.sql');

COMMIT;
