import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import type { NewSharepointItem } from "../kysely-database-types";

// -------------------------------------------------------------------
// The inventory itself - one row per file or folder, as we last saw it.
//
// CURRENT STATE, not history. Delta tells us what changed and we apply it
// here, because everything downstream asks what the library looks like and
// nothing asks what it looked like in March.
//
// No user scoping, and that is not an omission. The access decision was
// made before any of this was written: SharePoint itself decided what the
// delegated token could read, so a row existing here already means the
// person the crawl ran as could open it. Filtering again on our side would
// be a second, weaker copy of a check SharePoint already made properly.
// -------------------------------------------------------------------

// Postgres allows 65535 bound parameters in one statement. At roughly
// fifteen columns a row that is around four thousand items, so a chunk of
// five hundred leaves a wide margin and still means one round trip per
// delta page rather than one per item.
const UPSERT_CHUNK_SIZE = 500;

// -------------------------------------------------------------------
// Apply a page of live items.
//
// LAST WRITE WINS on everything except two columns, and both exceptions
// are the point:
//
//   firstSeenAt is never overwritten. It is how long the item has been in
//   the inventory, and re-crawling a library must not reset the age of
//   everything in it.
//
//   deletedAt is CLEARED. An item can come back - restored from the
//   recycle bin, or moved out of a folder and back into one - and leaving
//   the tombstone would report a file that plainly exists as gone.
//
// hasUniquePermissions is absent from both halves deliberately. Phase 1
// does not establish it, and writing it would mean guessing.
// -------------------------------------------------------------------
export async function upsertSharepointItemsRepo(
  items: NewSharepointItem[],
  db: DBClient = database,
): Promise<number> {
  if (items.length === 0) return 0;

  try {
    let written = 0;

    for (let start = 0; start < items.length; start += UPSERT_CHUNK_SIZE) {
      const chunk = items.slice(start, start + UPSERT_CHUNK_SIZE);

      await db
        .insertInto("sharepointItem")
        .values(chunk)
        .onConflict((oc) =>
          oc.columns(["driveId", "itemId"]).doUpdateSet({
            parentId: (eb) => eb.ref("excluded.parentId"),
            name: (eb) => eb.ref("excluded.name"),
            path: (eb) => eb.ref("excluded.path"),
            depth: (eb) => eb.ref("excluded.depth"),
            isFolder: (eb) => eb.ref("excluded.isFolder"),
            sizeBytes: (eb) => eb.ref("excluded.sizeBytes"),
            childCount: (eb) => eb.ref("excluded.childCount"),
            quickXorHash: (eb) => eb.ref("excluded.quickXorHash"),
            createdAtRemote: (eb) => eb.ref("excluded.createdAtRemote"),
            modifiedAtRemote: (eb) => eb.ref("excluded.modifiedAtRemote"),
            modifiedByName: (eb) => eb.ref("excluded.modifiedByName"),
            deletedAt: null,
            lastSeenAt: (eb) => eb.ref("excluded.lastSeenAt"),
          }),
        )
        .execute();

      written += chunk.length;
    }

    return written;
  } catch (error) {
    throw handleError("upsertSharepointItemsRepo", error);
  }
}

// -------------------------------------------------------------------
// Apply a page of tombstones.
//
// AN UPDATE, NEVER AN UPSERT, and the reason is worth stating because it
// looks like an omission. A tombstone carries an id and almost nothing
// else - no name, no size, no parent path. If Graph reports the deletion
// of an item we never recorded, which happens when something is created
// and removed between two crawls, there is nothing to insert: we would be
// writing a row whose only honest content is "an item we never saw is
// gone". That is not a fact anybody downstream can use, and `name` is NOT
// NULL precisely so the attempt fails loudly rather than inventing one.
//
// So a tombstone for an unknown item updates nothing, which is right. We
// never counted it, so there is no count to correct.
// -------------------------------------------------------------------
export async function markSharepointItemsDeletedRepo(
  driveId: string,
  itemIds: string[],
  deletedAt: Date,
  db: DBClient = database,
): Promise<number> {
  if (itemIds.length === 0) return 0;

  try {
    let marked = 0;

    for (let start = 0; start < itemIds.length; start += UPSERT_CHUNK_SIZE) {
      const chunk = itemIds.slice(start, start + UPSERT_CHUNK_SIZE);

      const result = await db
        .updateTable("sharepointItem")
        .set({ deletedAt, lastSeenAt: deletedAt })
        .where("driveId", "=", driveId)
        .where("itemId", "in", chunk)
        // Re-marking something already gone would move its deletion time
        // forward on every crawl, and "deleted last Tuesday" is the useful
        // half of the fact.
        .where("deletedAt", "is", null)
        .executeTakeFirst();

      marked += Number(result.numUpdatedRows ?? 0);
    }

    return marked;
  } catch (error) {
    throw handleError("markSharepointItemsDeletedRepo", error);
  }
}

// -------------------------------------------------------------------
// What the admin screen shows about a crawled library: how much is in it,
// and how much of that is gone.
//
// The counts are separate rather than one row of aggregates because live
// and deleted use different indexes, and because the deleted count is the
// one an admin reads to tell "the crawl found nothing" apart from "the
// library really is empty".
//
// filter_agg over a bigint sum comes back as a string from node-postgres,
// so the sum is coalesced in SQL and converted once here rather than being
// silently coerced by TypeScript.
// -------------------------------------------------------------------
export interface SharepointDriveTotals {
  liveItems: number;
  liveFolders: number;
  deletedItems: number;
  totalBytes: number;
}

export async function getSharepointDriveTotalsRepo(
  driveId: string,
  db: DBClient = database,
): Promise<SharepointDriveTotals> {
  try {
    const row = await db
      .selectFrom("sharepointItem")
      .where("driveId", "=", driveId)
      .select((eb) => [
        eb.fn.countAll<string>().filterWhere("deletedAt", "is", null).as("liveItems"),
        eb.fn
          .countAll<string>()
          .filterWhere((fb) => fb.and([fb("deletedAt", "is", null), fb("isFolder", "=", true)]))
          .as("liveFolders"),
        eb.fn.countAll<string>().filterWhere("deletedAt", "is not", null).as("deletedItems"),
        eb.fn
          .coalesce(
            eb.fn.sum<string>("sizeBytes").filterWhere("deletedAt", "is", null),
            eb.val<string>("0"),
          )
          .as("totalBytes"),
      ])
      .executeTakeFirst();

    return {
      liveItems: Number(row?.liveItems ?? 0),
      liveFolders: Number(row?.liveFolders ?? 0),
      deletedItems: Number(row?.deletedItems ?? 0),
      totalBytes: Number(row?.totalBytes ?? 0),
    };
  } catch (error) {
    throw handleError("getSharepointDriveTotalsRepo", error);
  }
}
