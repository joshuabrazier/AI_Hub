"use client";

import { useState, useTransition } from "react";

import { Scale, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AppDialog } from "@/components/app-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MESSAGES } from "@/lib/constants";
import { formatIsoDate } from "@/lib/format";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { deleteTimeEntryAction, logTimeAction } from "../delivery-time.actions";
import {
  MAX_ENTRY_HOURS,
  NOTE_MAX_CHARS,
  formatMinutesAsClock,
  formatMinutesAsHours,
  type TimesheetCellDTO,
  type TimesheetRowDTO,
} from "../delivery.types";
import type { TimesheetTaskOption } from "./timesheet-catalogue";

// -------------------------------------------------------------------
// ===================================================================
// ONE CELL: ONE TASK, ONE DAY
// ===================================================================
//
// Hours and a note, typed the way people say them - 0.5, 1.5 - and NOT
// converted here. `hours` reaches the action as the number somebody typed
// and LogTimeSchema turns it into minutes at the boundary, which is the one
// place that conversion happens in the whole module. A component doing its
// own multiplication would be a second answer to it, and the two would
// disagree about rounding the first time either changed. (The request type
// names the field `hours` and types it as a number for exactly that reason -
// see the note at the top of delivery-time.actions.ts.)
//
// IT IS NO LONGER HOW A FIGURE GETS TYPED IN. The grid's cells are inputs -
// see TimesheetDayCell - so entering a week is typing and tabbing, and this
// dialog is reached deliberately, for the three things a cell cannot do: add
// a note, put a SECOND entry on a day that already has one, and clear a day.
//
// IT ADDS AN ENTRY, AND IT STILL DOES NOT EDIT ONE, which is now about this
// dialog rather than about the schema. A day legitimately holds several
// entries - an hour in the morning and another after lunch, each with its
// own note - so a form here has no single entry to bind to, and picking one
// would rewrite whichever the query happened to return first.
//
// WHAT USED TO BE WRITTEN HERE was that `UpdateTimeEntrySchema` required
// `notes`, so any in-place edit would silently delete the note the moment
// somebody corrected an hour - and that note is what a client's invoice
// narrative is written from. That is no longer the case: the schema is a
// PATCH, an absent `notes` leaves the stored note alone, and an absent
// `workDate` leaves the captured rate snapshot alone. The grid corrects a
// single-entry day through exactly that, and hands a multi-entry day here
// instead. The rule that mattered is intact - correcting an hour never
// touches a note - and it is now enforced by the request shape rather than
// by refusing to offer the edit.
//
// ADJUSTING THE ESTIMATE IS REACHED FROM HERE and is the parent's to open,
// because it is a different act with different consequences: this dialog
// records work that happened, that one changes the plan. It appears only
// when the SERVER said the viewer may do it (`canEditTasks`, off the board
// read), never from a role inspected in a component.
// -------------------------------------------------------------------

// A quarter of an hour, because that is the unit a timesheet is filled in
// with. It is the arrow-key step only - anything the schema accepts can
// still be typed.
const HOURS_STEP = "0.25";

export function TimesheetCellDialog({
  row,
  cell,
  task,
  canAdjustEstimate,
  onOpenChange,
  onSaved,
  onAdjustEstimate,
}: {
  row: TimesheetRowDTO;
  cell: TimesheetCellDTO;
  // From the catalogue, and null when the row names a project the person is
  // no longer a member of - their own history, which they can still read.
  task: TimesheetTaskOption | null;
  canAdjustEstimate: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onAdjustEstimate: () => void;
}) {
  const [hours, setHours] = useState("");
  const [notes, setNotes] = useState("");
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isClearing, setIsClearing] = useState(false);

  const typedHours = Number(hours);
  const canSubmit = hours.trim().length > 0 && Number.isFinite(typedHours) && typedHours > 0;

  const submit = () =>
    startTransition(async () => {
      setHoursError(null);

      try {
        const response = await logTimeAction({
          taskId: row.taskId,
          workDate: cell.date,
          // The number as typed. The schema converts it to minutes.
          hours: typedHours,
          notes,
        });

        if (!response.success) {
          // A field error belongs against the field. Anything else is the
          // service's own sentence - a task somebody deleted, an archived
          // project, a day that has not happened yet - and is worth reading
          // in full rather than being reduced to "that did not work".
          const fieldError = response.fieldErrors?.hours?.[0] ?? null;

          setHoursError(fieldError);

          if (!fieldError) toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);

          return;
        }

        toast.success("Time logged");
        onSaved();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  // -------------------------------------------------------------------
  // Remove every entry behind this cell.
  //
  // ONE AT A TIME, AND IT STOPS AT THE FIRST REFUSAL. Server actions run in
  // sequence anyway, and carrying on past a refusal would leave somebody
  // with a partly cleared day and one message that does not say which part.
  // The week is re-read either way, so what is on screen afterwards is what
  // the database holds.
  // -------------------------------------------------------------------
  const clearDay = () =>
    startTransition(async () => {
      try {
        for (const { id: timeEntryId } of cell.entries) {
          const response = await deleteTimeEntryAction({ timeEntryId });

          if (!response.success) {
            toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
            setIsClearing(false);
            onSaved();

            return;
          }
        }

        setIsClearing(false);
        toast.success(cell.entries.length === 1 ? "Time entry removed" : "Time entries removed");
        onSaved();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  const dayLabel = formatIsoDate(cell.date, "EEEE d MMMM yyyy");

  return (
    <>
      <AppDialog open onOpenChange={onOpenChange} title="Log time" description={dayLabel}>
        {/* The task, the project and the client, all typed by people and all
            rendered as text nodes. Which cell this is never depends on
            remembering which one was clicked. */}
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-sm font-medium text-foreground">{row.taskTitle}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.clientName} - {row.projectTitle} - {row.phaseName}
          </p>

          {cell.minutes > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              {formatMinutesAsClock(cell.minutes)} already logged on this day
              {cell.entries.length > 1 ? `, across ${cell.entries.length} entries` : ""}. Anything you add here
              is a further entry - to CORRECT the figure, type over the cell in the grid instead.
            </p>
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="space-y-5"
        >
          <div className="grid gap-2">
            <Label htmlFor="timesheet-cell-hours">Hours</Label>
            <Input
              id="timesheet-cell-hours"
              type="number"
              inputMode="decimal"
              step={HOURS_STEP}
              min={0}
              max={MAX_ENTRY_HOURS}
              placeholder="e.g. 1.5"
              autoFocus
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              aria-invalid={hoursError !== null}
              aria-describedby={hoursError ? "timesheet-cell-hours-error" : "timesheet-cell-hours-hint"}
              className="tabular-nums"
            />
            {hoursError ? (
              <p id="timesheet-cell-hours-error" className="text-sm text-destructive">
                {hoursError}
              </p>
            ) : (
              <p id="timesheet-cell-hours-hint" className="text-sm text-muted-foreground">
                As you would say it: 0.5 is half an hour, 1.5 is an hour and a half.
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="timesheet-cell-notes">Note (optional)</Label>
            <Textarea
              id="timesheet-cell-notes"
              value={notes}
              maxLength={NOTE_MAX_CHARS}
              placeholder="What you did"
              onChange={(event) => setNotes(event.target.value)}
              className="min-h-20"
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            {cell.minutes > 0 && (
              <Button
                type="button"
                variant="destructive"
                className="mr-auto"
                disabled={isPending}
                onClick={() => setIsClearing(true)}
              >
                <Trash2 size={16} aria-hidden="true" />
                Clear this day
              </Button>
            )}

            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !canSubmit} loading={isPending}>
              {isPending ? "Saving..." : "Log time"}
            </Button>
          </div>
        </form>

        {/* The plan rather than the work. Shown only to somebody the server
            said may change it. */}
        {canAdjustEstimate && task && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
            <p className="text-sm text-muted-foreground">
              Estimated at{" "}
              <span className="font-medium tabular-nums text-foreground">
                {formatMinutesAsClock(task.estimateMinutes)}
              </span>
              , with {formatMinutesAsHours(task.loggedMinutes)} hours logged against it so far.
            </p>

            <Button type="button" variant="outline" size="sm" onClick={onAdjustEstimate}>
              <Scale size={14} aria-hidden="true" />
              Adjust the estimate
            </Button>
          </div>
        )}
      </AppDialog>

      <ConfirmDialog
        open={isClearing}
        onOpenChange={setIsClearing}
        title="Clear this day?"
        description={`${formatMinutesAsClock(cell.minutes)} on "${row.taskTitle}" for ${dayLabel} will be permanently deleted, along with any note on it. This cannot be undone.`}
        confirmLabel="Clear the day"
        pendingLabel="Clearing..."
        isPending={isPending}
        onConfirm={clearDay}
      />
    </>
  );
}
