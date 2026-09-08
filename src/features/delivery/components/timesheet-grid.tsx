"use client";

import { Button } from "@/components/ui/button";
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
  type TimesheetRowDTO,
  type TimesheetWeekDTO,
} from "../delivery.types";

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
}: {
  week: TimesheetWeekDTO;
  // Today in the APP timezone, resolved on the server. Not derived here:
  // `new Date()` in a browser is the reader's own zone, so somebody
  // travelling would see the highlight on the wrong column.
  today: string;
  onOpenCell: (row: TimesheetRowDTO, dayIndex: number) => void;
}) {
  return (
    <Table className="min-w-[52rem]">
      <TableCaption className="sr-only">
        Hours logged against each task, {formatIsoDate(week.weekStart)} to {formatIsoDate(week.weekEnd)}.
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
              className={cn("w-[5.5rem] text-right", date === today && "text-primary")}
            >
              <span className={cn("block", isWeekend(date) && "text-muted-foreground")}>
                {formatIsoDate(date, DAY_NAME_FORMAT)}
              </span>
              <span className="block text-xs font-normal text-muted-foreground">
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
                Add a task to the week, then click a day to enter the hours you worked on it.
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
                  {/* Keyboard reachable and focus-visible by default: it is a
                      real button rather than a cell with a click handler on
                      it, so tabbing across a row works the way somebody
                      filling in a timesheet expects. */}
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn(
                      "h-9 w-full justify-end tabular-nums",
                      cell.minutes === 0 && "text-muted-foreground font-normal",
                      cell.date === today && "bg-primary/5",
                    )}
                    aria-label={
                      cell.minutes === 0
                        ? `Add time to ${row.taskTitle} on ${formatIsoDate(cell.date, "EEEE d MMMM")}`
                        : `${formatMinutesAsHours(cell.minutes)} hours on ${row.taskTitle}, ${formatIsoDate(cell.date, "EEEE d MMMM")}`
                    }
                    onClick={() => onOpenCell(row, dayIndex)}
                  >
                    {/* A quiet dash for an empty day. The button is still
                        there, so the day is still one press away. */}
                    {cell.minutes === 0 ? "-" : formatMinutesAsHours(cell.minutes)}
                  </Button>
                </TableCell>
              ))}

              <TableCell className="pr-3 text-right font-medium tabular-nums">
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
            <TableCell key={week.dates[dayIndex]} className="pr-3 text-right tabular-nums">
              {minutes === 0 ? (
                <span className="font-normal text-muted-foreground">-</span>
              ) : (
                formatMinutesAsHours(minutes)
              )}
            </TableCell>
          ))}

          <TableCell className="pr-3 text-right tabular-nums">{formatMinutesAsHours(week.totalMinutes)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
