import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import type { NewSharepointDrive, SharepointDrive } from "../kysely-database-types";

// -------------------------------------------------------------------
// Nominated document libraries.
//
// There is no per-user scoping in this file and that is correct: a drive
// is nominated by an admin and the whole feature is admin-only. The
// boundary that matters for SharePoint is not here at all - it is the
// delegated token a crawl runs on, which is why sharepoint_crawl carries
// run_as_user_id and this table does not gate anything.
//
// `nominatedByName` is snapshotted for the same reason audit_logs
// snapshots its actor: the FK is ON DELETE SET NULL, so the id can go and
// the answer to "who put this here" has to survive it.
// -------------------------------------------------------------------

export async function listSharepointDrivesRepo(db: DBClient = database): Promise<SharepointDrive[]> {
  try {
    return await db.selectFrom("sharepointDrive").selectAll().orderBy("siteName").orderBy("driveName").execute();
  } catch (error) {
    throw handleError("listSharepointDrivesRepo", error);
  }
}

export async function getSharepointDriveRepo(
  driveId: string,
  db: DBClient = database,
): Promise<SharepointDrive | undefined> {
  try {
    return await db
      .selectFrom("sharepointDrive")
      .selectAll()
      .where("driveId", "=", driveId)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getSharepointDriveRepo", error);
  }
}

// -------------------------------------------------------------------
// Nominate a library, or refresh what we know about one already nominated.
//
// Re-nominating deliberately does NOT clear the delta link. A library
// nominated twice is the same library, and throwing away the cursor would
// turn a cheap incremental crawl into a full one for no reason. Starting
// over is a separate, explicit action - see clearSharepointDriveDeltaLinkRepo.
// -------------------------------------------------------------------
export async function upsertSharepointDriveRepo(
  drive: NewSharepointDrive,
  db: DBClient = database,
): Promise<SharepointDrive> {
  try {
    return await db
      .insertInto("sharepointDrive")
      .values(drive)
      .onConflict((oc) =>
        oc.column("driveId").doUpdateSet({
          siteId: (eb) => eb.ref("excluded.siteId"),
          siteName: (eb) => eb.ref("excluded.siteName"),
          driveName: (eb) => eb.ref("excluded.driveName"),
          webUrl: (eb) => eb.ref("excluded.webUrl"),
          nominatedBy: (eb) => eb.ref("excluded.nominatedBy"),
          nominatedByName: (eb) => eb.ref("excluded.nominatedByName"),
          // No trigger on updated_at anywhere in this schema, so every
          // update sets it itself.
          updatedAt: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("upsertSharepointDriveRepo", error);
  }
}

// -------------------------------------------------------------------
// Store the cursor that makes the next crawl incremental.
//
// ONLY called when a walk reached the end. Writing this mid-walk would
// claim we had seen the whole library, and the next crawl would start from
// a point we never actually reached - silently skipping everything in
// between. That is the single sharpest edge in the crawl state machine.
// -------------------------------------------------------------------
export async function setSharepointDriveDeltaLinkRepo(
  driveId: string,
  deltaLink: string,
  db: DBClient = database,
): Promise<void> {
  try {
    const now = new Date();

    await db
      .updateTable("sharepointDrive")
      .set({ deltaLink, deltaLinkUpdatedAt: now, updatedAt: now })
      .where("driveId", "=", driveId)
      .execute();
  } catch (error) {
    throw handleError("setSharepointDriveDeltaLinkRepo", error);
  }
}

// -------------------------------------------------------------------
// Forget the cursor, so the next crawl walks the library in full.
//
// The recovery path for a delta link Graph has rejected. Graph expires
// tokens and can invalidate one after a change on its side, and the answer
// it gives is a 410 telling us to resync from scratch.
// -------------------------------------------------------------------
export async function clearSharepointDriveDeltaLinkRepo(
  driveId: string,
  db: DBClient = database,
): Promise<void> {
  try {
    await db
      .updateTable("sharepointDrive")
      .set({ deltaLink: null, deltaLinkUpdatedAt: null, updatedAt: new Date() })
      .where("driveId", "=", driveId)
      .execute();
  } catch (error) {
    throw handleError("clearSharepointDriveDeltaLinkRepo", error);
  }
}

// -------------------------------------------------------------------
// De-nominate a library.
//
// This is the delete that matters for retention: ON DELETE CASCADE takes
// every crawl and every item with it, so removing a library really does
// remove what we hold about it rather than leaving orphaned paths behind.
// Unlike chat attachments there is no blob to clear first - phase 1
// downloads no file content at all, so the cascade is the whole story.
// -------------------------------------------------------------------
export async function deleteSharepointDriveRepo(driveId: string, db: DBClient = database): Promise<void> {
  try {
    await db.deleteFrom("sharepointDrive").where("driveId", "=", driveId).execute();
  } catch (error) {
    throw handleError("deleteSharepointDriveRepo", error);
  }
}
