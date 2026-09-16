"use client";

import { useState, useTransition } from "react";

import { Clock, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { MESSAGES } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { cn } from "@/lib/utils";

import { deleteSavedSummaryAction, getSavedSummaryAction } from "../summaries.actions";
import {
  SUMMARY_STYLE_LABELS,
  type SavedSummaryDetailDTO,
  type SavedSummaryDTO,
} from "../summaries.types";

// -------------------------------------------------------------------
// SavedSummaries
//
// The list of what this person has summarised before, and the way back into
// one of them.
//
// IT EXISTS BECAUSE STORAGE WITHOUT A WAY BACK IS NOT STORAGE. Keeping the
// pasted material and the answer, with no screen that can reach either,
// would be all of the privacy cost of this feature and none of the benefit
// - a table quietly accumulating contracts that nobody can open.
//
// THE LIST CARRIES TITLES AND NOTHING ELSE. The material and the answers are
// fetched one at a time, when one is opened, because the alternative is
// sending fifty documents to the browser so somebody can read one of them.
// See the repository's list query, which does not select those columns.
//
// TITLES ARE UNTRUSTED TEXT. They are the first line of whatever was pasted,
// so they render as text nodes and never as markup.
// -------------------------------------------------------------------
export function SavedSummaries({
  saved,
  disabled,
  onOpen,
}: {
  saved: SavedSummaryDTO[];
  /** True while a summary is streaming - opening another mid-stream would replace it. */
  disabled: boolean;
  onOpen: (summary: SavedSummaryDetailDTO) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SavedSummaryDTO | null>(null);

  // Removed from the list as soon as the server confirms, so the row does
  // not sit there until a revalidation lands. The server list replaces this
  // on the next render.
  const [removedIds, setRemovedIds] = useState<string[]>([]);

  const visible = saved.filter((row) => !removedIds.includes(row.id));

  if (visible.length === 0) {
    return (
      <p className="shrink-0 text-xs text-muted-foreground">
        Summaries you make are saved here, to your account only. Nobody else can see them.
      </p>
    );
  }

  const open = (row: SavedSummaryDTO) => {
    setOpeningId(row.id);

    startTransition(async () => {
      try {
        const response = await getSavedSummaryAction({ summaryId: row.id });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        onOpen(response.data);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      } finally {
        setOpeningId(null);
      }
    });
  };

  const remove = (row: SavedSummaryDTO) => {
    startTransition(async () => {
      try {
        const response = await deleteSavedSummaryAction({ summaryId: row.id });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        setRemovedIds((previous) => [...previous, row.id]);
        setPendingDelete(null);
        toast.success("Summary deleted.");
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  return (
    <div className="shrink-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">Saved</p>
        <p className="text-xs text-muted-foreground">Only you can see these.</p>
      </div>

      {/* A row of recent work rather than an archive. It scrolls sideways so
          that adding it costs the two panes below no height - the page is
          full-height and they are the part somebody came for. */}
      <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {visible.map((row) => (
          <li key={row.id} className="min-w-0 shrink-0">
            <div
              className={cn(
                "flex w-64 items-start gap-2 rounded-lg border border-border p-2.5 transition-colors",
                !disabled && "hover:bg-muted",
              )}
            >
              <button
                type="button"
                onClick={() => open(row)}
                disabled={disabled || isPending}
                className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileText size={12} aria-hidden="true" />
                  {SUMMARY_STYLE_LABELS[row.style]}
                  {row.error ? " - unfinished" : ""}
                </span>

                {/* Text node, never markup: this is the first line of
                    whatever was pasted in. */}
                <span className="mt-1 block truncate text-sm font-medium text-foreground">
                  {openingId === row.id ? "Opening..." : row.title}
                </span>

                <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock size={12} aria-hidden="true" />
                  {formatDateTime(row.createdAt)}
                </span>
              </button>

              {/* -----------------------------------------------------------
                  DELETING IS NOT A NICETY HERE. This table holds whatever
                  somebody pasted, so pasting the wrong document - a client's
                  contract into the wrong place, a letter they did not mean
                  to keep - has to be undoable by the person who did it,
                  without asking an administrator.
                  ----------------------------------------------------------- */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Delete ${row.title}`}
                onClick={() => setPendingDelete(row)}
                disabled={disabled || isPending}
              >
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => !next && setPendingDelete(null)}
        title="Delete this summary?"
        description="The text you pasted and the summary are both removed. This cannot be undone."
        confirmLabel="Delete"
        isPending={isPending}
        onConfirm={() => pendingDelete && remove(pendingDelete)}
      />
    </div>
  );
}
