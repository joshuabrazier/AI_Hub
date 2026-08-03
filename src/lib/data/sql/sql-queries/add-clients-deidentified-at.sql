-- Data retention (see docs/data-retention.md).
-- Adds the marker column used to record that a family's personal data has been
-- de-identified. Nullable and additive: adding it changes no existing data.
-- Idempotent (IF NOT EXISTS) so it is safe to run more than once.
--
-- Apply once to each environment's database (e.g. via the Neon SQL editor)
-- before enabling the retention job.

ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS deidentified_at TIMESTAMPTZ NULL;
