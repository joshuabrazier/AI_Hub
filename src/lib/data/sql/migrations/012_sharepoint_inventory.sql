---------------------------------------------------------------------
-- SharePoint inventory - phase 1, READ ONLY
--
-- Numbered 012, not the 011 the spec names. Check before assuming: this
-- branch already carries two 009s, two 010s and an 011, because the
-- timesheet, transcription, push and two-factor work were numbered on
-- separate branches before they met. 012 is the first free number.
--
-- WHAT THIS IS FOR. Company SharePoint is disorganised and we want to
-- propose a better structure. The load-bearing decision is that ALL
-- analysis runs against these tables and never against Graph: we crawl
-- once, then iterate on the analysis for free, with no throttling, no rate
-- limits and no risk of touching anything. A design that queried Graph
-- during analysis would be throttled, slow and impossible to test.
--
-- NOTHING HERE WRITES TO SHAREPOINT, and nothing here is scaffolding for
-- something that will. There is no proposal table, no move table and no
-- approval table, because those belong to phases that have not been agreed
-- yet and a half-built table is worse than no table.
---------------------------------------------------------------------

BEGIN;

---------------------------------------------------------------------
-- A nominated document library.
--
-- One row per library somebody has asked us to look at. Nothing is
-- crawled that is not nominated, so this table IS the scope of the
-- feature - an admin adding a row is the whole consent story.
--
-- `delta_link` is the point of the design. Graph's delta endpoint hands
-- back a token that means "everything as of now"; presenting it later
-- returns only what has changed since. So a re-crawl costs one call plus
-- the changes, and crawling from scratch becomes a deliberate act rather
-- than the default. It is NULL until the first crawl finishes - see the
-- note on sharepoint_crawl.next_link for why an interrupted crawl must
-- never write one.
--
-- `nominated_by_name` is snapshotted beside the id for the same reason
-- audit_logs snapshots its actor: the row should still say who asked for
-- this after that account is renamed or removed.
---------------------------------------------------------------------
CREATE TABLE sharepoint_drive (
    -- Graph's own drive id. Opaque, stable, and the natural key - there is
    -- no reason to mint one of our own and then have to map it back.
    drive_id                TEXT PRIMARY KEY,

    site_id                 TEXT NOT NULL,
    site_name               TEXT NOT NULL,
    drive_name              TEXT NOT NULL,
    -- Where a person goes to see the library themselves. The only link
    -- from our inventory back to the real thing.
    web_url                 TEXT NOT NULL,

    nominated_by            TEXT REFERENCES users(id) ON DELETE SET NULL,
    nominated_by_name       TEXT,

    delta_link              TEXT,
    delta_link_updated_at   TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

---------------------------------------------------------------------
-- One crawl of one library.
--
-- A crawl OUTLIVES THE REQUEST that starts it and will be interrupted, so
-- this is a state machine on a row, exactly like transcriptions. Whoever
-- is looking at the screen advances it, and a timed sweep advances it for
-- everybody. There is deliberately no worker: the honest argument for one
-- needs throughput numbers we do not have yet, and building it on a guess
-- is how you get a queue that can be down while the page reports progress.
--
--   queued            nominated, nothing fetched yet
--   running           walking pages
--   paused_throttled  SharePoint said stop; throttled_until says when
--   needs_reauth      the delegated token cannot be renewed; a PERSON must
--                     sign in again. Never retried in a loop.
--   completed         the walk finished and delta_link was written
--   failed            gave up; `error` says why
--
-- 'needs_reauth' is its own state rather than a kind of failure because
-- the remedy is completely different. A failure is ours to fix; this one
-- can only be cleared by a named human signing in, and reporting it as a
-- fault would send somebody looking through logs for a bug that is not
-- there.
---------------------------------------------------------------------
CREATE TYPE sharepoint_crawl_status AS ENUM (
    'queued',
    'running',
    'paused_throttled',
    'needs_reauth',
    'completed',
    'failed'
);

CREATE TABLE sharepoint_crawl (
    id                  TEXT PRIMARY KEY,
    drive_id            TEXT NOT NULL REFERENCES sharepoint_drive(drive_id) ON DELETE CASCADE,

    status              sharepoint_crawl_status NOT NULL DEFAULT 'queued',

    -- WHOSE delegated token this crawl uses, and therefore whose access it
    -- is bounded by. This is the entire access-control story of phase 1:
    -- SharePoint enforces permissions, not our code, so a crawl can only
    -- ever see what this person could already open themselves.
    --
    -- NOT NULL and RESTRICT rather than SET NULL: a crawl with no owner has
    -- no token to run on and no answer to "who was allowed to see this",
    -- so the row must not be able to outlive the account.
    run_as_user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- Where to resume. Graph hands back a nextLink per page; storing it is
    -- what makes an interrupted crawl cheap to continue.
    --
    -- A COMPLETED crawl has next_link NULL and the drive has a delta_link.
    -- An interrupted one has next_link set and the drive's delta_link
    -- unchanged. That asymmetry is deliberate: writing a delta_link
    -- mid-walk would claim we had seen everything, and the next crawl would
    -- skip the part we never reached.
    next_link           TEXT,

    items_seen          INTEGER NOT NULL DEFAULT 0,
    pages_done          INTEGER NOT NULL DEFAULT 0,

    -- When a 429 said to stop. Durable on purpose: the in-process throttle
    -- gate dies with the process, and a restarted crawl that forgot it was
    -- throttled would walk straight back into the block.
    throttled_until     TIMESTAMPTZ,

    error               TEXT,

    started_at          TIMESTAMPTZ,
    finished_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The sweep asks "which crawls are unfinished" on a timer, so it is worth
-- an index. Partial, because finished rows are the overwhelming majority
-- once this has been running a while and they are never the answer.
CREATE INDEX sharepoint_crawl_unfinished_idx
    ON sharepoint_crawl (status, updated_at)
    WHERE status IN ('queued', 'running', 'paused_throttled');

-- "What happened to this library" is the other question asked of this table.
CREATE INDEX sharepoint_crawl_drive_idx ON sharepoint_crawl (drive_id, created_at DESC);

---------------------------------------------------------------------
-- One file or folder, as we last saw it.
--
-- CURRENT STATE, not history. Delta reports what changed; we apply it here
-- rather than keeping a row per observation, because the analysis in later
-- phases asks "what does this library look like" and never "what did it
-- look like in March".
--
-- Deletion is SOFT. Graph reports a removal as a tombstone, and phase 2
-- wants to say "this folder is empty now" rather than silently losing the
-- fact that something was there. A hard delete would also make a re-crawl
-- indistinguishable from a first crawl.
---------------------------------------------------------------------
CREATE TABLE sharepoint_item (
    drive_id            TEXT NOT NULL REFERENCES sharepoint_drive(drive_id) ON DELETE CASCADE,
    item_id             TEXT NOT NULL,

    parent_id           TEXT,
    name                TEXT NOT NULL,
    -- The folder path as Graph reports it on parentReference. Stored rather
    -- than derived, because deriving it needs the whole ancestor chain in
    -- memory and delta does not promise to send parents before children.
    path                TEXT,
    -- Precomputed so phase 2 can find depth outliers without walking the
    -- tree. Cheap to write once, expensive to recompute per query.
    depth               INTEGER,

    is_folder           BOOLEAN NOT NULL,
    size_bytes          BIGINT,
    -- Folders only. An empty folder and a folder holding one item are both
    -- phase-2 findings, and both come straight from this.
    child_count         INTEGER,

    -- SharePoint's own content hash. The duplicate detection in phase 2 is
    -- built on this, which is why it is worth a column and an index rather
    -- than being recomputed from bytes we would have to download.
    quick_xor_hash      TEXT,

    created_at_remote   TIMESTAMPTZ,
    modified_at_remote  TIMESTAMPTZ,
    -- Display only, and snapshotted. "Who owns this mess" is the first
    -- question asked of the report, and resolving it later would mean
    -- another Graph call per item.
    modified_by_name    TEXT,

    -- Whether the item breaks permission inheritance.
    --
    -- LEFT NULL BY PHASE 1, deliberately. Phase 5 needs it to exclude
    -- uniquely-permissioned items from automatic movement, which is the
    -- sharpest edge in the whole feature. But it is not confirmed that the
    -- delta endpoint can return it, and a column populated from a guess is
    -- worse than one honestly empty: NULL reads as "not established", a
    -- wrong false reads as "safe to move".
    has_unique_permissions BOOLEAN,

    deleted_at          TIMESTAMPTZ,

    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Composite: an item id is only unique within its drive.
    PRIMARY KEY (drive_id, item_id)
);

-- Walking the tree, which is how the folder structure is read.
CREATE INDEX sharepoint_item_parent_idx ON sharepoint_item (drive_id, parent_id);

-- Duplicate detection. Partial, because a folder has no hash and NULL rows
-- would be most of a full index on a library with deep nesting.
CREATE INDEX sharepoint_item_hash_idx
    ON sharepoint_item (drive_id, quick_xor_hash)
    WHERE quick_xor_hash IS NOT NULL;

-- Every analysis query excludes tombstones, so it is worth making that
-- cheap rather than a full scan on a fifty thousand row library.
CREATE INDEX sharepoint_item_live_idx
    ON sharepoint_item (drive_id)
    WHERE deleted_at IS NULL;

---------------------------------------------------------------------
-- RETENTION
--
-- Crawled metadata is company data and needs a window like everything else
-- here. File paths and document names are themselves disclosive: "Redundancy
-- consultation - Jan.docx" tells you the thing without anybody opening it.
--
-- The sweep, added to the existing monthly job, does TWO things and
-- deliberately not a third:
--
--   1. deletes sharepoint_crawl rows older than the window. They are a log
--      of runs, and an old run answers nothing.
--   2. deletes sharepoint_item rows whose drive is no longer nominated.
--      De-nominating a library is what removes its contents, and that is
--      the control an admin actually has.
--
-- It does NOT expire items on a live drive. A path is only disclosive while
-- it describes something real, and ageing out live rows would just force a
-- full re-crawl to rebuild the same data - more Graph traffic, same
-- exposure, no gain. The ON DELETE CASCADE above is what makes (2) a single
-- statement.
---------------------------------------------------------------------

INSERT INTO schema_migrations (filename) VALUES ('012_sharepoint_inventory.sql');

COMMIT;
