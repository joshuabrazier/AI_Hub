"use client";

import { useState, useTransition } from "react";

import { Plus, Scale, Trash2 } from "lucide-react";
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
import { cn } from "@/lib/utils";

import { deleteTimeEntryAction, logTimeAction, updateTimeEntryAction } from "../delivery-time.actions";
import {
  MAX_ENTRY_HOURS,
  NOTE_MAX_CHARS,
  formatMinutesAsClock,
  formatMinutesAsHours,
  type TimesheetCellDTO,
  type TimesheetCellEntryDTO,
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
// and the schema turns it into minutes at the boundary, which is the one
// place that conversion happens in the whole module. A component doing its
// own multiplication would be a second answer to it, and the two would
// disagree about rounding the first time either changed.
//
// IT EDITS WHAT IS THERE, AND IT USED TO ONLY ADD. The old behaviour opened
// an empty box on a day that already had time on it, so correcting 1.5 to 2
// meant clearing the day and typing it again - and the note went with it.
// The argument for that was real at the time and is worth recording, because
// it is what dictates the shape below: an edit form is only safe if it can
// show the note it is about to overwrite. `UpdateTimeEntrySchema` treats an
// absent note as NULL, so a form that opened blank would silently delete
// whatever was on the entry the moment somebody fixed an hour - and that
// note is what a client's invoice narrative is written from.
//
// It can show it. `TimesheetCellEntryDTO` carries `notes` alongside `id` and
// `minutes`, so the entry arrives complete and the form opens with the real
// note in the box. Overwriting it is then something somebody did, not
// something that happened to them.
//
// WHICH LEAVES THE HONEST DIFFICULTY: A DAY CAN HOLD SEVERAL ENTRIES, and a
// cell shows their TOTAL. "Edit 3h" is not a question with one answer when
// it is 1h and 2h logged separately, each with its own note. So:
//
//   no entries      the form adds one. Nothing else to show.
//   one entry       the form opens on it, filled in. The ordinary case, and
//                   the one this change is for.
//   several         they are listed, each with its hours and its note, and
//                   picking one opens the form on it. Nothing is collapsed
//                   into a single figure that could not be typed back.
//
// Adding a further entry stays available in every case, because a day
// legitimately holds several - two sittings on one task with different notes
// is a real thing and not a mistake to be tidied away.
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
  // -----------------------------------------------------------------
  // WHICH ENTRY THE FORM IS ON, or null when it is adding a new one.
  //
  // A day with exactly one entry opens ON it, because that is what somebody
  // clicking a cell showing "1.5" is asking to change. More than one and
  // there is no single thing they meant, so the form starts blank and the
  // list below is the way in.
  //
  // The parent KEYS this component on the cell, so opening a different day
  // mounts a fresh dialog rather than carrying this state across - without
  // that, clicking from a filled cell to an empty one would leave the
  // previous day's hours in the box.
  // -----------------------------------------------------------------
  const soleEntry = cell.entries.length === 1 ? cell.entries[0] : null;

  const [editingId, setEditingId] = useState<string | null>(soleEntry?.id ?? null);
  const [hours, setHours] = useState(soleEntry ? formatMinutesAsHours(soleEntry.minutes) : "");
  const [notes, setNotes] = useState(soleEntry?.notes ?? "");
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<"entry" | "day" | null>(null);

  // Re-read from the cell rather than held in state, so a re-render after a
  // save shows what the server returned rather than what was typed.
  const editing = editingId ? (cell.entries.find((entry) => entry.id === editingId) ?? null) : null;

  // The three move together or not at all - a half-switched form would show
  // one entry's hours against another's note.
  const openEntry = (entry: TimesheetCellEntryDTO) => {
    setEditingId(entry.id);
    setHours(formatMinutesAsHours(entry.minutes));
    setNotes(entry.notes ?? "");
    setHoursError(null);
  };

  const openNewEntry = () => {
    setEditingId(null);
    setHours("");
    setNotes("");
    setHoursError(null);
  };

  const typedHours = Number(hours);
  const canSubmit = hours.trim().length > 0 && Number.isFinite(typedHours) && typedHours > 0;

  const submit = () =>
    startTransition(async () => {
      setHoursError(null);

      try {
        // ONE BRANCH, TWO ACTIONS. An edit names an ENTRY and the service
        // re-resolves who owns it; an add names a task and a day. Neither
        // trusts anything decided here - this only chooses which question is
        // being asked.
        //
        // `notes` is sent on the edit whatever it holds, including empty:
        // the box was filled in from the stored note, so an empty one is
        // somebody clearing it rather than a field that was never populated.
        const response = editing
          ? await updateTimeEntryAction({
              timeEntryId: editing.id,
              hours: typedHours,
              notes,
            })
          : await logTimeAction({
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

        toast.success(editing ? "Time updated" : "Time logged");
        onSaved();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  // -------------------------------------------------------------------
  // Remove the entry being edited, or every entry behind this cell.
  //
  // ONE AT A TIME, AND IT STOPS AT THE FIRST REFUSAL. Server actions run in
  // sequence anyway, and carrying on past a refusal would leave somebody
  // with a partly cleared day and one message that does not say which part.
  // The week is re-read either way, so what is on screen afterwards is what
  // the database holds.
  // -------------------------------------------------------------------
  const removeEntries = (targets: readonly TimesheetCellEntryDTO[], successMessage: string) =>
    startTransition(async () => {
      try {
        for (const { id: timeEntryId } of targets) {
          const response = await deleteTimeEntryAction({ timeEntryId });

          if (!response.success) {
            toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
            setConfirming(null);
            onSaved();

            return;
          }
        }

        setConfirming(null);
        toast.success(successMessage);
        onSaved();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  const dayLabel = formatIsoDate(cell.date, "EEEE d MMMM yyyy");

  return (
    <>
      <AppDialog
        open
        onOpenChange={onOpenChange}
        title={editing ? "Edit time" : "Log time"}
        description={dayLabel}
      >
        {/* The task, the project and the client, all typed by people and all
            rendered as text nodes. Which cell this is never depends on
            remembering which one was clicked. */}
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-sm font-medium text-foreground">{row.taskTitle}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.clientName} - {row.projectTitle} - {row.phaseName}
          </p>

          {/* NOT SHOWN WHEN THE FORM IS THAT ENTRY. With exactly one entry
              open for editing, "1h 30m already logged" above a box reading
              1.5 invites somebody to add it a second time.
              It IS shown while ADDING to a day that already has time on it,
              which is the case that would otherwise be a blank form with no
              indication that the day is not empty. */}
          {cell.minutes > 0 && (editing === null || cell.entries.length > 1) && (
            <p className="mt-2 text-sm text-muted-foreground">
              {formatMinutesAsClock(cell.minutes)} logged on this day
              {cell.entries.length > 1 ? `, across ${cell.entries.length} entries` : ""}.
              {editing === null ? " Anything you add here is a further entry." : " Pick one to change it, or add another."}
            </p>
          )}
        </div>

        {/* ------------------------------------------------------------
            THE ENTRIES BEHIND THE CELL, LISTED RATHER THAN SUMMED.
            A cell shows a total, and a total cannot be typed back into a
            form that means to replace one of the figures behind it.

            Shown for SEVERAL entries always, and for a single entry once the
            form has moved off it - otherwise "Add another" on a one-entry day
            left a blank form with the existing entry nowhere on screen and no
            way back to it short of cancelling and reopening.
            ------------------------------------------------------------ */}
        {(cell.entries.length > 1 || (cell.entries.length === 1 && editing === null)) && (
          <ul className="space-y-1">
            {cell.entries.map((entry) => {
              const isOpen = entry.id === editingId;

              return (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => openEntry(entry)}
                    aria-current={isOpen ? "true" : undefined}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      isOpen
                        ? "border-primary/40 bg-primary/10"
                        : "border-border hover:bg-muted",
                    )}
                  >
                    <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                      {formatMinutesAsHours(entry.minutes)}h
                    </span>
                    {/* The note as typed. A text node, and truncated rather
                        than wrapped so the list stays scannable. */}
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                      {entry.notes ?? "No note"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

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
                {editing
                  ? "Change it to what it should be - this replaces the figure, it does not add to it."
                  : "As you would say it: 0.5 is half an hour, 1.5 is an hour and a half."}
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
            {/* Deleting what is open, or clearing the whole day when the
                form is adding. Named for whichever it is - "Clear this day"
                over a form showing one of three entries is a promise about
                the wrong number of rows. */}
            {editing ? (
              <Button
                type="button"
                variant="destructive"
                className="mr-auto"
                disabled={isPending}
                onClick={() => setConfirming("entry")}
              >
                <Trash2 size={16} aria-hidden="true" />
                Delete this entry
              </Button>
            ) : cell.minutes > 0 ? (
              <Button
                type="button"
                variant="destructive"
                className="mr-auto"
                disabled={isPending}
                onClick={() => setConfirming("day")}
              >
                <Trash2 size={16} aria-hidden="true" />
                Clear this day
              </Button>
            ) : null}

            {/* A day legitimately holds several entries - two sittings with
                different notes - so this stays available while one is open. */}
            {editing && (
              <Button type="button" variant="outline" disabled={isPending} onClick={openNewEntry}>
                <Plus size={16} aria-hidden="true" />
                Add another
              </Button>
            )}

            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !canSubmit} loading={isPending}>
              {isPending ? "Saving..." : editing ? "Save changes" : "Log time"}
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
        open={confirming === "entry"}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title="Delete this entry?"
        description={
          editing
            ? `${formatMinutesAsClock(editing.minutes)} on "${row.taskTitle}" for ${dayLabel} will be permanently deleted, along with the note on it. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete entry"
        pendingLabel="Deleting..."
        isPending={isPending}
        onConfirm={() => {
          if (editing) removeEntries([editing], "Time entry removed");
        }}
      />

      <ConfirmDialog
        open={confirming === "day"}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        title="Clear this day?"
        description={`${formatMinutesAsClock(cell.minutes)} on "${row.taskTitle}" for ${dayLabel} will be permanently deleted, along with any note on it. This cannot be undone.`}
        confirmLabel="Clear the day"
        pendingLabel="Clearing..."
        isPending={isPending}
        onConfirm={() =>
          removeEntries(
            cell.entries,
            cell.entries.length === 1 ? "Time entry removed" : "Time entries removed",
          )
        }
      />
    </>
  );
}
