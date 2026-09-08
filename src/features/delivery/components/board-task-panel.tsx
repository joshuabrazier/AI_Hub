"use client";

import { Clock, Paperclip, Timer, Trash2, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  TASK_COLUMNS,
  TASK_COLUMN_LABELS,
  TASK_COLUMN_ORDER,
  type TaskColumn,
} from "@/lib/data/kysely-database-types";
import { cn } from "@/lib/utils";

import { budgetProgress, formatMinutesAsClock, type TaskCardDTO } from "../delivery.types";
import type { MoveTaskHandler } from "./board-task-card";

// -------------------------------------------------------------------
// BoardTaskPanel
//
// One card, opened. What it is, how much of its estimate is spent, who has
// it, and the two things anybody does from here: log an hour against it and
// move it.
//
// IT RENDERS THE CARD THE BOARD ALREADY SENT, and does not fetch. The board
// is one read for the whole screen, and re-reading per card opened would
// turn the screen people leave open all day into a request per click.
//
// -------------------------------------------------------------------
// WHAT IS NOT ON THIS PANEL, AND WHY IT IS NOT A DECISION MADE HERE
//
// A task's DESCRIPTION, its FILES, its TIME ENTRIES and its ESTIMATE
// HISTORY are all missing, and all four are the same gap.
// getTaskDetailService returns every one of them - but it answers a scope
// miss with notFound(), and delivery-board.actions.ts sets out at length
// why it cannot be exposed to a client component as it stands: notFound()
// thrown inside a server action propagates through unstable_rethrow and
// replaces this board with the not-found page, so a card somebody else
// deleted a second ago would read as a broken app. That file says the work
// belongs in the SERVICE - a write-shaped refusal, the same "no longer
// available" sentence the mutations use - and reports it rather than doing
// it.
//
// So this panel shows what the board read carries and nothing invented.
// The same gap is why there is no EDIT here: UpdateTaskSchema requires the
// description, TaskCardDTO deliberately does not carry one (a hundred cards
// would be a megabyte), and a form built from a card would post an empty
// box over whatever was written - silently deleting it. A missing button is
// a gap; a button that erases somebody's scope note is a defect.
// -------------------------------------------------------------------
export function BoardTaskPanel({
  task,
  boardColumn,
  phaseName,
  canEditTasks,
  canLogTime,
  isPending,
  endPositionFor,
  onOpenChange,
  onLogTime,
  onDelete,
  onMove,
}: {
  task: TaskCardDTO;
  boardColumn: TaskColumn;
  phaseName: string;
  canEditTasks: boolean;
  canLogTime: boolean;
  isPending: boolean;
  endPositionFor: (phaseId: string, boardColumn: TaskColumn) => number;
  onOpenChange: (open: boolean) => void;
  onLogTime: (task: TaskCardDTO) => void;
  onDelete: (task: TaskCardDTO) => void;
  onMove: MoveTaskHandler;
}) {
  // Estimate against logged, computed by the same function the project
  // header and the budget report use, so no two bars can round differently.
  const rollup = budgetProgress(task.estimateMinutes, task.loggedMinutes);

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-6 sm:max-w-md">
        <SheetHeader className="p-0">
          {/* Typed by a person. A text node, like everything else here. */}
          <SheetTitle className="pr-8 text-left text-lg">{task.title}</SheetTitle>
          <SheetDescription className="text-left">
            {phaseName} - {TASK_COLUMN_LABELS[boardColumn]}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <section aria-labelledby="task-panel-effort">
            <h3 id="task-panel-effort" className="text-sm font-semibold text-foreground">
              Effort
            </h3>

            {/* The figures are the accessible version; the bar is decoration
                over them, which is why it is hidden from assistive tech. */}
            <p className="mt-1 text-sm text-muted-foreground">
              {task.estimateMinutes > 0
                ? `${formatMinutesAsClock(task.loggedMinutes)} logged of ${formatMinutesAsClock(task.estimateMinutes)} estimated`
                : `${formatMinutesAsClock(task.loggedMinutes)} logged, no estimate set`}
              {rollup.isOverBudget ? ` - ${formatMinutesAsClock(rollup.overMinutes)} over` : ""}
            </p>

            {rollup.percentUsed !== null ? (
              <div aria-hidden="true" className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", rollup.isOverBudget ? "bg-destructive" : "bg-primary")}
                  style={{ width: `${rollup.barPercent}%` }}
                />
              </div>
            ) : null}

            <dl className="mt-4 grid gap-2 text-sm">
              <div className="flex items-center gap-2">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <Timer size={14} aria-hidden="true" />
                  Estimate
                </dt>
                <dd className="text-foreground">
                  {task.estimateMinutes > 0 ? formatMinutesAsClock(task.estimateMinutes) : "None set"}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock size={14} aria-hidden="true" />
                  Logged
                </dt>
                <dd className="text-foreground">{formatMinutesAsClock(task.loggedMinutes)}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <UserRound size={14} aria-hidden="true" />
                  Assignee
                </dt>
                <dd className="text-foreground">{task.assigneeName ?? "Unassigned"}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <Paperclip size={14} aria-hidden="true" />
                  Files
                </dt>
                <dd className="text-foreground">
                  {task.attachmentCount === 0
                    ? "None"
                    : task.attachmentCount === 1
                      ? "1 file"
                      : `${task.attachmentCount} files`}
                </dd>
              </div>
            </dl>
          </section>

          {canLogTime ? (
            <section aria-labelledby="task-panel-time">
              <h3 id="task-panel-time" className="text-sm font-semibold text-foreground">
                Your time
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Time is always your own here. There is no way to log an hour for somebody else.
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => onLogTime(task)}>
                <Clock size={14} aria-hidden="true" />
                Log time
              </Button>
            </section>
          ) : null}

          {canEditTasks ? (
            <section aria-labelledby="task-panel-move">
              <h3 id="task-panel-move" className="text-sm font-semibold text-foreground">
                Move
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Moving it from here appends it to the column. Drag a card, or use its menu, to choose a slot.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {TASK_COLUMN_ORDER.map((column) => {
                  const isCurrent = column === boardColumn;

                  return (
                    <Button
                      key={column}
                      type="button"
                      variant={isCurrent ? "secondary" : "outline"}
                      size="sm"
                      aria-current={isCurrent ? "true" : undefined}
                      disabled={isCurrent || isPending}
                      onClick={() =>
                        onMove(task.id, {
                          phaseId: task.phaseId,
                          boardColumn: column,
                          position: endPositionFor(task.phaseId, column),
                        })
                      }
                    >
                      {TASK_COLUMN_LABELS[column]}
                    </Button>
                  );
                })}
              </div>

              <Badge variant="outline" className="mt-3">
                In {TASK_COLUMN_LABELS[boardColumn]}
              </Badge>
            </section>
          ) : null}

          {canEditTasks ? (
            <section aria-labelledby="task-panel-remove">
              <h3 id="task-panel-remove" className="text-sm font-semibold text-foreground">
                Remove
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                A task with time logged against it cannot be deleted - move it to{" "}
                {TASK_COLUMN_LABELS[TASK_COLUMNS.DONE]} instead.
              </p>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="mt-3"
                disabled={isPending}
                onClick={() => onDelete(task)}
              >
                <Trash2 size={14} aria-hidden="true" />
                Delete task
              </Button>
            </section>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
