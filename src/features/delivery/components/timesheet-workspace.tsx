"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MESSAGES } from "@/lib/constants";
import { formatIsoDate } from "@/lib/format";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { cn } from "@/lib/utils";

import { getTimesheetWeekAction } from "../delivery-time.actions";
import {
  DAYS_IN_WEEK,
  addCalendarDays,
  formatMinutesAsClock,
  type TimesheetRowDTO,
  type TimesheetWeekDTO,
} from "../delivery.types";
import { TimesheetAddRowDialog } from "./timesheet-add-row-dialog";
import {
  findCatalogueProjectForTask,
  findCatalogueTask,
  type TimesheetCatalogueDTO,
} from "./timesheet-catalogue";
import { TimesheetCellDialog } from "./timesheet-cell-dialog";
import { TimesheetEstimateDialog } from "./timesheet-estimate-dialog";
import { TimesheetGrid } from "./timesheet-grid";
import { readAddedRows, writeAddedRows } from "./timesheet-row-store";

// -------------------------------------------------------------------
// ===================================================================
// THE TIMESHEET WEEK
// ===================================================================
//
// The grid, the week's navigation and the three dialogs that write. The
// server renders the week for whatever `?week=` says, and this owns it from
// then on.
//
// WHICH WEEK IS IN THE URL, NOT IN STATE, so a week is linkable, survives a
// refresh and works with the back button - the same split the transcription
// workspace makes for which transcription is open. The server re-reads and
// re-authorises it on every render, so putting it there grants nothing: the
// service normalises a bookmarked, edited or forwarded date, and falls back
// to this week rather than erroring.
//
// THE WEEK ITSELF IS STATE ANYWAY, and this is the reason. A row somebody
// added and has not typed into yet exists only in the BROWSER - there is no
// table for one, and addTimesheetRowService writes nothing - so the server's
// render cannot include them. The ids are handed back to the week read as
// `addedTaskIds`, where every one is re-authorised, and the result replaces
// what the server sent. That is the whole reason getTimesheetWeekAction
// exists beside the page's direct call to the same service.
//
// THE STORE IS REWRITTEN FROM THE ANSWER, not from what was asked for. After
// a read, the rows with no time on them ARE the empty rows, exactly - a row
// with minutes came out of the time entries, and a row the service refused
// (a project somebody was taken off) is simply not there. So the store
// cleans itself up rather than accumulating ids that no longer mean
// anything.
//
// NOTHING HERE RE-READS AFTER A WRITE BY REFRESHING THE PAGE. The service
// already revalidates all six delivery surfaces, and a router.refresh() here
// would rebuild the picker catalogue - a board read per project - for a
// change to one cell. The week is re-read instead, which is the one thing
// that moved. An ESTIMATE change is the exception: it moves the figures the
// catalogue carries, so that one does refresh.
// -------------------------------------------------------------------

export function TimesheetWorkspace({
  week: serverWeek,
  catalogue,
  today,
}: {
  week: TimesheetWeekDTO;
  catalogue: TimesheetCatalogueDTO;
  // Today in the APP timezone, resolved on the server - never `new Date()`
  // in a browser, which is the reader's own zone.
  today: string;
}) {
  const router = useRouter();
  // The area this is mounted under (/admin/timesheet, /manage/..., /portal/...).
  // Read rather than passed, so one component works in all three without a
  // prop that could disagree with where it actually is.
  const pathname = usePathname();

  const [week, setWeek] = useState(serverWeek);
  const [isLoading, startLoading] = useTransition();

  // Which cell is open, by TASK AND DAY INDEX rather than by holding the row
  // object. Re-reading the week replaces every row, and a captured one would
  // leave the dialog showing the figures from before the write.
  const [openCell, setOpenCell] = useState<{ taskId: string; dayIndex: number } | null>(null);
  const [isAddingRow, setIsAddingRow] = useState(false);
  const [estimateTaskId, setEstimateTaskId] = useState<string | null>(null);

  // -------------------------------------------------------------------
  // Re-read the week, with the empty rows the browser is holding.
  //
  // `keepTaskIds` is for a row that has to survive the read that is about to
  // happen: the one just added, and the one whose last entry was just
  // cleared. Without it, clearing a day would take the row off the screen
  // along with the figure - and somebody correcting a typo would have to add
  // the task back before they could retype it.
  // -------------------------------------------------------------------
  const reload = useCallback(
    (base: TimesheetWeekDTO, keepTaskIds: readonly string[] = []) =>
      startLoading(async () => {
        const addedTaskIds = [...new Set([...readAddedRows(base.userId, base.weekStart), ...keepTaskIds])];

        try {
          const response = await getTimesheetWeekAction({
            weekStart: base.weekStart,
            addedTaskIds,
            weekStartsOn: base.weekStartsOn,
          });

          if (!response.success) {
            // -------------------------------------------------------------
            // A SHAPE FAILURE ON THE STORED IDS CLEARS THEM, and nothing
            // else does.
            //
            // Those ids come out of a store this app does not fully control:
            // an older version of this file, another tab, or somebody with
            // the console open. If the schema refuses them, every reload of
            // this week refuses too, and the screen is stuck behind a toast
            // with no way out. They are furniture - dropping them costs an
            // empty row and fixes the page. Any OTHER failure keeps them,
            // because a network blip must not throw away somebody's rows.
            // -------------------------------------------------------------
            // Keyed on the ISSUE PATH, so one bad element in the list is
            // reported as `addedTaskIds.3` rather than `addedTaskIds` - both
            // count.
            const storedRowsRejected = Object.keys(response.fieldErrors ?? {}).some(
              (field) => field === "addedTaskIds" || field.startsWith("addedTaskIds."),
            );

            if (storedRowsRejected) writeAddedRows(base.userId, base.weekStart, []);

            toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);

            return;
          }

          setWeek(response.data);

          // The rows with nothing on them are the empty rows, exactly. See
          // the note at the top of this file.
          writeAddedRows(
            response.data.userId,
            response.data.weekStart,
            response.data.rows.filter((row) => row.totalMinutes === 0).map((row) => row.taskId),
          );
        } catch (error) {
          handleFrontendErrorWithToast(error);
        }
      }),
    [],
  );

  // -------------------------------------------------------------------
  // Put the browser's empty rows back on the week the server rendered.
  //
  // ONCE PER MOUNT, and the mount is per WEEK: the page keys this component
  // on `weekStart`, so navigating to another week remounts it rather than
  // leaving a component to reconcile a prop against state it has since
  // moved on from. That is what keeps this an effect that talks to an
  // external system - the browser's store - rather than one that copies a
  // prop into state on every render.
  //
  // THE READ ONLY HAPPENS IF THERE IS SOMETHING TO ADD. A week nobody has
  // added a row to costs exactly what the server already paid for, and makes
  // no request at all.
  //
  // The ref is what stops it running again when the read it started replaces
  // the week: without it the new state would re-trigger the effect, and the
  // week would re-read itself forever.
  // -------------------------------------------------------------------
  const hasRestoredRows = useRef(false);

  useEffect(() => {
    if (hasRestoredRows.current) return;

    hasRestoredRows.current = true;

    if (readAddedRows(serverWeek.userId, serverWeek.weekStart).length > 0) reload(serverWeek);
  }, [serverWeek, reload]);

  // Seven days on, seven days back, in whole days on the string - never a
  // Date, which is how somebody's Monday moves by one.
  const previousWeekStart = addCalendarDays(week.weekStart, -DAYS_IN_WEEK);
  const nextWeekStart = addCalendarDays(week.weekStart, DAYS_IN_WEEK);

  // Compared as strings, which is exact for 'YYYY-MM-DD'.
  const isThisWeek = today >= week.weekStart && today <= week.weekEnd;

  const openRow: TimesheetRowDTO | null =
    openCell === null ? null : (week.rows.find((row) => row.taskId === openCell.taskId) ?? null);
  const openDay = openRow && openCell ? openRow.days[openCell.dayIndex] : null;

  const estimateTask = estimateTaskId === null ? null : findCatalogueTask(catalogue, estimateTaskId);
  const estimateProject = estimateTaskId === null ? null : findCatalogueProjectForTask(catalogue, estimateTaskId);

  // The server's answer for the project this row is on, and false when the
  // catalogue does not carry it at all. Never re-derived from a role.
  const canEditTasksFor = (taskId: string): boolean =>
    findCatalogueProjectForTask(catalogue, taskId)?.canEditTasks ?? false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* Real links, so a week can be opened in a new tab, shared, or
            reached with the back button. */}
        <nav aria-label="Week" className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href={`${pathname}?week=${previousWeekStart}`}>
              <ChevronLeft size={16} aria-hidden="true" />
              Previous week
            </Link>
          </Button>

          <Button asChild variant="outline">
            <Link href={`${pathname}?week=${nextWeekStart}`}>
              Next week
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </Button>

          {/* NO DATE ON IT. The service resolves "this week" in the app
              timezone, and a browser cannot be trusted to agree about which
              day it is - so the link says nothing and lets the server
              answer. */}
          <Button asChild variant={isThisWeek ? "secondary" : "ghost"}>
            <Link href={pathname} aria-current={isThisWeek ? "page" : undefined}>
              This week
            </Link>
          </Button>
        </nav>

        <Button type="button" className="ml-auto" onClick={() => setIsAddingRow(true)}>
          <Plus size={16} aria-hidden="true" />
          Add a task
        </Button>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>
            {formatIsoDate(week.weekStart)} to {formatIsoDate(week.weekEnd)}
          </CardTitle>
          <CardDescription>
            Every hour on this screen is your own. Click a day on a task to add time to it.
          </CardDescription>

          <CardAction>
            <p className="text-right">
              <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Week total
              </span>
              <span className="block text-2xl font-semibold tabular-nums text-foreground">
                {formatMinutesAsClock(week.totalMinutes)}
              </span>
            </p>
          </CardAction>
        </CardHeader>

        {/* The grid scrolls inside this container - the page body never
            scrolls sideways. `Table` brings the overflow-x with it. */}
        <CardContent className={cn("px-0 transition-opacity", isLoading && "opacity-60")} aria-busy={isLoading}>
          <TimesheetGrid
            week={week}
            today={today}
            onOpenCell={(row, dayIndex) => setOpenCell({ taskId: row.taskId, dayIndex })}
          />
        </CardContent>
      </Card>

      {/* Mounted only while a cell is open, and keyed on the cell, so the
          hours and the note start empty every time rather than inheriting
          what was typed into a different day. */}
      {openRow && openDay && openCell && (
        <TimesheetCellDialog
          key={`${openRow.taskId}|${openDay.date}`}
          row={openRow}
          cell={openDay}
          task={findCatalogueTask(catalogue, openRow.taskId)}
          canAdjustEstimate={canEditTasksFor(openRow.taskId)}
          onOpenChange={(open) => {
            if (!open) setOpenCell(null);
          }}
          onSaved={() => {
            const taskId = openRow.taskId;

            setOpenCell(null);
            // Kept as a row even if that was its last entry, so the figure
            // can be retyped without adding the task back.
            reload(week, [taskId]);
          }}
          onAdjustEstimate={() => {
            const taskId = openRow.taskId;

            setOpenCell(null);
            setEstimateTaskId(taskId);
          }}
        />
      )}

      <TimesheetAddRowDialog
        open={isAddingRow}
        week={week}
        catalogue={catalogue}
        onOpenChange={setIsAddingRow}
        onAdded={(taskId) => reload(week, [taskId])}
      />

      {estimateTask && estimateProject && (
        <TimesheetEstimateDialog
          key={estimateTask.taskId}
          project={estimateProject}
          task={estimateTask}
          onOpenChange={(open) => {
            if (!open) setEstimateTaskId(null);
          }}
          onAdjusted={() => {
            setEstimateTaskId(null);
            // The estimates live on the catalogue, which the server built.
            // This is the one write on the screen that needs the page read
            // again rather than just the week.
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
