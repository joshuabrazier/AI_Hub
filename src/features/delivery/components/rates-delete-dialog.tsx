"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { AppDialog } from "@/components/app-dialog";
import { Button } from "@/components/ui/button";
import { MESSAGES } from "@/lib/constants";
import { RATE_BAND_LABELS } from "@/lib/data/kysely-database-types";
import { formatIsoDate } from "@/lib/format";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { formatCents } from "@/lib/timesheet/revenue";

import { deleteUserRateAction, getUserRateDeletionImpactAction } from "../delivery-rates.actions";
import type { UserRateDTO, UserRateDeletionImpactDTO } from "../delivery.types";

// -------------------------------------------------------------------
// Removing a rate row, and saying what that will do BEFORE it is done.
//
// A BARE "ARE YOU SURE?" WOULD BE A LIE BY OMISSION HERE, in both
// directions. Deleting a rate does NOT restate history - a time entry
// carries the cents it was charged at - so somebody who expects last
// quarter's margin to move is wrong, and somebody who therefore assumes the
// delete is harmless is also wrong: a rate resolves to the greatest start
// date on or before the work date and never a later one, so removing the
// EARLIEST row of a band leaves a window of dates with no rate at all, and
// anything backdated into that window comes back unvalued with nothing on
// any screen to say why.
//
// The service works both halves out from the rows while they still exist and
// hands back a finished SENTENCE. This dialog shows that sentence and does
// not assemble its own from the booleans beside it - four surfaces phrasing
// the window from the parts is four chances to get the off-by-one wrong.
//
// TWO REASONS THIS IS NOT ConfirmDialog, which is otherwise the one way this
// app asks "are you sure?". Its description renders inside a <p>, and the
// consequence wants a real panel around it rather than a run of prose. And
// it has ONE pending state, where this has two: fetching the consequence,
// then performing the delete - collapsing them would disable Cancel while a
// read it does not control is in flight.
//
// A GAP KEEPS THE DIALOG OPEN AFTERWARDS. The service returns the impact
// from the delete as well as from the read, precisely so being warned does
// not depend on a dialog having been opened first; a toast that fades in
// four seconds would throw that away for the one outcome worth reading
// twice.
// -------------------------------------------------------------------
export function RatesDeleteDialog({
  rate,
  open,
  onOpenChange,
}: {
  rate: UserRateDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [impact, setImpact] = useState<UserRateDeletionImpactDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Set once the row is gone. While it holds a gap, the dialog stays open
  // showing what that gap is.
  const [result, setResult] = useState<UserRateDeletionImpactDTO | null>(null);

  const rateId = rate?.id ?? null;

  // -------------------------------------------------------------------
  // Ask what this would do, on open.
  //
  // A read, so nothing is written and opening the dialog and closing it again
  // changes nothing. It is not pre-computed on the page for the reason the
  // action's own note gives: it is two further reads PER RATE ROW, and the
  // rates screen lists everybody in three bands.
  // -------------------------------------------------------------------
  useEffect(() => {
    if (!rateId) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await getUserRateDeletionImpactAction({ rateId });

        if (cancelled) return;

        if (!response.success) {
          setLoadError(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        setImpact(response.data);
      } catch {
        // Swallowed rather than toasted: the dialog is open and says so
        // itself, which is where the person is looking.
        if (!cancelled) setLoadError(MESSAGES.SOMETHING_WENT_WRONG);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rateId]);

  if (!rate) return null;

  const bandLabel = RATE_BAND_LABELS[rate.band];

  const confirm = () =>
    startTransition(async () => {
      try {
        const response = await deleteUserRateAction({ rateId: rate.id });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        router.refresh();

        // No gap: the next rate down takes over and there is nothing to read
        // twice, so the dialog closes like any other delete.
        if (!response.data.leavesGap) {
          toast.success("Rate removed");
          onOpenChange(false);
          return;
        }

        setResult(response.data);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isPending) return;
        onOpenChange(next);
      }}
      title={result ? "Rate removed" : "Remove this rate?"}
      description={
        result
          ? "It is gone, and it left dates with no rate. Worth reading before you close this."
          : `The ${bandLabel.toLowerCase()} rate starting ${formatIsoDate(rate.effectiveFrom)}.`
      }
    >
      <div className="space-y-4">
        {/* The row itself, so there is no doubt which one is going. */}
        <div className="rounded-lg border border-border px-3 py-2 text-sm">
          <p className="font-medium text-foreground">
            {bandLabel}, from {formatIsoDate(rate.effectiveFrom)}
          </p>
          <p className="text-muted-foreground">
            {formatCents(rate.chargeRateCents, 2)}/h charged
            {rate.costRateCents === null
              ? ", no cost recorded"
              : `, ${formatCents(rate.costRateCents, 2)}/h cost`}
          </p>
        </div>

        {result ? (
          <Consequence impact={result} tone="caution" />
        ) : loadError ? (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        ) : impact ? (
          <Consequence impact={impact} tone={impact.leavesGap ? "caution" : "plain"} />
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            Working out what removing this would do...
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {result ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={confirm}
                // Held until the consequence is on screen. A delete confirmed
                // before the warning arrives is an unwarned delete, which is
                // the whole thing this dialog exists to prevent.
                disabled={isPending || impact === null}
                loading={isPending}
              >
                {isPending ? "Removing…" : "Remove rate"}
              </Button>
            </>
          )}
        </div>
      </div>
    </AppDialog>
  );
}

// -------------------------------------------------------------------
// The service's sentence, rendered as it was written.
//
// The window is printed underneath it from `unvaluedFrom` / `unvaluedTo`
// only because those dates deserve to be seen as dates; the sentence is not
// rebuilt from them. `unvaluedTo` is null when the band has no later rate
// either, which is an open-ended window rather than a missing value.
// -------------------------------------------------------------------
function Consequence({
  impact,
  tone,
}: {
  impact: UserRateDeletionImpactDTO;
  tone: "caution" | "plain";
}) {
  if (tone === "plain") {
    return <p className="text-sm text-muted-foreground">{impact.consequence}</p>;
  }

  return (
    // An alert rather than a quiet note: it arrives after the panel that said
    // "working out what removing this would do", and it is the answer somebody
    // is waiting on before they press a destructive button.
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-data-caution/40 bg-data-caution-surface p-3 text-sm text-data-caution-text"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p>{impact.consequence}</p>
        {impact.unvaluedFrom ? (
          <p className="font-medium">
            Unvalued from {formatIsoDate(impact.unvaluedFrom)}
            {impact.unvaluedTo ? ` to ${formatIsoDate(impact.unvaluedTo)}` : " onwards"}.
          </p>
        ) : null}
      </div>
    </div>
  );
}
