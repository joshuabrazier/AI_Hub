"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Loader2, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SHAREPOINT_CRAWL_STATUSES } from "@/lib/data/kysely-database-types";
import { formatDateTime } from "@/lib/format";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { removeSharepointLibraryAction, startSharepointCrawlAction } from "../sharepoint.actions";
import type { SharepointDriveDTO } from "../sharepoint.types";

// -------------------------------------------------------------------
// One nominated library.
//
// Shows the two things phase 1 promised: what is in it, and whether the
// last crawl finished.
//
// THE STATUS COLOUR IS NOT DERIVED FROM "IS IT DONE". Four of the six
// statuses are ordinary and two of the remaining are not failures: a
// throttled crawl resumes by itself and one needing a sign-in is waiting
// on a person. Painting either red would have somebody debugging a system
// that is behaving correctly, so the variant follows isFailure, which the
// service decides.
// -------------------------------------------------------------------

// Bytes as something readable. Deliberately decimal units, matching what
// SharePoint and Windows both show, so a figure here can be compared with
// the one on screen in SharePoint without a conversion.
function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1);
  const value = bytes / 1000 ** exponent;

  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function LibraryCard({ drive }: { drive: SharepointDriveDTO }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isStarting, startCrawl] = useTransition();
  const [isRemoving, startRemove] = useTransition();

  const crawl = drive.latestCrawl;
  // "In flight" is not the same as "running". A QUEUED crawl is waiting for
  // the sweep to pick it up and nothing is happening yet, so calling it
  // "Crawling" told people work was under way when none was.
  const inFlight = Boolean(crawl && !crawl.isFinished);
  const isRunning = crawl?.status === SHAREPOINT_CRAWL_STATUSES.RUNNING;
  const isQueued = crawl?.status === SHAREPOINT_CRAWL_STATUSES.QUEUED;

  function onCrawl() {
    startCrawl(async () => {
      try {
        const response = await startSharepointCrawlAction({ driveId: drive.driveId });

        if (!response.success) {
          toast.error(response.formError ?? "That crawl could not be started.");
          return;
        }

        // Report what the inline slice ACTUALLY did. "Queued" was true and
        // read as "nothing happened", which is how this button spent a week
        // looking broken while working correctly.
        const { itemsSeen, finished } = response.data;

        if (finished) {
          toast.success(`Done. ${itemsSeen.toLocaleString()} files and folders catalogued.`);
        } else if (itemsSeen > 0) {
          toast.success(
            `Started. ${itemsSeen.toLocaleString()} items so far - the rest continues in the background.`,
          );
        } else {
          // No progress in the inline slice. Not necessarily wrong, but not
          // worth dressing up as success either.
          toast.info("Crawl queued. It will continue in the background.");
        }
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  }

  function onRemove() {
    startRemove(async () => {
      try {
        const response = await removeSharepointLibraryAction({ driveId: drive.driveId });

        if (!response.success) {
          toast.error(response.formError ?? "That library could not be removed.");
          return;
        }

        toast.success(`${drive.driveName} is no longer being catalogued.`);
        setConfirmOpen(false);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  }

  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-foreground">{drive.driveName}</h3>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{drive.siteName}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {drive.webUrl ? (
            <Button asChild size="sm" variant="ghost">
              <a href={drive.webUrl} target="_blank" rel="noreferrer noopener">
                <ExternalLink size={15} aria-hidden="true" />
                Open
              </a>
            </Button>
          ) : null}

          <Button type="button" size="sm" onClick={onCrawl} disabled={isStarting || inFlight}>
            {isStarting ? (
              <Loader2 size={15} aria-hidden="true" className="animate-spin" />
            ) : (
              <Play size={15} aria-hidden="true" />
            )}
            {isRunning ? "Crawling" : isQueued ? "Queued" : inFlight ? "Waiting" : "Crawl now"}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setConfirmOpen(true)}
            aria-label={`Stop cataloguing ${drive.driveName}`}
          >
            <Trash2 size={15} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* What we hold. A library never crawled says so rather than showing
          zeroes, because a zero reads as "we looked and it was empty". */}
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Files and folders</dt>
          <dd className="mt-0.5 text-sm font-medium text-foreground">
            {drive.lastCompletedAt ? drive.liveItems.toLocaleString() : "Not crawled yet"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Folders</dt>
          <dd className="mt-0.5 text-sm font-medium text-foreground">
            {drive.lastCompletedAt ? drive.liveFolders.toLocaleString() : "-"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Total size</dt>
          <dd className="mt-0.5 text-sm font-medium text-foreground">
            {drive.lastCompletedAt ? formatBytes(drive.totalBytes) : "-"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last finished</dt>
          <dd className="mt-0.5 text-sm font-medium text-foreground">
            {drive.lastCompletedAt ? formatDateTime(drive.lastCompletedAt) : "Never"}
          </dd>
        </div>
      </dl>

      {crawl ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3 text-sm">
          <Badge variant={crawl.isFailure ? "destructive" : crawl.isFinished ? "success" : "secondary"}>
            {crawl.statusLabel}
          </Badge>

          <span className="text-muted-foreground">
            {crawl.itemsSeen.toLocaleString()} items seen over {crawl.pagesDone.toLocaleString()} pages
          </span>

          {/* WHEN, not just what. A status with no time attached cannot tell
              "queued a moment ago" from "queued yesterday and nothing has
              come for it", and those need opposite responses. */}
          <span className="text-muted-foreground">
            queued {formatDateTime(crawl.createdAt)}
          </span>

          {/* Only worth showing once it differs from the queue time, which is
              exactly when something has actually touched the row. */}
          {crawl.updatedAt !== crawl.createdAt ? (
            <span className="text-muted-foreground">last activity {formatDateTime(crawl.updatedAt)}</span>
          ) : null}

          {crawl.status === SHAREPOINT_CRAWL_STATUSES.PAUSED_THROTTLED && crawl.throttledUntil ? (
            <span className="text-muted-foreground">resumes after {formatDateTime(crawl.throttledUntil)}</span>
          ) : null}

          {crawl.error ? <span className="w-full text-muted-foreground">{crawl.error}</span> : null}

          {/* A crawl only moves when something POSTs the sweep endpoint.
              Without that it sits here forever, and "Queued, 0 pages" looks
              identical to "about to start" - so say which it is. */}
          {crawl.looksStalled ? (
            <div className="w-full rounded-lg border border-data-caution/40 bg-data-caution-surface p-3 text-data-caution-text">
              <p className="font-semibold">Nothing has picked this crawl up.</p>
              <p className="mt-0.5">
                A crawl only advances when something calls
                <span className="font-mono"> /api/jobs/sharepoint-crawl-sweep </span>
                on a timer. Queueing one here does not run it. Check that a scheduler is pointed at that
                endpoint with the right bearer secret.
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">
          No crawl has been run on this library yet.
        </p>
      )}

      {/* Recent runs.
          Already fetched to work out the latest one and previously thrown
          away, which left no way to answer the first question anybody asks
          of a stuck crawl: has this ever worked? An empty history and a
          history of failures look nothing alike, and both look like
          "Queued" on its own. */}
      {drive.recentCrawls.length > 1 ? (
        <details className="mt-4 border-t border-border pt-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            Recent runs ({drive.recentCrawls.length})
          </summary>

          <ul className="mt-2 flex flex-col gap-1.5">
            {drive.recentCrawls.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                <Badge
                  variant={run.isFailure ? "destructive" : run.isFinished ? "success" : "secondary"}
                  className="text-[11px]"
                >
                  {run.statusLabel}
                </Badge>
                <span>{formatDateTime(run.createdAt)}</span>
                <span>
                  {run.itemsSeen.toLocaleString()} items, {run.pagesDone.toLocaleString()} pages
                </span>
                {run.finishedAt ? <span>finished {formatDateTime(run.finishedAt)}</span> : null}
                {run.error ? <span className="w-full text-destructive">{run.error}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {drive.nominatedByName ? (
        <p className="mt-3 text-xs text-muted-foreground">Added by {drive.nominatedByName}</p>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Stop cataloguing ${drive.driveName}?`}
        description="This removes everything recorded about the library, including every file and folder name. Nothing in SharePoint itself is touched. You can add it again later, but it will have to be crawled from scratch."
        confirmLabel="Remove"
        pendingLabel="Removing"
        isPending={isRemoving}
        onConfirm={onRemove}
      />
    </article>
  );
}
