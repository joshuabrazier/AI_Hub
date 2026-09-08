"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { AppDialog } from "@/components/app-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MESSAGES } from "@/lib/constants";
import { RATE_BANDS, RATE_BAND_LABELS, type RateBand } from "@/lib/data/kysely-database-types";
import { formatIsoDate } from "@/lib/format";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { setUserRateAction } from "../delivery-rates.actions";
import type { SetUserRateInputDTO, SetUserRateRequestDTO, UserRateDTO } from "../delivery.types";

// -------------------------------------------------------------------
// Set somebody's rate in one band, from one date.
//
// A RATE HAS A START DATE, and the dialog leads with it rather than hiding
// it behind an advanced toggle, because the date is the difference between
// setting a rate and rewriting history. Raising a rate in July must not
// restate June's margin, and the way this app keeps that promise is that
// each rate is a ROW with an effective date and every time entry snapshots
// the cents it was charged at. Nothing saved here moves a figure that has
// already been reported.
//
// THE SAVE IS AN UPSERT ON (person, band, start date). Saving over a
// combination that already has a rate CORRECTS it; any other date ADDS one
// and leaves the earlier rate covering earlier work. That is one sentence
// on the screen rather than two buttons, because "correct" and "add" are the
// same act with a different date and offering them separately would invite
// somebody to pick the wrong one.
//
// THE DATE IS LEFT BLANK when the dialog is opened for a new rate. Defaulting
// it to today would make backdating the unusual case, and backdating is what
// setting rates up for the first time is.
// -------------------------------------------------------------------

/** Whose rate. `name` is nullable because this app de-identifies dormant accounts in place. */
export type RateSubject = {
  userId: string;
  name: string | null;
  email: string | null;
};

export type RateSetTarget = {
  subject: RateSubject;
  /** Which band the dialog opens on. Still changeable inside it. */
  band: RateBand;
  /**
   * The row being corrected, when the dialog was opened from one. Its start
   * date is prefilled, so saving it back unchanged corrects that row rather
   * than adding a second one.
   */
  rate?: UserRateDTO | null;
  /**
   * The rate to prefill the amounts from, per band. Supplied by the overview,
   * where "the rate in force today" is exactly what is on screen. Absent
   * bands prefill empty, which is the honest default when the caller does not
   * know what that band is worth.
   */
  bands?: Partial<Record<RateBand, UserRateDTO | null>>;
};

// Built here rather than imported: kysely-database-types has no
// RATE_BAND_OPTIONS beside its role ones, and this is a screen concern.
const BAND_OPTIONS = Object.values(RATE_BANDS).map((band) => ({
  value: band,
  label: RATE_BAND_LABELS[band],
}));

// -------------------------------------------------------------------
// Cents back into the box somebody types dollars into.
//
// This is the one division in this feature and it is a DISPLAY conversion,
// not a figure: the schema does the same conversion in the other direction
// at the boundary, and the stored cents remain the truth. Two decimal places
// so it round-trips exactly - `.toString()` on 22050 cents gives "220.5",
// which is the same money but invites somebody to wonder.
// -------------------------------------------------------------------
function dollarsInputValue(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";

  return (cents / 100).toFixed(2);
}

export function RatesSetDialog({
  target,
  open,
  onOpenChange,
}: {
  target: RateSetTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // The row the amounts start from: the one being corrected if the dialog was
  // opened from one, otherwise whatever the caller says that band is worth.
  const initialRate = target ? (target.rate ?? target.bands?.[target.band] ?? null) : null;

  // Seeded once, because the caller remounts this on a new target (the
  // RowDialog rule: without a fresh mount, opening a second row shows the
  // first one's values).
  const [band, setBand] = useState<RateBand>(target?.band ?? RATE_BANDS.STANDARD);
  const [effectiveFrom, setEffectiveFrom] = useState(target?.rate?.effectiveFrom ?? "");
  const [chargeRate, setChargeRate] = useState(dollarsInputValue(initialRate?.chargeRateCents));
  const [costRate, setCostRate] = useState(dollarsInputValue(initialRate?.costRateCents));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  if (!target) return null;

  const { subject } = target;

  // Switching band changes ONLY the amounts, and empties them when the caller
  // did not say what that band is worth. The figure in the box belonged to the
  // band being left, and carrying it across is how a discounted rate gets
  // saved as a high one.
  const changeBand = (next: RateBand) => {
    setBand(next);
    setChargeRate(dollarsInputValue(target.bands?.[next]?.chargeRateCents));
    setCostRate(dollarsInputValue(target.bands?.[next]?.costRateCents));
  };

  const isCorrection =
    target.rate !== null &&
    target.rate !== undefined &&
    target.rate.band === band &&
    target.rate.effectiveFrom === effectiveFrom;

  const save = () =>
    startTransition(async () => {
      setFieldErrors({});
      setFormError(null);

      try {
        // -----------------------------------------------------------------
        // THE VALUES SENT ARE DOLLARS AS TYPED, not cents, and the empty cost
        // box travels as "" rather than as null.
        //
        // That is what `SetUserRateSchema` parses: `dollarsField` converts
        // dollars to integer cents, and `optionalDollarsField` reads "" as
        // "nobody has recorded a cost" and stores null. Sending null instead
        // coerces to 0 and would record the cost as FREE - the exact
        // unvalued-is-not-zero failure this module is written around - so the
        // request is built against the schema's INPUT type, where the cost
        // box is a string.
        //
        // The cast is only about the action's SIGNATURE, which is typed
        // against the schema's OUTPUT. Reported rather than worked around
        // twice: an action a form cannot call without a cast wants its
        // parameter widened to SetUserRateInputDTO.
        // -----------------------------------------------------------------
        const request: SetUserRateInputDTO = {
          userId: subject.userId,
          band,
          effectiveFrom,
          chargeRate: chargeRate.trim(),
          costRate: costRate.trim(),
        };

        const response = await setUserRateAction(request as unknown as SetUserRateRequestDTO);

        if (!response.success) {
          setFieldErrors(response.fieldErrors ?? {});
          setFormError(response.formError ?? null);

          if (!response.fieldErrors && !response.formError) toast.error(MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        toast.success(isCorrection ? "Rate corrected" : "Rate saved");
        onOpenChange(false);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-save would leave the caller with nowhere to report what
        // happened, the same rule ConfirmDialog applies.
        if (!next && isPending) return;
        onOpenChange(next);
      }}
      title="Set a rate"
      description={
        subject.name
          ? `What ${subject.name} is charged out at, and what they cost, from a date you choose.`
          : "What this person is charged out at, and what they cost, from a date you choose."
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="space-y-5"
      >
        <div className="grid gap-2">
          <Label htmlFor="rate-band">Band</Label>
          <Select value={band} onValueChange={(value) => changeBand(value as RateBand)} disabled={isPending}>
            <SelectTrigger id="rate-band" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BAND_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError errors={fieldErrors.band} />
          <p className="text-xs text-muted-foreground">
            Which band applies is decided per project member, so somebody can be discounted for one client and
            standard for another.
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="rate-effective-from">Applies from</Label>
          <Input
            id="rate-effective-from"
            type="date"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
            disabled={isPending}
            aria-describedby="rate-effective-from-hint"
          />
          <FieldError errors={fieldErrors.effectiveFrom} />
          <p id="rate-effective-from-hint" className="text-xs text-muted-foreground">
            {isCorrection
              ? `This corrects the ${RATE_BAND_LABELS[band].toLowerCase()} rate that already starts on ${formatIsoDate(effectiveFrom)}. Work logged before that date keeps the rate it was charged at.`
              : "A rate covers work done on or after this date. Backdate it to cover work already logged; a later date is fine too, for a rise that starts next quarter. Saving over a date that already has a rate in this band corrects it."}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="rate-charge">Charged per hour</Label>
            <Input
              id="rate-charge"
              inputMode="decimal"
              placeholder="e.g. 220"
              value={chargeRate}
              onChange={(event) => setChargeRate(event.target.value)}
              disabled={isPending}
            />
            <FieldError errors={fieldErrors.chargeRate} />
            <p className="text-xs text-muted-foreground">In dollars. A row with no charge rate is not a rate.</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="rate-cost">Cost per hour</Label>
            <Input
              id="rate-cost"
              inputMode="decimal"
              placeholder="optional"
              value={costRate}
              onChange={(event) => setCostRate(event.target.value)}
              disabled={isPending}
            />
            <FieldError errors={fieldErrors.costRate} />
            <p className="text-xs text-muted-foreground">
              Leave blank and margin stays unknown, which is not the same as nothing.
            </p>
          </div>
        </div>

        {formError ? (
          <p
            role="alert"
            className="rounded-lg border border-data-caution/40 bg-data-caution-surface px-3 py-2 text-sm text-data-caution-text"
          >
            {formError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            // Both required fields, checked here only so the button is not a
            // trap. The schema decides what is acceptable and says why.
            disabled={isPending || effectiveFrom.trim().length === 0 || chargeRate.trim().length === 0}
            loading={isPending}
          >
            {isPending ? "Saving..." : isCorrection ? "Correct rate" : "Save rate"}
          </Button>
        </div>
      </form>
    </AppDialog>
  );
}

// The server's own words for a field it refused, under the field it refused.
function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;

  return (
    <p role="alert" className="text-xs text-destructive">
      {errors[0]}
    </p>
  );
}
