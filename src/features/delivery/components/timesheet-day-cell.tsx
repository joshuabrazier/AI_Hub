"use client";

import { useState, type KeyboardEvent } from "react";

import { MessageSquareText, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { formatIsoDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import { formatMinutesAsHours, type TimesheetCellDTO, type TimesheetRowDTO } from "../delivery.types";

// -------------------------------------------------------------------
// ===================================================================
// ONE DAY OF ONE TASK, TYPED INTO DIRECTLY
// ===================================================================
//
// A CELL USED TO BE A BUTTON THAT OPENED A DIALOG, and that is the single
// biggest cost on this screen. A normal week is three or four tasks across
// five days, so filling one in meant opening, focusing, typing, saving and
// closing a dialog fifteen or twenty times to enter fifteen or twenty
// numbers - and the dialog's own hours box is the only part of it most of
// those visits used. The note is optional and usually empty, the estimate
// has other entrances, and clearing a day is rare.
//
// So the cell is an input. Type, Tab, type, Tab: a week is filled in the way
// a week is filled in everywhere else, and the dialog is still there for the
// three things it is the only route to.
//
// -------------------------------------------------------------------
// WHAT TYPING A NUMBER ACTUALLY DOES, AND WHY IT IS TWO DIFFERENT WRITES.
//
// An empty day gets a new entry. A day holding ONE entry has that entry
// corrected, through the PATCH shape of UpdateTimeEntrySchema - `hours`
// alone, no `notes` - which is what makes this safe at all: an absent note
// leaves the stored one alone. That was written down as the reason a cell
// could not be edited in place (see the header of timesheet-cell-dialog),
// and the patch is the answer to it. A time entry note is what a client's
// invoice narrative comes from, and correcting an hour must never take one.
//
// A DAY HOLDING SEVERAL ENTRIES IS NOT CORRECTED HERE. There is no "the"
// entry to change - an hour logged in the morning and another after lunch
// are both real, with their own notes - so the day opens instead, where they
// are listed. Guessing at one would silently rewrite whichever the query
// happened to return first.
//
// EMPTYING A CELL DOES NOT DELETE ANYTHING EITHER, and that is the one place
// this deliberately refuses to be a spreadsheet. Removing time is confirmed
// and names the note that goes with it, everywhere else in this module; a
// figure vanishing because somebody tabbed through a cell with a key held
// down is not something a timesheet should do quietly. The day opens, and
// the Clear button there says what will be lost.
//
// So the rule is one sentence: TYPING A FIGURE RECORDS IT, and anything else
// opens the day.
//
// -------------------------------------------------------------------
// TWO WAYS TO OPEN THE DAY, AND ONE OF THEM IS NOT A TAB STOP.
//
// The button in the corner is deliberately `tabIndex={-1}`. Tabbing across a
// row is THE gesture on this screen, and a second stop in every cell doubles
// the presses it takes to fill in a week - seven numbers would be fourteen
// stops, thirteen of which are the wrong one. Shift+Enter opens the day from
// the keyboard instead, and the caption under the grid says so, so the
// keyboard route is documented rather than merely present.
//
// A CELL CARRYING A NOTE SHOWS ITS BUTTON PERMANENTLY, with a different
// icon. A note is invisible in a grid of figures, and something written
// against an hour that nothing on screen hints at is something nobody will
// find again. Same for a day holding more than one entry, because that cell
// cannot be corrected in place and needs to say where to go.
// -------------------------------------------------------------------

/** Named once, because the caption under the grid has to say the same thing. */
export const OPEN_DAY_KEY_HINT = "Shift and Enter";

/**
 * What the cell decided a typed figure means. The CELL decides, because it is
 * the thing holding the entries; the workspace performs it, because it owns
 * the re-read that follows.
 */
export type DayCellCommit =
  | { kind: "log"; hours: number }
  | { kind: "correct"; timeEntryId: string; hours: number };

export function TimesheetDayCell({
  row,
  cell,
  isToday,
  onCommit,
  onOpenDay,
}: {
  row: TimesheetRowDTO;
  cell: TimesheetCellDTO;
  isToday: boolean;
  onCommit: (commit: DayCellCommit) => void;
  onOpenDay: () => void;
}) {
  // The figure the server holds, in the form somebody types - which is the
  // reason this grid shows decimal hours rather than "1h 30m" throughout.
  const serverValue = cell.minutes === 0 ? "" : formatMinutesAsHours(cell.minutes);

  const [value, setValue] = useState(serverValue);

  // -------------------------------------------------------------------
  // FOLLOWING THE SERVER WITHOUT LOSING THE CURSOR.
  //
  // Every write here re-reads the week, so a moment after a commit this
  // cell is handed a new figure and has to show it. The obvious ways both
  // fail: an effect that copies a prop into state is what
  // react-hooks/set-state-in-effect exists to catch, and a `key` on the
  // server figure remounts the input - which drops focus, and focus is
  // exactly what somebody pressing Enter on their own figure still needs.
  //
  // Adjusting state during render is React's own answer to "reset state
  // when a prop changes". It re-renders immediately, before anything is
  // painted, and it keeps the DOM node - so the cursor stays put.
  //
  // It compares against the LAST SERVER VALUE rather than against `value`,
  // so a figure somebody is halfway through typing is never overwritten by
  // a re-read triggered by a different cell.
  // -------------------------------------------------------------------
  const [lastServerValue, setLastServerValue] = useState(serverValue);

  if (serverValue !== lastServerValue) {
    setLastServerValue(serverValue);
    setValue(serverValue);
  }

  const hasNote = cell.entries.some((entry) => entry.notes !== null);
  const isSplit = cell.entries.length > 1;

  const dayLabel = formatIsoDate(cell.date, "EEEE d MMMM");

  const revert = () => setValue(serverValue);

  const openDay = () => {
    revert();
    onOpenDay();
  };

  const commit = () => {
    const typed = value.trim();

    // Untouched, or typed back to what it already was. Nothing to send, and
    // nothing to report - a blur is not an act.
    if (typed === serverValue) return;

    const hours = Number(typed);

    // Taking time off is a delete, and a delete is confirmed elsewhere in
    // this module and named. The day says what would go.
    if (typed === "" || hours === 0) {
      openDay();
      return;
    }

    if (!Number.isFinite(hours) || hours < 0) {
      revert();
      toast.error("Hours as a number, the way you would say them - 0.5, 1.5, 8.");
      return;
    }

    // Several entries behind one total: there is nothing here to correct.
    if (isSplit) {
      openDay();
      return;
    }

    const single = cell.entries[0];

    onCommit(single ? { kind: "correct", timeEntryId: single.id, hours } : { kind: "log", hours });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();

      // The documented keyboard route to everything the cell cannot do.
      if (event.shiftKey) {
        onOpenDay();
        return;
      }

      commit();
      return;
    }

    // Escape abandons what was typed rather than committing it, which is
    // what Escape means everywhere else in this app.
    if (event.key === "Escape") {
      event.preventDefault();
      revert();
    }
  };

  return (
    <div className="group/cell relative">
      <input
        type="text"
        inputMode="decimal"
        // Deliberately NOT type="number". In a cell this narrow it draws
        // spinners over the figure, and its scroll-wheel behaviour changes
        // a value by rolling past it - on a screen that is a column of
        // figures somebody scrolls through, that is data entry by accident.
        value={value}
        placeholder="-"
        aria-label={`Hours on ${row.taskTitle}, ${dayLabel}`}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        // A cell commits when it is left, so Tab is the whole gesture and
        // nothing has to be pressed to save.
        onBlur={commit}
        className={cn(
          // No drawn border until it is touched: seven boxed fields per row
          // across five rows is a grid of controls rather than a column of
          // figures, and the figures are what this screen is for.
          "h-9 w-full rounded-md border border-transparent bg-transparent py-1 pr-6 pl-1.5 text-right text-sm figure outline-none transition-colors",
          "hover:border-border focus:border-primary focus:bg-background focus-visible:ring-3 focus-visible:ring-ring/50",
          "placeholder:text-muted-foreground",
          cell.minutes === 0 && "text-muted-foreground",
          isToday && "bg-primary/5",
        )}
      />

      <button
        type="button"
        // NOT IN THE TAB ORDER, on purpose - see the header. Shift+Enter is
        // the keyboard route and the caption under the grid names it.
        tabIndex={-1}
        aria-hidden="true"
        title={`Open ${dayLabel} on this task`}
        onClick={onOpenDay}
        className={cn(
          "absolute top-1/2 right-0.5 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-opacity hover:text-foreground",
          // Permanently visible when the cell is hiding something: a note
          // nothing hints at is a note nobody finds, and a split day cannot
          // be corrected in place.
          hasNote || isSplit
            ? "opacity-100"
            : "opacity-0 group-focus-within/cell:opacity-100 group-hover/cell:opacity-100",
        )}
      >
        {hasNote ? <MessageSquareText size={12} /> : <MoreHorizontal size={12} />}
      </button>

      {/* The button is hidden from assistive tech because it is not
          reachable by keyboard. What it would have announced is said here
          instead, so a screen reader still learns that the cell holds a
          note or more than one entry - which is the part that matters. */}
      {hasNote || isSplit ? (
        <span className="sr-only">
          {hasNote ? "Has a note. " : ""}
          {isSplit ? `${cell.entries.length} separate entries. ` : ""}
          Press {OPEN_DAY_KEY_HINT} to open this day.
        </span>
      ) : null}
    </div>
  );
}
