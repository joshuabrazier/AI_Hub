import "server-only";

import {
  SHAREPOINT_CRAWL_STATUSES,
  type SharepointCrawl,
  type SharepointCrawlStatus,
} from "@/lib/data/kysely-database-types";
import {
  claimSharepointCrawlRepo,
  deleteCrawlsOlderThanRepo,
  getSharepointCrawlRepo,
  listResumableCrawlsRepo,
  reclaimStaleCrawlsRepo,
  updateSharepointCrawlRepo,
} from "@/lib/data/repositories/sharepoint-crawl.repository";
import {
  clearSharepointDriveDeltaLinkRepo,
  getSharepointDriveRepo,
  setSharepointDriveDeltaLinkRepo,
} from "@/lib/data/repositories/sharepoint-drive.repository";
import {
  markSharepointItemsDeletedRepo,
  upsertSharepointItemsRepo,
} from "@/lib/data/repositories/sharepoint-item.repository";
import { envServer } from "@/lib/env-server";
import { handleError } from "@/lib/handle-errors";
import {
  applyThrottle,
  deltaStartUrl,
  fetchDeltaPage,
  GRAPH_OUTCOMES,
  GraphRequestError,
} from "@/lib/sharepoint/graph-client";
import { GraphContractError } from "@/lib/sharepoint/graph-types";
import { getDelegatedGraphToken } from "@/lib/sharepoint/graph-token";
import { partitionDeltaItems, toSharepointItemRow } from "@/lib/sharepoint/item-mapping";

// -------------------------------------------------------------------
// The crawl state machine
//
// Walks a document library through the Graph delta endpoint and writes what
// it finds. Nothing here is user-facing and nothing here resolves an actor
// from a session: a crawl runs on a token belonging to whoever an admin
// started it as, which is why the row carries runAsUserId and why this
// service is only reachable from the sweep behind its bearer secret, or
// from the admin service that created the row in the first place.
//
// IT WORKS IN SLICES, and that is the central design decision.
//
// A library of fifty thousand items is hundreds of delta pages. Doing all
// of them in one invocation means a job that runs for many minutes, cannot
// be interrupted without losing its place, and holds a database connection
// throughout. So one invocation walks a bounded number of pages, saves
// exactly where it got to, and puts the crawl back in the queue. The sweep
// calls again. Progress is durable at page granularity.
//
// THE ORDER OF WRITES IS THE WHOLE CORRECTNESS ARGUMENT:
//
//   1. write the items on this page
//   2. THEN advance the cursor
//
// Dying between them repeats a page, which is harmless - every write is an
// upsert keyed on (driveId, itemId). Doing it the other way round would
// skip a page, and a skipped page is items missing from an inventory that
// reports itself complete. Same reasoning as the Jira watermark, and the
// same asymmetry: repeating is cheap, skipping is silent.
//
// AND THE DELTA LINK IS WRITTEN ONLY AT THE END. A deltaLink means "you
// have seen everything up to here". Storing one mid-walk would make the
// next crawl start after a point we never actually reached.
// -------------------------------------------------------------------

// How many delta pages one invocation walks before yielding. Graph returns
// a few hundred items per page, so this is a few thousand items - enough
// that a normal library finishes in one or two slices, small enough that a
// slice stays well inside any sensible job timeout.
const MAX_PAGES_PER_SLICE = 25;

// How many crawls the sweep picks up per call. More than one so a second
// nominated library is not stuck behind a large first one; low enough that
// concurrent crawls do not race each other into the tenant throttle.
const MAX_CRAWLS_PER_SWEEP = 3;

// A crawl still saying `running` after this long is not being worked on -
// its process died. Comfortably longer than a slice can take (25 pages
// against a 30 second per-request timeout), because reclaiming a crawl
// that is merely slow would produce the double-walk that claiming exists
// to prevent.
const STALE_RUNNING_MINUTES = 30;

const MILLISECONDS_PER_MINUTE = 60000;

// -------------------------------------------------------------------
// What one slice did. Counts and a status, never item names - this is what
// a scheduler logs, and a log of file paths would be a second copy of the
// disclosive part of the inventory sitting somewhere nobody is guarding.
// -------------------------------------------------------------------
export interface CrawlSliceResult {
  crawlId: string;
  status: SharepointCrawlStatus | "not_claimed" | "not_found";
  pagesDone: number;
  itemsSeen: number;
  itemsDeleted: number;
}

// -------------------------------------------------------------------
// Advance one crawl by up to MAX_PAGES_PER_SLICE pages.
//
// Returns rather than throws for every outcome a caller has to act on
// differently, because "the token needs renewing" and "the code is broken"
// have completely different remedies and a generic failure hides which is
// which.
// -------------------------------------------------------------------
// -------------------------------------------------------------------
// How much work one slice may do.
//
// The sweep leaves both unset and gets the full 25-page slice. A BUTTON
// PRESS passes a small budget instead, because the two have completely
// different constraints: a scheduler is happy to wait 25 seconds, and a
// person watching a spinner is not.
//
// `budgetMs` bounds by WALL CLOCK rather than pages, which is what actually
// matters. A fast library gets through more pages inside the budget, a slow
// one bails out earlier, and neither ends up holding a request open long
// enough to meet App Service's 230 second front-end timeout.
// -------------------------------------------------------------------
export interface CrawlSliceOptions {
  maxPages?: number;
  budgetMs?: number;
}

export async function runCrawlSliceService(
  crawlId: string,
  options: CrawlSliceOptions = {},
): Promise<CrawlSliceResult> {
  const now = new Date();

  // The claim IS the lock. Failing it means another slice is already
  // walking this drive, and the only correct response is to leave.
  const claimed = await claimSharepointCrawlRepo(crawlId, now);

  if (!claimed) {
    const existing = await getSharepointCrawlRepo(crawlId);

    return {
      crawlId,
      status: existing ? "not_claimed" : "not_found",
      pagesDone: existing?.pagesDone ?? 0,
      itemsSeen: existing?.itemsSeen ?? 0,
      itemsDeleted: 0,
    };
  }

  try {
    return await walkClaimedCrawl(claimed, options);
  } catch (error) {
    // Anything that got past the classified failures below is a real
    // fault. The crawl is failed rather than left running, so it stops
    // rather than being reclaimed and retried into the same wall forever.
    const message = error instanceof Error ? error.message : String(error);

    await updateSharepointCrawlRepo(claimed.id, {
      status: SHAREPOINT_CRAWL_STATUSES.FAILED,
      error: message.slice(0, 1000),
      finishedAt: new Date(),
    });

    throw handleError("runCrawlSliceService", error);
  }
}

// -------------------------------------------------------------------
// The walk itself, on a crawl this process now owns.
// -------------------------------------------------------------------
async function walkClaimedCrawl(
  crawl: SharepointCrawl,
  options: CrawlSliceOptions = {},
): Promise<CrawlSliceResult> {
  const maxPages = options.maxPages ?? MAX_PAGES_PER_SLICE;
  const startedAtMs = Date.now();
  const drive = await getSharepointDriveRepo(crawl.driveId);

  if (!drive) {
    // The drive was de-nominated between queueing and running. Not a
    // failure of the crawl - the answer to "walk this library" is that
    // nobody wants it walked any more.
    await updateSharepointCrawlRepo(crawl.id, {
      status: SHAREPOINT_CRAWL_STATUSES.FAILED,
      error: "The library was removed before this crawl ran",
      finishedAt: new Date(),
    });

    return { crawlId: crawl.id, status: SHAREPOINT_CRAWL_STATUSES.FAILED, pagesDone: 0, itemsSeen: 0, itemsDeleted: 0 };
  }

  let accessToken: string;

  try {
    accessToken = await getDelegatedGraphToken(crawl.runAsUserId);
  } catch (error) {
    if (error instanceof GraphRequestError && error.outcome === GRAPH_OUTCOMES.NEEDS_REAUTH) {
      return await parkForReauth(crawl, error.message);
    }

    throw error;
  }

  // Where to start, in order of preference:
  //
  //   nextLink   an interrupted walk, resuming mid-library
  //   deltaLink  a finished previous crawl, so only what changed since
  //   neither    the first crawl of this library, so everything
  //
  // The order matters. A crawl holding a nextLink has NOT seen the whole
  // library, so preferring the drive deltaLink would resume from a point
  // it never reached.
  let url = crawl.nextLink ?? drive.deltaLink ?? deltaStartUrl(drive.driveId);
  const usingStoredDeltaLink = !crawl.nextLink && Boolean(drive.deltaLink);

  let pagesDone = crawl.pagesDone;
  let itemsSeen = crawl.itemsSeen;
  let itemsDeleted = 0;

  for (let page = 0; page < maxPages; page++) {
    // Out of time rather than out of pages. Checked BEFORE the fetch, so
    // the budget bounds when we stop ASKING - bounding it after the fact
    // would let one slow page overrun the whole allowance.
    if (options.budgetMs !== undefined && Date.now() - startedAtMs >= options.budgetMs) break;

    let deltaPage;

    try {
      deltaPage = await fetchDeltaPage(url, accessToken);
    } catch (error) {
      if (error instanceof GraphRequestError && error.outcome === GRAPH_OUTCOMES.THROTTLED) {
        return await parkForThrottle(crawl, error, { pagesDone, itemsSeen, itemsDeleted });
      }

      if (error instanceof GraphRequestError && error.outcome === GRAPH_OUTCOMES.NEEDS_REAUTH) {
        return await parkForReauth(crawl, error.message);
      }

      // -------------------------------------------------------------
      // 410 Gone - the stored delta link is no longer usable.
      //
      // CONFIRMED behaviour: Graph documents that a delta token can stop
      // being valid and that the service answers 410 with `resyncRequired`,
      // meaning start again from scratch.
      //   https://learn.microsoft.com/graph/api/driveitem-delta
      //
      // Recovery is to forget the cursor and requeue for a full walk. The
      // guard against doing that forever is that it only applies when we
      // were USING a stored delta link: a full walk cannot be told to
      // resync, so a 410 on one is a genuine failure and falls through.
      // -------------------------------------------------------------
      if (error instanceof GraphRequestError && error.status === 410 && usingStoredDeltaLink) {
        await clearSharepointDriveDeltaLinkRepo(drive.driveId);

        await updateSharepointCrawlRepo(crawl.id, {
          status: SHAREPOINT_CRAWL_STATUSES.QUEUED,
          nextLink: null,
          error: "Graph asked for a full resync, so the next run walks the whole library",
        });

        return { crawlId: crawl.id, status: SHAREPOINT_CRAWL_STATUSES.QUEUED, pagesDone, itemsSeen, itemsDeleted };
      }

      // A contract failure travels as itself. It means the response was
      // not what we understand, which is emphatically not the same as the
      // library being empty, and the crawl must stop rather than record a
      // clean result it never observed.
      //
      // BUT IT TRAVELS WITH WHERE IT HAPPENED. A real crawl died here after
      // 11,465 items and its recorded error was the bare string "URI
      // malformed" - true, and useless. Which page, and how far in, is the
      // difference between "look at page 51 of that library" and reading
      // the whole thing.
      const where =
        `page ${pagesDone + 1} of this crawl (${itemsSeen} items in so far)`;

      if (error instanceof GraphContractError) {
        throw new GraphContractError(`${error.message} - failed on ${where}`);
      }

      if (error instanceof Error) {
        error.message = `${error.message} - failed on ${where}`;
      }

      throw error;
    }

    const seenAt = new Date();
    const { live, deletedIds } = partitionDeltaItems(deltaPage.items);

    // WRITE FIRST. See the header: dying here repeats a page, which is
    // free, where advancing first would skip one, which is silent.
    if (live.length > 0) {
      await upsertSharepointItemsRepo(live.map((item) => toSharepointItemRow(drive.driveId, item, seenAt)));
    }

    if (deletedIds.length > 0) {
      itemsDeleted += await markSharepointItemsDeletedRepo(drive.driveId, deletedIds, seenAt);
    }

    pagesDone += 1;
    itemsSeen += deltaPage.items.length;

    if (deltaPage.deltaLink) {
      // The end. Only now is it true that we have seen the whole library,
      // so only now may the cursor for next time be stored.
      console.info(
        `[sharepoint-crawl] crawl=${crawl.id} COMPLETED - ${itemsSeen} items over ${pagesDone} pages, ` +
          `${itemsDeleted} tombstoned`,
      );

      await setSharepointDriveDeltaLinkRepo(drive.driveId, deltaPage.deltaLink);

      await updateSharepointCrawlRepo(crawl.id, {
        status: SHAREPOINT_CRAWL_STATUSES.COMPLETED,
        nextLink: null,
        pagesDone,
        itemsSeen,
        error: null,
        finishedAt: new Date(),
      });

      return { crawlId: crawl.id, status: SHAREPOINT_CRAWL_STATUSES.COMPLETED, pagesDone, itemsSeen, itemsDeleted };
    }

    if (!deltaPage.nextLink) {
      // Neither link. parseDeltaPage allows this and it is not a contract
      // failure, but it is also not an ending we can act on: without a
      // delta link we cannot claim the library was fully seen, and without
      // a next link there is nowhere to go. Failing is the honest answer.
      throw new GraphContractError("A delta page carried neither a nextLink nor a deltaLink");
    }

    url = deltaPage.nextLink;

    await updateSharepointCrawlRepo(crawl.id, { nextLink: url, pagesDone, itemsSeen });
  }

  // Out of pages, not out of library. Back to the queue with the cursor
  // saved, so the next sweep picks up exactly here.
  //
  // Logged because "queued" on its own is ambiguous: it is also what a crawl
  // that has never started looks like. Saying it yielded mid-library is the
  // difference between "working, come back" and "nothing is running this".
  console.info(
    `[sharepoint-crawl] crawl=${crawl.id} yielded after ${pagesDone - crawl.pagesDone} pages ` +
      `(${itemsSeen} items so far) - requeued to continue`,
  );

  await updateSharepointCrawlRepo(crawl.id, {
    status: SHAREPOINT_CRAWL_STATUSES.QUEUED,
    nextLink: url,
    pagesDone,
    itemsSeen,
  });

  return { crawlId: crawl.id, status: SHAREPOINT_CRAWL_STATUSES.QUEUED, pagesDone, itemsSeen, itemsDeleted };
}

// -------------------------------------------------------------------
// Park a crawl behind a throttle.
//
// The DURABLE half of the throttle. The in-process gate in graph-client
// dies with the process; this column is what stops a restarted crawl
// walking straight back into the block and turning a short throttle into
// a long one.
//
// The in-process gate is set here too, so other crawls in this same
// invocation stop as well - SharePoint throttles per application per
// tenant, so a 429 on one library is a statement about all of them.
// -------------------------------------------------------------------
async function parkForThrottle(
  crawl: SharepointCrawl,
  error: GraphRequestError,
  progress: { pagesDone: number; itemsSeen: number; itemsDeleted: number },
): Promise<CrawlSliceResult> {
  const seconds = error.retryAfterSeconds ?? 60;

  console.info(
    `[sharepoint-crawl] crawl=${crawl.id} PARKED - SharePoint asked for ${seconds}s ` +
      `(${progress.itemsSeen} items over ${progress.pagesDone} pages so far)`,
  );

  applyThrottle(seconds);

  await updateSharepointCrawlRepo(crawl.id, {
    status: SHAREPOINT_CRAWL_STATUSES.PAUSED_THROTTLED,
    throttledUntil: new Date(Date.now() + seconds * 1000),
    pagesDone: progress.pagesDone,
    itemsSeen: progress.itemsSeen,
    // Not an error, and it must not read as one on the admin screen. The
    // crawl resumes by itself.
    error: null,
  });

  return {
    crawlId: crawl.id,
    status: SHAREPOINT_CRAWL_STATUSES.PAUSED_THROTTLED,
    pagesDone: progress.pagesDone,
    itemsSeen: progress.itemsSeen,
    itemsDeleted: progress.itemsDeleted,
  };
}

// -------------------------------------------------------------------
// Park a crawl that has no usable token.
//
// TERMINAL, and deliberately not retried. Nothing this code can do renews
// a consent - a named person has to sign in again. Leaving it queued would
// mean the sweep retrying it every minute forever, which is how a fixable
// problem becomes invisible noise.
//
// No progress is written here beyond the status, because none was made:
// the failure was before the first page.
// -------------------------------------------------------------------
async function parkForReauth(crawl: SharepointCrawl, message: string): Promise<CrawlSliceResult> {
  // Terminal and needs a person, so it is the one park worth a louder level:
  // nothing will retry it and nobody is watching the row.
  console.warn(`[sharepoint-crawl] crawl=${crawl.id} NEEDS RE-AUTH - ${message}`);

  await updateSharepointCrawlRepo(crawl.id, {
    status: SHAREPOINT_CRAWL_STATUSES.NEEDS_REAUTH,
    error: message.slice(0, 1000),
    finishedAt: new Date(),
  });

  return {
    crawlId: crawl.id,
    status: SHAREPOINT_CRAWL_STATUSES.NEEDS_REAUTH,
    pagesDone: crawl.pagesDone,
    itemsSeen: crawl.itemsSeen,
    itemsDeleted: 0,
  };
}

// -------------------------------------------------------------------
// Carry every unfinished crawl forward. Called by the job, and by nothing
// else - it acts on rows it did not resolve from a session, which is
// exactly why the door in front of it is a bearer secret.
// -------------------------------------------------------------------
export interface CrawlSweepResult {
  reclaimed: number;
  examined: number;
  slices: CrawlSliceResult[];
}

export async function sweepSharepointCrawlsService(): Promise<CrawlSweepResult> {
  try {
    const now = new Date();

    // First, put back anything abandoned by a process that died. Without
    // this a crash strands a crawl in `running` and nothing ever picks it
    // up again, because claiming refuses that status by design.
    const reclaimed = await reclaimStaleCrawlsRepo(
      new Date(now.getTime() - STALE_RUNNING_MINUTES * MILLISECONDS_PER_MINUTE),
    );

    const due = await listResumableCrawlsRepo(now, MAX_CRAWLS_PER_SWEEP);

    const slices: CrawlSliceResult[] = [];

    // -----------------------------------------------------------------
    // LOG EVERY INVOCATION, including the ones that find nothing.
    //
    // "Is anything calling this at all" is the first question when a crawl
    // sits at Queued, and a job that only logs when it does work cannot
    // answer it - silence means both "not scheduled" and "nothing due".
    //
    // Counts and ids only. No site names, no library names, no file paths:
    // a scheduler's log must not become a second, unguarded copy of the
    // disclosive half of the inventory.
    // -----------------------------------------------------------------
    console.info(
      `[sharepoint-sweep] start reclaimed=${reclaimed} due=${due.length}` +
        (due.length > 0 ? ` crawls=${due.map((crawl) => crawl.id).join(",")}` : ""),
    );

    // SEQUENTIAL, not concurrent. The throttle budget is per application
    // per tenant, so running libraries in parallel does not go faster - it
    // just reaches the limit sooner, and every crawl pays for it.
    for (const crawl of due) {
      const startedAt = Date.now();
      const slice = await runCrawlSliceService(crawl.id);
      slices.push(slice);

      console.info(
        `[sharepoint-sweep] crawl=${slice.crawlId} status=${slice.status} ` +
          `pages=${slice.pagesDone} items=${slice.itemsSeen} deleted=${slice.itemsDeleted} ` +
          `tookMs=${Date.now() - startedAt}`,
      );
    }

    return { reclaimed, examined: due.length, slices };
  } catch (error) {
    throw handleError("sweepSharepointCrawlsService", error);
  }
}

// -------------------------------------------------------------------
// Retention, called by the monthly job.
//
// PURGES RECORDS OF RUNS, NOT THE INVENTORY, and the difference is the
// whole policy. An old crawl row answers nothing - it is a log entry
// saying a walk happened. The items are different: a file path is only
// disclosive while it describes something that exists, and ageing live
// rows out would force a full re-crawl to rebuild identical data. More
// Graph traffic, the same exposure, nothing gained.
//
// What removes an inventory is de-nominating its library, which cascades.
// That is the control an admin actually has, and it is on the screen.
//
// Zero days means keep indefinitely, matching every other window here.
// -------------------------------------------------------------------
export interface SharepointRetentionResult {
  retentionDays: number;
  purgedCrawls: number;
}

export async function purgeExpiredSharepointCrawlsService(): Promise<SharepointRetentionResult> {
  try {
    const retentionDays = envServer.SHAREPOINT_INVENTORY_RETENTION_DAYS;

    if (retentionDays <= 0) {
      return { retentionDays, purgedCrawls: 0 };
    }

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * MILLISECONDS_PER_MINUTE);

    return { retentionDays, purgedCrawls: await deleteCrawlsOlderThanRepo(cutoff) };
  } catch (error) {
    throw handleError("purgeExpiredSharepointCrawlsService", error);
  }
}
