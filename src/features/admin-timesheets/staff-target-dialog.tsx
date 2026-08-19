"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SlidersHorizontal } from "lucide-react";
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

import { saveStaffTargetAction } from "./admin-timesheets.actions";
import { StaffTargetDTO } from "./admin-timesheets.types";

// -------------------------------------------------------------------
// Set what a person is expected to work and bill.
//
// The form speaks in the units people actually use - days a week, hours a day,
// a billable percentage. The conversion to the tenths and minutes the database
// keeps happens in the action, so nobody has to think in tenths.
//
// Leaving the billable target empty means "no target", which is not the same
// as a target of zero. One shows a dash and judges nothing; the other says
// this person is expected to bill nothing. The field is deliberately allowed
// to be blank so that distinction survives.
// -------------------------------------------------------------------
export function StaffTargetDialog({
  personId,
  personName,
  target,
  triggerLabel,
}: {
  personId: string;
  personName: string;
  target: StaffTargetDTO;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const [days, setDays] = useState(String(target.workingDaysPerWeek));
  const [hours, setHours] = useState(String(target.hoursPerDay));
  const [billable, setBillable] = useState(
    target.billableTargetPercent === null ? "" : String(target.billableTargetPercent),
  );

  const weeklyHours = Number(days) * Number(hours);

  async function save() {
    setSaving(true);

    try {
      const result = await saveStaffTargetAction({
        personId,
        personName,
        workingDaysPerWeek: Number(days),
        hoursPerDay: Number(hours),
        billableTargetPercent: billable === "" ? null : Number(billable),
      });

      if (!result.success) {
        // Field errors come back keyed by field; the first one is the most
        // useful thing to say in a toast.
        const firstFieldError = Object.values(result.fieldErrors ?? {})[0]?.[0];
        toast.error(firstFieldError ?? result.formError ?? "That could not be saved.");
        return;
      }

      toast.success(`Target saved for ${personName}.`);
      setOpen(false);
      startTransition(() => router.refresh());
    } catch {
      toast.error("That could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal aria-hidden />
          {triggerLabel ?? "Set target"}
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Target for {personName}</DialogTitle>
          <DialogDescription>
            Utilisation is measured against this, so somebody on three days a week is judged against three days, not
            five.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="days">Days per week</Label>
              <Input
                id="days"
                type="number"
                inputMode="decimal"
                min={0}
                max={7}
                step={0.5}
                value={days}
                onChange={(event) => setDays(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">Half days allowed</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="hours">Hours per day</Label>
              <Input
                id="hours"
                type="number"
                inputMode="decimal"
                min={0.5}
                max={24}
                step={0.25}
                value={hours}
                onChange={(event) => setHours(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {Number.isFinite(weeklyHours) && weeklyHours > 0 ? `${weeklyHours.toFixed(2)}h a week` : " "}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="billable">Billable target (%)</Label>
            <Input
              id="billable"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              placeholder="No target"
              value={billable}
              onChange={(event) => setBillable(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Share of logged time expected to be billable. Leave empty for no target - that is different from a
              target of zero.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving" : "Save target"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
