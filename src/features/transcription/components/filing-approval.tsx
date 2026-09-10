"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Check, FolderOpen, Loader2, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { AppDialog } from "@/components/app-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MESSAGES } from "@/lib/constants";
import {
  TRANSCRIPTION_FILING_STATUSES,
  TRANSCRIPTION_FILING_STATUS_LABELS,
} from "@/lib/data/kysely-database-types";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import {
  confirmTranscriptionFilingAction,
  getFilingFolderChoicesAction,
} from "../transcription.actions";
import { filingDecisionLabel, type FilingFolderChoiceDTO, type TranscriptionFilingDTO } from "../transcription.types";

// ===================================================================
// "IS THIS THE RIGHT FOLDER?"
//
// The step between deciding and writing. Nothing reaches SharePoint until
// somebody answers this, which is a deliberate trade: an unfiled note is
// untidy, and a note in another client's folder is a confidentiality problem
// that nobody discovers because nobody is looking there.
//
// SO THE FOLDER IS THE HEADLINE, not the fact that a decision was made. The
// question being asked is "is that right", and the thing to check is a path -
// so it is the largest thing on the panel, and the reasoning sits underneath
// where somebody who doubts the answer will read it.
//
// HOW IT WAS DECIDED IS SHOWN BESIDE IT, because the three mechanisms
// deserve different amounts of scepticism. "The folder name matches the
// client" is worth a glance; "chosen by the assistant from the folders in the
// library" is worth a look at the path. Hiding that distinction would make
// every proposal look equally sound and quietly train people to click yes.
//
// AND CHANGING IT IS AS PROMINENT AS ACCEPTING IT. A confirm button with the
// override tucked away is a design that gets the wrong answer accepted,
// because the cost of hunting for the alternative exceeds the cost of
// shrugging. Both are buttons, side by side.
// ===================================================================
export function FilingApproval({
  transcriptionId,
  filing,
}: {
  transcriptionId: string;
  filing: TranscriptionFilingDTO;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [isPicking, setIsPicking] = useState(false);
  const [choices, setChoices] = useState<FilingFolderChoiceDTO[] | null>(null);
  const [isLoadingChoices, setIsLoadingChoices] = useState(false);
  const [search, setSearch] = useState("");

  const hasSuggestion = filing.folderPath !== null;
  const decision = filingDecisionLabel(filing.decidedVia);
  const hasFailed = filing.status === TRANSCRIPTION_FILING_STATUSES.FAILED;

  const confirm = (folderItemId?: string) =>
    startTransition(async () => {
      try {
        const response = await confirmTranscriptionFilingAction({ transcriptionId, folderItemId });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        // Not always success, and saying which is the point. A failed upload
        // is a real outcome and a green tick would misreport it; the panel
        // re-renders with the reason.
        if (response.data === TRANSCRIPTION_FILING_STATUSES.FILED) {
          toast.success("Filed in SharePoint.");
        } else {
          toast.warning(TRANSCRIPTION_FILING_STATUS_LABELS[response.data]);
        }

        setIsPicking(false);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  // Fetched when the picker opens rather than with the page. A crawled
  // library runs to hundreds of folders and almost nobody opens this on any
  // given visit, so shipping the list every time would be paying for a
  // decision that is usually already made.
  const openPicker = async () => {
    setIsPicking(true);

    if (choices !== null) return;

    setIsLoadingChoices(true);

    try {
      const response = await getFilingFolderChoicesAction({ transcriptionId });

      setChoices(response.success ? (response.data ?? []) : []);

      if (!response.success) toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
    } catch (error) {
      setChoices([]);
      handleFrontendErrorWithToast(error);
    } finally {
      setIsLoadingChoices(false);
    }
  };

  const needle = search.trim().toLowerCase();
  const matches = (choices ?? []).filter((choice) => choice.path.toLowerCase().includes(needle));

  return (
    <div className="mt-5 rounded-lg border border-border bg-muted/40 p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        {hasFailed ? (
          <TriangleAlert size={14} className="text-destructive" aria-hidden="true" />
        ) : (
          <FolderOpen size={14} className="text-muted-foreground" aria-hidden="true" />
        )}
        {hasFailed
          ? "These notes could not be filed"
          : hasSuggestion
            ? "File these notes here?"
            : "Where should these notes go?"}
      </p>

      {hasSuggestion ? (
        <p className="mt-2 break-all font-medium text-foreground">{filing.folderPath}</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          No folder could be matched to this meeting, so nothing has been filed. Choose one and it will be
          saved there.
        </p>
      )}

      {/* The how and the why. Either alone is unfalsifiable, and the pair is
          what tells somebody whether this is worth checking. */}
      {decision ? <p className="mt-1.5 text-xs text-muted-foreground">{decision}</p> : null}
      {filing.reason ? (
        <p className="mt-0.5 break-words text-xs text-muted-foreground">{filing.reason}</p>
      ) : null}
      {hasFailed && filing.error ? (
        <p className="mt-1.5 break-words text-xs text-destructive">{filing.error}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {hasSuggestion && (
          <Button type="button" size="sm" onClick={() => confirm()} disabled={isPending} loading={isPending}>
            <Check size={14} aria-hidden="true" />
            {hasFailed ? "Try again" : "Yes, file it here"}
          </Button>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openPicker}
          disabled={isPending}
        >
          <FolderOpen size={14} aria-hidden="true" />
          {hasSuggestion ? "Choose a different folder" : "Choose a folder"}
        </Button>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Nothing is written to SharePoint until you confirm. The notes go into a folder of their own inside
        whichever folder you pick.
      </p>

      <AppDialog
        open={isPicking}
        onOpenChange={setIsPicking}
        title="Choose a folder"
        description="These are the folders catalogued from the SharePoint library. If the one you want is missing, the library needs crawling again."
      >
        <div className="space-y-3">
          <div className="relative">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search folders"
              className="pl-9"
              aria-label="Search folders"
            />
          </div>

          {isLoadingChoices ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              Loading folders.
            </p>
          ) : matches.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              {(choices ?? []).length === 0
                ? "No folders have been catalogued for this library yet, so there is nothing to choose from. An administrator can run a crawl on the SharePoint screen."
                : "No folder matches that search."}
            </p>
          ) : (
            // Bounded height with the count above it, so a library of
            // hundreds is scrollable rather than a page that never ends.
            <>
              <p className="text-xs text-muted-foreground">
                {matches.length.toLocaleString()} folder{matches.length === 1 ? "" : "s"}
              </p>
              <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
                {matches.map((choice) => (
                  <li key={choice.itemId}>
                    <button
                      type="button"
                      onClick={() => confirm(choice.itemId)}
                      disabled={isPending}
                      className="w-full break-all rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                    >
                      {choice.path}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </AppDialog>
    </div>
  );
}
