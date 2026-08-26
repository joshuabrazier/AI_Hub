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
import { ISO_WEEKDAY_LABELS } from "@/lib/timesheet/staff-capacity";
import { cn } from "@/lib/utils";

import { StaffTargetDTO } from "./admin-timesheets.types";

// Monday first, and the weekend included: plenty of arrangements involve a
// Saturday, and leaving it out would make those unrepresentable.
const WEEKDAY_OPTIONS = [
  { iso: 1, short: "Mon" },
  { iso: 2, short: "Tue" },
  { iso: 3, short: "Wed" },
  { iso: 4, short: "Thu" },
  { iso: 5, short: "Fri" },
  { iso: 6, short: "Sat" },
  { iso: 7, short: "Sun" },
];

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
  // Which days, as ISO weekday numbers. Empty means unspecified, which keeps
  // the old behaviour of spreading the count across every weekday.
  const [weekdays, setWeekdays] = useState<number[]>(target.workingWeekdays ?? []);
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
        workingWeekdays: weekdays,
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

          {/* -------------------------------------------------------------
              WHICH days, not just how many.

              Optional on purpose. Left empty, capacity is spread across every
              weekday as it always was - the honest answer when nobody has said
              which days somebody works. Chosen, the whole feature gets sharper:
              capacity lands on those days, the forecast can say "Tuesday and
              Wednesday remain" instead of averaging, and an empty Monday for a
              Tue-Thu person stops looking like a day missed.

              Selecting days sets the count, because two fields that can
              disagree about the same fact is how a three-day person ends up
              with four days of capacity.
              ------------------------------------------------------------- */}
          <div className="space-y-1.5">
            <Label>Days worked</Label>

            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_OPTIONS.map((option) => {
                const selected = weekdays.includes(option.iso);

                return (
                  <button
                    key={option.iso}
                    type="button"
                    disabled={busy}
                    aria-pressed={selected}
                    onClick={() => {
                      const next = selected
                        ? weekdays.filter((day) => day !== option.iso)
                        : [...weekdays, option.iso].sort((a, b) => a - b);

                      setWeekdays(next);
                      // Keep the count in step with the choice. Only when days
                      // are chosen: clearing them leaves the number alone so a
                      // half-day arrangement is not silently rounded.
                      if (next.length > 0) setDays(String(next.length));
                    }}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                      selected
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option.short}
                  </button>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              {weekdays.length === 0
                ? "Not set, so the contracted days are spread across every weekday. Choose days to place them exactly."
                : `Capacity falls on ${weekdays.map((day) => ISO_WEEKDAY_LABELS[day]).join(", ")} only.`}
            </p>
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
