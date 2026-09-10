"use client";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatIsoDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  WEEK_DAY_NUMBERS,
  formatMinutesAsHours,
  weekDayOf,
  type TimesheetCellDTO,
  type TimesheetRowDTO,
  type TimesheetWeekDTO,
} from "../delivery.types";
import { OPEN_DAY_KEY_HINT, TimesheetDayCell, type DayCellCommit } from "./timesheet-day-cell";

// -------------------------------------------------------------------
// ===================================================================
// THE GRID: DAYS ACROSS, TASKS DOWN
// ===================================================================
//
// One row per task and seven columns, so somebody working on three tasks in
// a week fills in three rows rather than twenty-one cells. The rows are the
// week's own, in the order the service returned them (client, project,
// phase, board position) - nothing is re-sorted here, so a timesheet and a
// task list can never disagree about what comes first.
//
// EVERY FIGURE IS FORMATTED, NEVER COMPUTED. The minutes are the truth, the
// day totals and the week total were summed server-side, and this file
// divides nothing by sixty: `formatMinutesAsHours` is the one place that
// decides how many decimals an hours figure shows. Summing the displayed
// strings, or rounding a second time here, is how a footer stops matching
// the column above it.
//
// DECIMAL HOURS RATHER THAN "1h 30m", THROUGHOUT THE TABLE. It is the form
// somebody types into a cell, so a cell showing "1h 30m" cannot be corrected
// by typing over it - and one column of digits in two different notations
// cannot be scanned. `tabular-nums` is what makes them line up; the clock
// form is used in the heading above the grid, where it is read once.
//
// AND A CELL IS NOW LITERALLY TYPED OVER, which is what that reasoning was
// for. Each day is an input rather than a button that opened a dialog -
// fifteen dialogs to enter fifteen numbers was the cost of a normal week.
// TimesheetDayCell holds the whole of that: what a typed figure writes, why
// a day with several entries is not corrected in place, and why emptying a
// cell opens the day instead of deleting anything.
//
// THE TABLE SCROLLS INSIDE ITSELF. `Table` already wraps its markup in a
// container with `overflow-x-auto`, and the minimum width below is what
// makes it use one: the page body never scrolls sideways.
//
// EVERY PIECE OF TEXT IN A ROW WAS TYPED BY SOMEBODY - a client name, a
// project title, a task title - so all of it renders as a text node.
// -------------------------------------------------------------------

// Day names come from the date itself rather than from an array indexed by
// position, so a week that starts on Sunday needs no second copy of
// anything. `formatIsoDate` is the app's one way of rendering a
// 'YYYY-MM-DD', and nothing here constructs a Date.
const DAY_NAME_FORMAT = "EEE";
const DAY_DATE_FORMAT = "d MMM";

function isWeekend(date: string): boolean {
  const day = weekDayOf(date);

  return day === WEEK_DAY_NUMBERS.SATURDAY || day === WEEK_DAY_NUMBERS.SUNDAY;
}

export function TimesheetGrid({
  week,
  today,
  onOpenCell,
  onCommitCell,
}: {
  week: TimesheetWeekDTO;
  // Today in the APP timezone, resolved on the server. Not derived here:
  // `new Date()` in a browser is the reader's own zone, so somebody
  // travelling would see the highlight on the wrong column.
  today: string;
  onOpenCell: (row: TimesheetRowDTO, dayIndex: number) => void;
  /** A figure typed straight into a cell. The cell decided which write it is. */
  onCommitCell: (row: TimesheetRowDTO, cell: TimesheetCellDTO, commit: DayCellCommit) => void;
}) {
  return (
    <Table className="min-w-[56rem]">
      {/* STILL sr-only, and the how-to-use-it line is deliberately NOT in
          here. A caption lives inside the table, and the table is 56rem wide
          inside a container that scrolls sideways - so an instruction put
          here would be cut off on the screens most likely to need it, and
          have to be scrolled to. It is in the card's description instead,
          which sits outside the scroller. */}
      <TableCaption className="sr-only">
        Hours logged against each task, {formatIsoDate(week.weekStart)} to {formatIsoDate(week.weekEnd)}. Type
        the hours into a day, or press {OPEN_DAY_KEY_HINT} on one to open it.
      </TableCaption>

      <TableHeader>
        <TableRow>
          <TableHead scope="col" className="min-w-[18rem]">Task</TableHead>

          {week.dates.map((date) => (
            <TableHead
              key={date}
              scope="col"
              // `aria-current="date"` rather than a colour alone, so today is
              // announced as well as tinted.
              aria-current={date === today ? "date" : undefined}
              className={cn("w-[6rem] text-right", date === today && "text-primary")}
            >
              <span className={cn("block", isWeekend(date) && "text-muted-foreground")}>
                {formatIsoDate(date, DAY_NAME_FORMAT)}
              </span>
              {/* The date is a figure and sits directly above a column of
                  them, so it takes the same face. The day NAME stays in the
                  sans, because it is a word. */}
              <span className="block font-mono text-[0.6875rem] font-normal text-muted-foreground">
                {formatIsoDate(date, DAY_DATE_FORMAT)}
              </span>
            </TableHead>
          ))}

          <TableHead scope="col" className="w-24 text-right">Total</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {week.rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={week.dates.length + 2} className="py-10 text-center whitespace-normal">
              <p className="text-sm font-medium text-foreground">Nothing on this week yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a task to the week, then type the hours you worked on it into each day.
              </p>
            </TableCell>
          </TableRow>
        ) : (
          week.rows.map((row) => (
            <TableRow key={row.taskId}>
              <TableCell className="whitespace-normal">
                <span className="block font-medium text-foreground">{row.taskTitle}</span>
                <span className="block text-xs text-muted-foreground">
                  {row.clientName} - {row.projectTitle} - {row.phaseName}
                </span>
              </TableCell>

              {row.days.map((cell, dayIndex) => (
                <TableCell key={cell.date} className="p-1 text-right">
                  {/* Typed into directly. See TimesheetDayCell for what a
                      figure entered here actually writes, and why emptying
                      one opens the day rather than deleting anything. */}
                  <TimesheetDayCell
                    row={row}
                    cell={cell}
                    isToday={cell.date === today}
                    onCommit={(commit) => onCommitCell(row, cell, commit)}
                    onOpenDay={() => onOpenCell(row, dayIndex)}
                  />
                </TableCell>
              ))}

              <TableCell className="pr-3 text-right font-mono font-medium tabular-nums">
                {formatMinutesAsHours(row.totalMinutes)}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>

      <TableFooter>
        <TableRow>
          <TableCell>Day total</TableCell>

          {week.dayTotalMinutes.map((minutes, dayIndex) => (
            <TableCell key={week.dates[dayIndex]} className="pr-3 text-right font-mono tabular-nums">
              {minutes === 0 ? (
                <span className="font-normal text-muted-foreground">-</span>
              ) : (
                formatMinutesAsHours(minutes)
              )}
            </TableCell>
          ))}

          <TableCell className="pr-3 text-right font-mono font-medium tabular-nums">{formatMinutesAsHours(week.totalMinutes)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
