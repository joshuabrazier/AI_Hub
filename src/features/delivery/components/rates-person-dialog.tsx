"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { AppDialog } from "@/components/app-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MESSAGES } from "@/lib/constants";
import { RATE_BAND_LABELS, RATE_BAND_ORDER, type RateBand } from "@/lib/data/kysely-database-types";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { setUserRatesAction } from "../delivery-rates.actions";
import type {
  SetUserRatesInputDTO,
  SetUserRatesRequestDTO,
  UserRateBandsDTO,
} from "../delivery.types";

// -------------------------------------------------------------------
// RatesPersonDialog
//
// ONE PERSON, ALL THREE BANDS, ONE DATE.
//
// WHAT THIS REPLACES, AND WHY IT WAS WORSE THAN CLUNKY. Pricing somebody
// meant opening a dialog, choosing a band, typing a date and two amounts,
// saving - and then doing all of it twice more. Three bands are decided in
// one conversation and start on the same day, so that was three passes over
// one decision.
//
// The date is the part that made it a correctness problem rather than an
// annoyance. It had to be retyped for each band, and nothing checked that
// the three matched: mistype one and the person is priced from a different
// Monday in that band, which no screen shows and nobody thinks to look for.
// Here the date is entered once and the service writes every band from it in
// one transaction.
//
// -------------------------------------------------------------------
// A BAND LEFT BLANK IS LEFT ALONE, WHICH IS WHAT MAKES THIS AN EDIT.
//
// The form carries all three bands, so the obvious implementation posts all
// three - and then somebody raising the standard rate blanks the discounted
// and high rates they never looked at. `SetUserRatesSchema` takes each band
// as optional and absent means unchanged, so only the bands with something
// typed in them are sent.
//
// A BAND WITH A COST BUT NO CHARGE IS STILL SENT, deliberately, and it is
// the one case where sending something the server will refuse is right.
// Omitting it - the tidy version of "only send complete bands" - silently
// discards an amount somebody typed and reports success. Sent, the schema
// says "a row with no charge rate is not a rate" against the box that is
// empty, which is the truth.
//
// THE AMOUNTS ARE PREFILLED FROM WHAT IS IN FORCE TODAY, which is what the
// overview row already shows. So saving without touching a band re-states
// its current amount from the new date - correct, and visible, rather than
// the band quietly keeping an older start date than its neighbours.
// -------------------------------------------------------------------

/**
 * The values sent are DOLLARS AS TYPED, and an empty cost box travels as ""
 * rather than as null - which is why the request is built against the
 * schema's INPUT type. `optionalDollarsField` reads "" as "nobody has
 * recorded a cost" and stores null; null would coerce to 0 and record the
 * cost as FREE, the unvalued-is-not-zero failure this module is written
 * around.
 *
 * The cast is only about the action's SIGNATURE, which is typed against the
 * schema's OUTPUT. Same note as the single-band dialog: an action a form
 * cannot call without a cast wants its parameter widened.
 */
type BandEntry = { chargeRate: string; costRate: string };

// Cents back into the box somebody types dollars into. A display conversion,
// not a figure - the stored cents remain the truth, and the schema converts
// the other way at the boundary. Two decimal places so it round-trips
// exactly: `.toString()` on 22050 cents gives "220.5", the same money but it
// invites somebody to wonder.
function dollarsInputValue(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";

  return (cents / 100).toFixed(2);
}

const initialEntries = (person: UserRateBandsDTO): Record<RateBand, BandEntry> =>
  Object.fromEntries(
    RATE_BAND_ORDER.map((band) => [
      band,
      {
        chargeRate: dollarsInputValue(person.bands[band]?.chargeRateCents),
        costRate: dollarsInputValue(person.bands[band]?.costRateCents),
      },
    ]),
  ) as Record<RateBand, BandEntry>;

export function RatesPersonDialog({
  person,
  open,
  onOpenChange,
}: {
  person: UserRateBandsDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Seeded once, because the caller remounts this on a new person - without a
  // fresh mount, opening a second row shows the first one's figures.
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [entries, setEntries] = useState<Record<RateBand, BandEntry>>(() =>
    person ? initialEntries(person) : ({} as Record<RateBand, BandEntry>),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  if (!person) return null;

  const setEntry = (band: RateBand, patch: Partial<BandEntry>) =>
    setEntries((current) => ({ ...current, [band]: { ...current[band], ...patch } }));

  // Anything typed in either box counts, so a cost with no charge is sent and
  // refused rather than dropped. See the note above.
  const entered = RATE_BAND_ORDER.filter(
    (band) =>
      entries[band].chargeRate.trim().length > 0 || entries[band].costRate.trim().length > 0,
  );

  const save = () =>
    startTransition(async () => {
      setFieldErrors({});
      setFormError(null);

      try {
        const request: SetUserRatesInputDTO = {
          userId: person.userId,
          effectiveFrom,
          bands: Object.fromEntries(
            entered.map((band) => [
              band,
              {
                chargeRate: entries[band].chargeRate.trim(),
                costRate: entries[band].costRate.trim(),
              },
            ]),
          ),
        };

        const response = await setUserRatesAction(request as unknown as SetUserRatesRequestDTO);

        if (!response.success) {
          // Nested paths arrive joined - "bands.standard.chargeRate" - which
          // is what the per-box lookups below read.
          setFieldErrors(response.fieldErrors ?? {});
          setFormError(response.formError ?? null);

          if (!response.fieldErrors && !response.formError) toast.error(MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        toast.success(
          response.data.length === 1 ? "Rate saved" : `${response.data.length} rates saved`,
        );
        onOpenChange(false);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  const personName = person.name ?? person.email;

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-save would leave the caller with nowhere to report what
        // happened, the same rule ConfirmDialog applies.
        if (!next && isPending) return;
        onOpenChange(next);
      }}
      title="Set rates"
      description={
        personName
          ? `What ${personName} is charged out at in each band, and what they cost, from one date.`
          : "What this person is charged out at in each band, and what they cost, from one date."
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
          <Label htmlFor="rates-effective-from">Applies from</Label>
          <Input
            id="rates-effective-from"
            type="date"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
            disabled={isPending}
            aria-describedby="rates-effective-from-hint"
          />
          <FieldError errors={fieldErrors.effectiveFrom} />
          <p id="rates-effective-from-hint" className="text-xs text-muted-foreground">
            One date for every band below. A rate covers work done on or after it - backdate it to cover work
            already logged, or set it ahead for a rise that starts next quarter. Work logged before it keeps the
            rate it was charged at. Saving over a date a band already has corrects that rate rather than adding a
            second one.
          </p>
        </div>

        <fieldset className="grid gap-4" disabled={isPending}>
          <legend className="text-sm font-medium text-foreground">Bands</legend>
          <p className="-mt-2 text-xs text-muted-foreground">
            Which band applies is decided per project member, so somebody can be discounted for one client and
            standard for another. Each band is prefilled with what it is worth today: every one with an amount
            in it is saved from the date above, so clear a band to leave it where it is.
          </p>

          {RATE_BAND_ORDER.map((band) => (
            <div key={band} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor={`rate-charge-${band}`}>{RATE_BAND_LABELS[band]} charged per hour</Label>
                <Input
                  id={`rate-charge-${band}`}
                  inputMode="decimal"
                  placeholder="e.g. 220"
                  value={entries[band].chargeRate}
                  onChange={(event) => setEntry(band, { chargeRate: event.target.value })}
                />
                <FieldError errors={fieldErrors[`bands.${band}.chargeRate`]} />
              </div>

              <div className="grid gap-2">
                <Label htmlFor={`rate-cost-${band}`}>{RATE_BAND_LABELS[band]} cost per hour</Label>
                <Input
                  id={`rate-cost-${band}`}
                  inputMode="decimal"
                  placeholder="optional"
                  value={entries[band].costRate}
                  onChange={(event) => setEntry(band, { costRate: event.target.value })}
                />
                <FieldError errors={fieldErrors[`bands.${band}.costRate`]} />
                <p className="text-xs text-muted-foreground">
                  Blank leaves margin unknown, which is not the same as nothing.
                </p>
              </div>
            </div>
          ))}

          {/* The schema's own refusal when nothing was typed in any band. */}
          <FieldError errors={fieldErrors.bands} />
        </fieldset>

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
            // Checked here only so the button is not a trap. The schema
            // decides what is acceptable and says why.
            disabled={isPending || effectiveFrom.trim().length === 0 || entered.length === 0}
            loading={isPending}
          >
            {isPending
              ? "Saving…"
              : entered.length === 1
                ? "Save 1 rate"
                : `Save ${entered.length} rates`}
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
