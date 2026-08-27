import "server-only";

import { generateId } from "better-auth";

import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import {
  SHAREPOINT_CRAWL_STATUS_LABELS,
  SHAREPOINT_CRAWL_STATUSES,
  USER_ROLES,
  type SharepointCrawl,
} from "@/lib/data/kysely-database-types";
import {
  addSharepointCrawlRepo,
  getUnfinishedCrawlForDriveRepo,
  listCrawlsForDriveRepo,
} from "@/lib/data/repositories/sharepoint-crawl.repository";
import {
  deleteSharepointDriveRepo,
  getSharepointDriveRepo,
  listSharepointDrivesRepo,
  upsertSharepointDriveRepo,
} from "@/lib/data/repositories/sharepoint-drive.repository";
import { getSharepointDriveTotalsRepo } from "@/lib/data/repositories/sharepoint-item.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { fetchDrivesForSite, fetchSite, GRAPH_OUTCOMES, GraphRequestError } from "@/lib/sharepoint/graph-client";
import { getDelegatedGraphToken } from "@/lib/sharepoint/graph-token";
import { parseSharepointSiteUrl, SharepointUrlError } from "@/lib/sharepoint/site-url";

import {
  type DriveIdDTO,
  type FindLibrariesDTO,
  type NominateLibraryDTO,
  type SharepointCrawlDTO,
  type SharepointDriveDTO,
  type SharepointSiteLookup,
} from "./sharepoint.types";

// -------------------------------------------------------------------
// SharePoint inventory - admin service.
//
// EVERY FUNCTION HERE GUARDS ON ADMIN, in the service and not only in the
// action, because a page can call a service directly and would otherwise
// be the unguarded path.
//
// The guard is not the interesting boundary though, and it is worth being
// clear about which one is. What a crawl can read is decided by SharePoint,
// against the delegated token of the person it runs as - not by anything in
// this file. A crawl cannot reach a library its owner could not already
// open. That is why nominating and starting both resolve the actor from the
// session and record who it was: the identity IS the permission.
// -------------------------------------------------------------------

// Only real document libraries. A site carries other things Graph calls a
// drive, and crawling one of those would fill the inventory with rows that
// answer nothing.
const DOCUMENT_LIBRARY_DRIVE_TYPE = "documentLibrary";

// How many past runs the screen shows per library. Enough to see a pattern,
// not enough to turn the page into a log viewer.
const CRAWL_HISTORY_LIMIT = 5;

// -------------------------------------------------------------------
// Turn a Graph failure into something an admin can act on.
//
// The three cases have three different remedies and collapsing them would
// send somebody looking for the wrong problem: a re-auth needs a person to
// sign in, a throttle needs waiting, and anything else needs a developer.
// -------------------------------------------------------------------
function describeGraphFailure(context: string, error: unknown): never {
  if (error instanceof SharepointUrlError) {
    throw new DisplayErrorMessage(error.message);
  }

  if (error instanceof GraphRequestError) {
    if (error.outcome === GRAPH_OUTCOMES.NEEDS_REAUTH) {
      throw new DisplayErrorMessage(
        "Microsoft would not accept your sign-in for SharePoint. Sign out and in again, and if it keeps happening the SharePoint permissions need approving for this app.",
      );
    }

    if (error.outcome === GRAPH_OUTCOMES.THROTTLED) {
      throw new DisplayErrorMessage("SharePoint is rate-limiting this app right now. Try again in a few minutes.");
    }

    if (error.status === 404) {
      throw new DisplayErrorMessage(
        "That SharePoint site could not be found. Check the address, and that you can open it yourself.",
      );
    }
  }

  // Everything else, including a DisplayErrorMessage thrown further up and
  // the redirect requireUserRole raises. handleError calls unstable_rethrow,
  // so Next's control-flow throws escape rather than being logged as faults.
  throw handleError(context, error);
}

// -------------------------------------------------------------------
// Resolve a pasted address to a site and its document libraries.
//
// A READ. Nothing is written, so an admin can paste, look, and change
// their mind without leaving a row behind.
//
// The token is the SIGNED-IN ADMIN's, so what comes back is what they can
// see. A library they cannot open does not appear in the list, which means
// they cannot nominate one they have no access to - the check is
// SharePoint's, made before we ever get an answer.
// -------------------------------------------------------------------
export async function findSharepointLibrariesService(
  requestDTO: FindLibrariesDTO,
): Promise<SharepointSiteLookup> {
  try {
    const user = await requireUserRole([USER_ROLES.ADMIN]);

    const { hostname, sitePath } = parseSharepointSiteUrl(requestDTO.siteUrl);

    const accessToken = await getDelegatedGraphToken(user.id);

    const site = await fetchSite(hostname, sitePath, accessToken);
    const drives = await fetchDrivesForSite(site.siteId, accessToken);

    const nominated = new Set((await listSharepointDrivesRepo()).map((drive) => drive.driveId));

    return {
      siteName: site.displayName,
      siteWebUrl: site.webUrl,
      libraries: drives
        .filter((drive) => drive.driveType === DOCUMENT_LIBRARY_DRIVE_TYPE)
        .map((drive) => ({
          driveId: drive.driveId,
          name: drive.name,
          webUrl: drive.webUrl,
          alreadyNominated: nominated.has(drive.driveId),
        })),
    };
  } catch (error) {
    describeGraphFailure("findSharepointLibrariesService", error);
  }
}

// -------------------------------------------------------------------
// Nominate one of the libraries on a site.
//
// THE DRIVE ID IS ADMITTED, NOT TRUSTED. The site is resolved again and
// the id is stored only if it appears in the list Graph returns for it -
// and the site name, library name and web URL come from GRAPH, never from
// the form.
//
// This is the admitOption rule from the timesheet view box, and the danger
// it guards against is the same one: not injection, but a row that looks
// right. A form free to supply its own display name could put a familiar
// library name in front of an admin beside a drive id pointing somewhere
// else, and every screen afterwards would agree with it. An unoffered id
// is refused and SAID SO rather than quietly dropped, because a silent
// drop reads as "nominated" to whoever pressed the button.
// -------------------------------------------------------------------
export async function nominateSharepointLibraryService(requestDTO: NominateLibraryDTO): Promise<void> {
  try {
    const user = await requireUserRole([USER_ROLES.ADMIN]);

    const { hostname, sitePath } = parseSharepointSiteUrl(requestDTO.siteUrl);

    const accessToken = await getDelegatedGraphToken(user.id);

    const site = await fetchSite(hostname, sitePath, accessToken);
    const drives = await fetchDrivesForSite(site.siteId, accessToken);

    const chosen = drives.find(
      (drive) => drive.driveId === requestDTO.driveId && drive.driveType === DOCUMENT_LIBRARY_DRIVE_TYPE,
    );

    if (!chosen) {
      throw new DisplayErrorMessage(
        "That library is not one of the document libraries on this site, so it was not added.",
      );
    }

    await upsertSharepointDriveRepo({
      driveId: chosen.driveId,
      siteId: site.siteId,
      siteName: site.displayName,
      driveName: chosen.name,
      // Graph does not promise a webUrl on every drive. The site is the
      // next best link back to the real thing, and an empty string would
      // render as a broken link.
      webUrl: chosen.webUrl ?? site.webUrl ?? "",
      nominatedBy: user.id,
      // Snapshotted, because the FK is ON DELETE SET NULL and the answer to
      // "who put this here" has to outlive the account.
      nominatedByName: user.name,
    });

    await recordAuditEvent({
      action: AUDIT_ACTIONS.SHAREPOINT_LIBRARY_NOMINATED,
      entityType: AUDIT_ENTITY_TYPES.SHAREPOINT_DRIVE,
      entityId: chosen.driveId,
      summary: `${site.displayName} / ${chosen.name}`,
    });
  } catch (error) {
    describeGraphFailure("nominateSharepointLibraryService", error);
  }
}

// -------------------------------------------------------------------
// Queue a crawl.
//
// RUNS AS THE ADMIN WHO PRESSED THE BUTTON, resolved from the session and
// never from the request. It is the whole access story: the crawl sees what
// this person sees. Recording it means the inventory can always answer
// whose permissions produced it.
//
// One crawl per library at a time. A second walk of the same drive would
// double every write and spend the tenant throttle budget twice for the
// same answer.
// -------------------------------------------------------------------
export async function startSharepointCrawlService(requestDTO: DriveIdDTO): Promise<void> {
  try {
    const user = await requireUserRole([USER_ROLES.ADMIN]);

    const drive = await getSharepointDriveRepo(requestDTO.driveId);

    if (!drive) {
      throw new DisplayErrorMessage("That library is not one of the ones being tracked.");
    }

    const inFlight = await getUnfinishedCrawlForDriveRepo(drive.driveId);

    if (inFlight) {
      throw new DisplayErrorMessage("This library is already being crawled. Wait for that run to finish.");
    }

    await addSharepointCrawlRepo({
      id: generateId(),
      driveId: drive.driveId,
      status: SHAREPOINT_CRAWL_STATUSES.QUEUED,
      runAsUserId: user.id,
      // No cursor. Whether this walk is full or incremental is decided by
      // the drive's delta link when the crawl actually runs, not now - the
      // library may finish another crawl in between.
      nextLink: null,
    });

    await recordAuditEvent({
      action: AUDIT_ACTIONS.SHAREPOINT_CRAWL_STARTED,
      entityType: AUDIT_ENTITY_TYPES.SHAREPOINT_DRIVE,
      entityId: drive.driveId,
      summary: `${drive.siteName} / ${drive.driveName}`,
      // Named explicitly even though the actor is the same person today,
      // because whose token a crawl runs on is the fact this row exists to
      // preserve, and an actor is not the same field as a subject.
      subjectUserId: user.id,
    });
  } catch (error) {
    throw handleError("startSharepointCrawlService", error);
  }
}

// -------------------------------------------------------------------
// Stop tracking a library, and drop what we hold about it.
//
// The cascade takes every crawl and every item with it, which is the
// retention control an admin actually has: de-nominating is what removes
// the inventory, because file paths are disclosive on their own.
// -------------------------------------------------------------------
export async function removeSharepointLibraryService(requestDTO: DriveIdDTO): Promise<void> {
  try {
    const user = await requireUserRole([USER_ROLES.ADMIN]);

    const drive = await getSharepointDriveRepo(requestDTO.driveId);

    if (!drive) {
      // Already gone. Not an error - the caller asked for a state that now
      // holds.
      return;
    }

    await deleteSharepointDriveRepo(drive.driveId);

    await recordAuditEvent({
      action: AUDIT_ACTIONS.SHAREPOINT_LIBRARY_REMOVED,
      entityType: AUDIT_ENTITY_TYPES.SHAREPOINT_DRIVE,
      entityId: drive.driveId,
      summary: `${drive.siteName} / ${drive.driveName}`,
      actor: { id: user.id, role: user.role, name: user.name },
    });
  } catch (error) {
    throw handleError("removeSharepointLibraryService", error);
  }
}

// -------------------------------------------------------------------
// Everything the admin screen renders.
// -------------------------------------------------------------------
export async function listSharepointDrivesService(): Promise<SharepointDriveDTO[]> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const drives = await listSharepointDrivesRepo();

    return await Promise.all(
      drives.map(async (drive) => {
        const [totals, crawls] = await Promise.all([
          getSharepointDriveTotalsRepo(drive.driveId),
          listCrawlsForDriveRepo(drive.driveId, CRAWL_HISTORY_LIMIT),
        ]);

        const completed = crawls.find((crawl) => crawl.status === SHAREPOINT_CRAWL_STATUSES.COMPLETED);

        return {
          driveId: drive.driveId,
          siteName: drive.siteName,
          driveName: drive.driveName,
          webUrl: drive.webUrl,
          nominatedByName: drive.nominatedByName,
          // The drive column, not the crawl row: it is written in the same
          // breath as the delta link, so it is the timestamp that actually
          // means "we have seen the whole library up to here".
          lastCompletedAt: (drive.deltaLinkUpdatedAt ?? completed?.finishedAt ?? null)?.toISOString() ?? null,
          liveItems: totals.liveItems,
          liveFolders: totals.liveFolders,
          deletedItems: totals.deletedItems,
          totalBytes: totals.totalBytes,
          latestCrawl: crawls[0] ? toCrawlDTO(crawls[0]) : null,
        } satisfies SharepointDriveDTO;
      }),
    );
  } catch (error) {
    throw handleError("listSharepointDrivesService", error);
  }
}

// -------------------------------------------------------------------
// A crawl row as the screen reads it.
//
// `isFailure` is computed here rather than left to the component, because
// two of the six statuses are not failures and a component deciding by
// itself would eventually decide differently: a throttled crawl resumes on
// its own, and one needing re-auth is waiting on a person rather than a
// fix. Showing either in red would have somebody debugging a system that
// is working.
// -------------------------------------------------------------------
function toCrawlDTO(crawl: SharepointCrawl): SharepointCrawlDTO {
  return {
    id: crawl.id,
    status: crawl.status,
    statusLabel: SHAREPOINT_CRAWL_STATUS_LABELS[crawl.status],
    isFailure: crawl.status === SHAREPOINT_CRAWL_STATUSES.FAILED,
    isFinished:
      crawl.status === SHAREPOINT_CRAWL_STATUSES.COMPLETED ||
      crawl.status === SHAREPOINT_CRAWL_STATUSES.FAILED ||
      crawl.status === SHAREPOINT_CRAWL_STATUSES.NEEDS_REAUTH,
    itemsSeen: crawl.itemsSeen,
    pagesDone: crawl.pagesDone,
    error: crawl.error,
    throttledUntil: crawl.throttledUntil?.toISOString() ?? null,
    startedAt: crawl.startedAt?.toISOString() ?? null,
    finishedAt: crawl.finishedAt?.toISOString() ?? null,
    createdAt: crawl.createdAt.toISOString(),
  };
}
