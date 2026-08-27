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
  const isRunning = Boolean(crawl && !crawl.isFinished);

  function onCrawl() {
    startCrawl(async () => {
      try {
        const response = await startSharepointCrawlAction({ driveId: drive.driveId });

        if (!response.success) {
          toast.error(response.formError ?? "That crawl could not be started.");
          return;
        }

        // Queued, not done. Saying "crawl finished" here would be a lie
        // for anything but a tiny library - the walk happens in the sweep.
        toast.success("Queued. The crawl runs in the background.");
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

          <Button type="button" size="sm" onClick={onCrawl} disabled={isStarting || isRunning}>
            {isStarting ? (
              <Loader2 size={15} aria-hidden="true" className="animate-spin" />
            ) : (
              <Play size={15} aria-hidden="true" />
            )}
            {isRunning ? "Crawling" : "Crawl now"}
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

          {crawl.status === SHAREPOINT_CRAWL_STATUSES.PAUSED_THROTTLED && crawl.throttledUntil ? (
            <span className="text-muted-foreground">resumes after {formatDateTime(crawl.throttledUntil)}</span>
          ) : null}

          {crawl.error ? <span className="w-full text-muted-foreground">{crawl.error}</span> : null}
        </div>
      ) : (
        <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">
          No crawl has been run on this library yet.
        </p>
      )}

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
