import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { SiteContent, SiteContentKey } from "../kysely-database-types";

// -------------------------------------------------------------------
// Get all site content rows.
// -------------------------------------------------------------------
export async function getAllSiteContentRepo(db: DBClient = database): Promise<SiteContent[]> {
  try {
    return await db.selectFrom("siteContent").selectAll().orderBy("contentName").execute();
  } catch (error) {
    throw handleError("getAllSiteContentRepo", error);
  }
}

// -------------------------------------------------------------------
// Get a single content row by its key. Returns undefined if not found.
//
// `db` is injectable so a caller inside a transaction reads the same text its
// own writes will record, rather than a value that changed underneath it.
// -------------------------------------------------------------------
export async function getSiteContentByKeyRepo(
  contentName: SiteContentKey,
  db: DBClient = database,
): Promise<SiteContent | undefined> {
  try {
    return await db
      .selectFrom("siteContent")
      .selectAll()
      .where("contentName", "=", contentName)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getSiteContentByKeyRepo", error);
  }
}

// -------------------------------------------------------------------
// Get several content rows at once. The home page is assembled from the
// landing_* blocks, so it would otherwise pay for a query per block or read
// every row (including the long legal pages) to use four of them.
// Keys with no saved row are simply absent - the caller falls back to its
// built-in default.
// -------------------------------------------------------------------
export async function getSiteContentByKeysRepo(
  contentNames: SiteContentKey[],
  db: DBClient = database,
): Promise<SiteContent[]> {
  try {
    if (contentNames.length === 0) return [];
    return await db
      .selectFrom("siteContent")
      .selectAll()
      .where("contentName", "in", contentNames)
      .orderBy("contentName")
      .execute();
  } catch (error) {
    throw handleError("getSiteContentByKeysRepo", error);
  }
}

// -------------------------------------------------------------------
// Upsert a content row by key. Inserts the row when the key has never been
// saved (a key added after the site went live, e.g. a new landing block),
// otherwise updates the existing row. content_name is UNIQUE, so it drives
// the conflict target. Always returns the resulting row.
// -------------------------------------------------------------------
export async function updateSiteContentByKeyRepo(
  contentName: SiteContentKey,
  contentValue: string,
  db: DBClient = database,
): Promise<SiteContent | undefined> {
  try {
    const now = new Date();
    return await db
      .insertInto("siteContent")
      .values({ contentName, contentValue, createdAt: now, updatedAt: now })
      .onConflict((oc) => oc.column("contentName").doUpdateSet({ contentValue, updatedAt: now }))
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateSiteContentByKeyRepo", error);
  }
}
