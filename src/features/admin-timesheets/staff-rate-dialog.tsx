"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { formatCents } from "@/lib/timesheet/revenue";

import { deleteStaffRateAction, saveStaffRateAction } from "./admin-timesheets-rate.actions";
import type { PersonRatesDTO } from "./admin-timesheets-rate.types";

// -------------------------------------------------------------------
// Set somebody's charge rate.
//
// THE FORM TAKES DOLLARS, storage is integer cents, and the conversion happens
// once in the schema. Nothing downstream ever sees a fractional amount - see
// migration 007 for why that matters more here than it looks.
//
// A RATE HAS A START DATE, and the dialog leads with it rather than hiding it
// behind an "advanced" toggle, because the date is the difference between
// setting a rate and rewriting history. Existing rows are listed so it is
// obvious that a rise adds a row rather than replacing one.
// -------------------------------------------------------------------
export function StaffRateDialog({
  personId,
  personName,
  rates,
  triggerLabel = "Rates",
}: {
  personId: string;
  personName: string | null;
  rates: PersonRatesDTO;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [chargeRate, setChargeRate] = useState("");
  const [costRate, setCostRate] = useState("");

  const onOpenChange = (next: boolean) => {
    if (next) {
      // Prefilled with the rate in force, so a rise is an edit of a number
      // rather than a retype. The DATE is left blank on purpose: defaulting it
      // to today would make backdating the unusual case, and backdating is
      // what everybody does when setting rates up for the first time.
      setEffectiveFrom("");
      setChargeRate(rates.currentChargeRateCents === null ? "" : (rates.currentChargeRateCents / 100).toString());
      setCostRate(rates.currentCostRateCents === null ? "" : (rates.currentCostRateCents / 100).toString());
    }
    setOpen(next);
  };

  const save = () => {
    startTransition(async () => {
      try {
        const response = await saveStaffRateAction({
          personId,
          personName: personName ?? undefined,
          effectiveFrom,
          chargeRate,
          costRate,
        });

        if (!response.success) {
          const first = response.fieldErrors ? Object.values(response.fieldErrors)[0]?.[0] : undefined;
          toast.error(first ?? response.formError ?? "Could not save the rate");
          return;
        }

        toast.success("Rate saved");
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      try {
        const response = await deleteStaffRateAction({ id });

        if (!response.success) {
          toast.error(response.formError ?? "Could not remove the rate");
          return;
        }

        toast.success("Rate removed");
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Coins className="size-4 shrink-0" aria-hidden="true" />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Charge rates{personName ? ` for ${personName}` : ""}</DialogTitle>
          <DialogDescription>
            A rate applies to work done on or after its start date. Adding one for a new date leaves earlier
            work valued at the earlier rate, so past periods keep reporting what they were worth.
          </DialogDescription>
        </DialogHeader>

        {rates.rates.length > 0 && (
          <div className="rounded-lg border border-border">
            <ul className="divide-y divide-border text-sm">
              {rates.rates.map((rate) => (
                <li key={rate.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">From {rate.effectiveFrom}</span>
                    <span className="ml-2 text-muted-foreground">
                      {formatCents(rate.chargeRateCents)}/h charged
                      {rate.costRateCents === null ? ", no cost recorded" : `, ${formatCents(rate.costRateCents)}/h cost`}
                    </span>
                  </span>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={() => remove(rate.id)}
                    aria-label={`Remove the rate from ${rate.effectiveFrom}`}
                  >
                    <Trash2 className="size-4 shrink-0" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="rate-from">Applies from</Label>
            <Input
              id="rate-from"
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              Backdate this to cover work already logged. Anything earlier stays unvalued.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
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
              <p className="text-xs text-muted-foreground">Leave blank and margin stays unknown.</p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Close
          </Button>
          <Button
            onClick={save}
            disabled={isPending || !effectiveFrom || !chargeRate}
            loading={isPending}
          >
            Save rate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
