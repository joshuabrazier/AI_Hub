import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import {
  SHAREPOINT_CRAWL_STATUSES,
  SHAREPOINT_CRAWL_UNFINISHED_STATUSES,
  type NewSharepointCrawl,
  type SharepointCrawl,
  type UpdateSharepointCrawl,
} from "../kysely-database-types";

// -------------------------------------------------------------------
// Crawl runs.
//
// A crawl is a long-running job rather than a request: the row exists
// before the work is done, survives the process that started it, and is
// picked back up by a sweep. Same shape as transcriptions, and for the
// same reason.
//
// The one thing this file does that the others do not is CLAIM. A sweep
// and an admin pressing the button can reach the same crawl at the same
// moment, and two walks of one drive would double every write and burn the
// tenant throttle budget twice over. So the transition into `running` is a
// conditional UPDATE that returns nothing when somebody else got there
// first - see claimSharepointCrawlRepo.
// -------------------------------------------------------------------

export async function addSharepointCrawlRepo(
  crawl: NewSharepointCrawl,
  db: DBClient = database,
): Promise<SharepointCrawl> {
  try {
    return await db.insertInto("sharepointCrawl").values(crawl).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addSharepointCrawlRepo", error);
  }
}

export async function getSharepointCrawlRepo(
  id: string,
  db: DBClient = database,
): Promise<SharepointCrawl | undefined> {
  try {
    return await db.selectFrom("sharepointCrawl").selectAll().where("id", "=", id).executeTakeFirst();
  } catch (error) {
    throw handleError("getSharepointCrawlRepo", error);
  }
}

// -------------------------------------------------------------------
// The unfinished crawl on this drive, if there is one.
//
// What stops a second crawl being queued on a library already being
// walked. Returns at most one row; the partial index on the unfinished
// statuses is what makes it cheap.
// -------------------------------------------------------------------
export async function getUnfinishedCrawlForDriveRepo(
  driveId: string,
  db: DBClient = database,
): Promise<SharepointCrawl | undefined> {
  try {
    return await db
      .selectFrom("sharepointCrawl")
      .selectAll()
      .where("driveId", "=", driveId)
      .where("status", "in", SHAREPOINT_CRAWL_UNFINISHED_STATUSES)
      .orderBy("createdAt", "desc")
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getUnfinishedCrawlForDriveRepo", error);
  }
}

// -------------------------------------------------------------------
// Work for the sweep: crawls that are not finished and are not parked
// behind a throttle that has not expired yet.
//
// `throttledUntil` in the future means Graph told us to wait, and picking
// the row up early would walk straight back into the block - which is how
// a throttle becomes a longer throttle. NULL means never throttled, so the
// filter has to admit it explicitly rather than relying on a comparison:
// a comparison against NULL is NULL, which would drop every row that has
// never been throttled at all.
// -------------------------------------------------------------------
export async function listResumableCrawlsRepo(
  now: Date,
  limit: number,
  db: DBClient = database,
): Promise<SharepointCrawl[]> {
  try {
    return await db
      .selectFrom("sharepointCrawl")
      .selectAll()
      .where("status", "in", SHAREPOINT_CRAWL_UNFINISHED_STATUSES)
      .where((eb) => eb.or([eb("throttledUntil", "is", null), eb("throttledUntil", "<=", now)]))
      .orderBy("createdAt")
      .limit(limit)
      .execute();
  } catch (error) {
    throw handleError("listResumableCrawlsRepo", error);
  }
}

// -------------------------------------------------------------------
// Take ownership of a crawl, or find out somebody else already has.
//
// The WHERE clause is the lock. Moving to `running` only from a status
// that is not already `running` means a second caller updates zero rows
// and gets undefined back, which is the signal to leave it alone.
//
// Postgres takes a row lock for the duration of the UPDATE, so two callers
// arriving together are serialised and the loser sees the state the winner
// left. A read-then-write in the service could not give that guarantee.
// -------------------------------------------------------------------
export async function claimSharepointCrawlRepo(
  id: string,
  now: Date,
  db: DBClient = database,
): Promise<SharepointCrawl | undefined> {
  try {
    return await db
      .updateTable("sharepointCrawl")
      .set({
        status: SHAREPOINT_CRAWL_STATUSES.RUNNING,
        // Only stamped on the first claim. A resumed crawl keeps the time
        // it originally began, because that is what "how long has this
        // library been crawling" means to somebody looking at the screen.
        startedAt: (eb) => eb.fn.coalesce("startedAt", eb.val(now)),
        throttledUntil: null,
        error: null,
        updatedAt: now,
      })
      .where("id", "=", id)
      .where("status", "in", [
        SHAREPOINT_CRAWL_STATUSES.QUEUED,
        SHAREPOINT_CRAWL_STATUSES.PAUSED_THROTTLED,
      ])
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("claimSharepointCrawlRepo", error);
  }
}

// -------------------------------------------------------------------
// Record progress, or how a run ended.
//
// `id` and `createdAt` are stripped before the patch is spread. Neither is
// ever legitimately patched, and an id in a patch would rewrite the primary
// key of the row the WHERE matched - moving this crawl's progress onto a
// different one. Same reasoning as updateUserRepo.
//
// updatedAt is set here because nothing in this schema has a trigger for
// it, and it is also what the stale reclaim reads.
// -------------------------------------------------------------------
export async function updateSharepointCrawlRepo(
  id: string,
  patch: UpdateSharepointCrawl,
  db: DBClient = database,
): Promise<SharepointCrawl | undefined> {
  try {
    const safePatch: UpdateSharepointCrawl = { ...patch };
    delete safePatch.id;
    delete safePatch.createdAt;

    return await db
      .updateTable("sharepointCrawl")
      .set({ ...safePatch, updatedAt: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateSharepointCrawlRepo", error);
  }
}

// -------------------------------------------------------------------
// Put crawls back that nothing is working on any more.
//
// `running` means a slice is in flight RIGHT NOW, and claim refuses that
// status absolutely - which is exactly what stops two walks of one drive.
// The cost of that strictness is that a process dying mid-slice leaves a
// row saying `running` forever, and nothing would ever pick it up again.
//
// This is the only way out, and it is time-based rather than clever: a
// row whose updatedAt has not moved for far longer than a slice can
// possibly take is not being worked on. The threshold has to be
// comfortably longer than a slice, because reclaiming a crawl that is
// merely slow would produce the double-walk claim exists to prevent.
// -------------------------------------------------------------------
export async function reclaimStaleCrawlsRepo(
  staleBefore: Date,
  db: DBClient = database,
): Promise<number> {
  try {
    const result = await db
      .updateTable("sharepointCrawl")
      .set({ status: SHAREPOINT_CRAWL_STATUSES.QUEUED, updatedAt: new Date() })
      .where("status", "=", SHAREPOINT_CRAWL_STATUSES.RUNNING)
      .where("updatedAt", "<", staleBefore)
      .executeTakeFirst();

    return Number(result.numUpdatedRows ?? 0);
  } catch (error) {
    throw handleError("reclaimStaleCrawlsRepo", error);
  }
}

// -------------------------------------------------------------------
// The recent history of one library, for the admin screen.
// -------------------------------------------------------------------
export async function listCrawlsForDriveRepo(
  driveId: string,
  limit: number,
  db: DBClient = database,
): Promise<SharepointCrawl[]> {
  try {
    return await db
      .selectFrom("sharepointCrawl")
      .selectAll()
      .where("driveId", "=", driveId)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .execute();
  } catch (error) {
    throw handleError("listCrawlsForDriveRepo", error);
  }
}

// -------------------------------------------------------------------
// Retention. Unscoped, and reachable only from the monthly job behind its
// bearer secret.
//
// Only FINISHED runs are swept. A crawl still queued or parked behind a
// long throttle could in principle be older than the window, and deleting
// it would drop work that had not been done - the row is the only record
// of where the walk got to.
// -------------------------------------------------------------------
export async function deleteCrawlsOlderThanRepo(cutoff: Date, db: DBClient = database): Promise<number> {
  try {
    const result = await db
      .deleteFrom("sharepointCrawl")
      .where("createdAt", "<", cutoff)
      .where("status", "in", [
        SHAREPOINT_CRAWL_STATUSES.COMPLETED,
        SHAREPOINT_CRAWL_STATUSES.FAILED,
        SHAREPOINT_CRAWL_STATUSES.NEEDS_REAUTH,
      ])
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  } catch (error) {
    throw handleError("deleteCrawlsOlderThanRepo", error);
  }
}
