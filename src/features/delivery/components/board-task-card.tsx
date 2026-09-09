"use client";

import type { DragEvent } from "react";

import { ArrowDown, ArrowUp, Clock, EllipsisVertical, Paperclip, Timer, Trash2, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TASK_COLUMN_LABELS,
  TASK_COLUMN_ORDER,
  type TaskColumn,
} from "@/lib/data/kysely-database-types";
import { cn } from "@/lib/utils";

import { formatMinutesAsClock, type TaskCardDTO } from "../delivery.types";

// -------------------------------------------------------------------
// BoardTaskCard
//
// One card. Title, the estimate it was given, the time logged against it,
// who has it and how many files are on it - and nothing else, because that
// is what fits on something people scan a hundred of.
//
// TWO WAYS TO MOVE IT, AND THE KEYBOARD ONE IS NOT THE FALLBACK. The menu
// is the real interface: every destination this board has is in it, as
// ordinary menu items, so a card can be moved with the keyboard alone,
// read out by a screen reader, and used on a phone. Dragging is layered on
// top for a mouse and is allowed to be the thing that breaks - a board that
// only works with a pointer is a defect rather than a simplification.
//
// THE MENU BUTTON IS ALWAYS VISIBLE, deliberately unlike the per-row
// actions on the transcription list. There a hidden-until-hover control is
// a shortcut for something the row already does; here it is the ONLY way to
// move a card without a mouse, and hiding the keyboard route behind hover
// is how it stops being one.
//
// WHAT DECIDES WHAT IS OFFERED is `canEditTasks` off the board DTO,
// computed on the server as "lead OR admin", passed down unchanged.
// Nothing here re-derives it from a role, and the service re-checks every
// write regardless - the menu is a convenience, not the gate.
// -------------------------------------------------------------------

export type BoardPhaseOption = {
  phaseId: string;
  phaseName: string;
};

// -------------------------------------------------------------------
// Where a card is being put: which phase, which column, which slot.
//
// THE ID RATHER THAN THE CARD, because a drop knows only what the drag
// payload carried - the card itself may be in another column's list, and a
// component that needed the whole DTO would have to invent one to hand
// over. The workspace holds the board and resolves it.
// -------------------------------------------------------------------
export type MoveTaskHandler = (
  taskId: string,
  destination: { phaseId: string; boardColumn: TaskColumn; position: number },
) => void;

export function BoardTaskCard({
  task,
  boardColumn,
  index,
  columnLength,
  phases,
  canEditTasks,
  canLogTime,
  isPending,
  isDragging,
  endPositionFor,
  onOpen,
  onLogTime,
  onDelete,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  task: TaskCardDTO;
  boardColumn: TaskColumn;
  /** Its slot in this column, which is what "move up" and "move down" mean. */
  index: number;
  columnLength: number;
  /** Every phase on this board, so a card can leave the one it is in. */
  phases: readonly BoardPhaseOption[];
  /**
   * The slot AFTER the last card of any column on this board. The menu
   * appends rather than inserting, and `position` is bounded by the schema -
   * so "the end" has to be a real index the workspace can count, not a
   * large number that would fail validation on the way out.
   */
  endPositionFor: (phaseId: string, boardColumn: TaskColumn) => number;
  canEditTasks: boolean;
  canLogTime: boolean;
  isPending: boolean;
  isDragging: boolean;
  onOpen: (task: TaskCardDTO) => void;
  onLogTime: (task: TaskCardDTO) => void;
  onDelete: (task: TaskCardDTO) => void;
  onMove: MoveTaskHandler;
  onDragStart: (task: TaskCardDTO) => void;
  onDragEnd: () => void;
}) {
  const otherColumns = TASK_COLUMN_ORDER.filter((column) => column !== boardColumn);
  const otherPhases = phases.filter((phase) => phase.phaseId !== task.phaseId);

  const startDrag = (event: DragEvent<HTMLDivElement>) => {
    // The id travels in the drag payload as well as in component state, so a
    // drop that somehow arrives without the state (a drag begun before a
    // re-render) still knows which card it is carrying.
    event.dataTransfer.setData("text/plain", task.id);
    event.dataTransfer.effectAllowed = "move";
    onDragStart(task);
  };

  return (
    <div
      draggable={canEditTasks && !isPending}
      onDragStart={canEditTasks ? startDrag : undefined}
      onDragEnd={canEditTasks ? onDragEnd : undefined}
      className={cn(
        "group/card relative rounded-lg border border-border bg-background p-3 shadow-xs transition-opacity",
        canEditTasks && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50",
        isPending && "opacity-60",
      )}
    >
      {/* The card face opens the task. A button rather than a link, because
          the panel is part of this screen rather than a route of its own. */}
      <button
        type="button"
        onClick={() => onOpen(task)}
        className="block w-full rounded pr-7 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {/* Typed by a person, so it renders as a text node and nothing else. */}
        <span className="block text-sm font-medium text-foreground">{task.title}</span>

        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Timer size={13} aria-hidden="true" />
            {task.estimateMinutes > 0 ? `${formatMinutesAsClock(task.estimateMinutes)} estimated` : "No estimate"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock size={13} aria-hidden="true" />
            {formatMinutesAsClock(task.loggedMinutes)} logged
          </span>
          <span className="inline-flex items-center gap-1">
            <UserRound size={13} aria-hidden="true" />
            {task.assigneeName ?? "Unassigned"}
          </span>
          {task.attachmentCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Paperclip size={13} aria-hidden="true" />
              {task.attachmentCount}
              <span className="sr-only">
                {task.attachmentCount === 1 ? " attachment" : " attachments"}
              </span>
            </span>
          ) : null}
        </span>
      </button>

      <span className="absolute right-1 top-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-7 px-0 text-muted-foreground"
              aria-label={`Actions for ${task.title}`}
              disabled={isPending}
            >
              <EllipsisVertical size={14} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate">{task.title}</DropdownMenuLabel>

            <DropdownMenuItem onSelect={() => onOpen(task)}>Open</DropdownMenuItem>

            {canLogTime ? (
              <DropdownMenuItem onSelect={() => onLogTime(task)}>Log time</DropdownMenuItem>
            ) : null}

            {canEditTasks ? (
              <>
                <DropdownMenuSeparator />

                {/* The keyboard route across the board. Same three writes the
                    drag makes, in the same one mutation. */}
                {otherColumns.map((column) => (
                  <DropdownMenuItem
                    key={column}
                    onSelect={() =>
                      // Appended to the destination. A person choosing a
                      // column from a menu is saying which column, not which
                      // slot.
                      onMove(task.id, {
                        phaseId: task.phaseId,
                        boardColumn: column,
                        position: endPositionFor(task.phaseId, column),
                      })
                    }
                  >
                    Move to {TASK_COLUMN_LABELS[column]}
                  </DropdownMenuItem>
                ))}

                {otherPhases.length > 0 ? (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Move to phase</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                      {otherPhases.map((phase) => (
                        <DropdownMenuItem
                          key={phase.phaseId}
                          onSelect={() =>
                            // The column is kept: moving a blocked card to the
                            // next phase should leave it blocked, not quietly
                            // reopen it.
                            onMove(task.id, {
                              phaseId: phase.phaseId,
                              boardColumn,
                              position: endPositionFor(phase.phaseId, boardColumn),
                            })
                          }
                        >
                          {phase.phaseName}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : null}

                <DropdownMenuItem
                  disabled={index === 0}
                  onSelect={() => onMove(task.id, { phaseId: task.phaseId, boardColumn, position: index - 1 })}
                >
                  <ArrowUp aria-hidden="true" />
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={index >= columnLength - 1}
                  onSelect={() => onMove(task.id, { phaseId: task.phaseId, boardColumn, position: index + 1 })}
                >
                  <ArrowDown aria-hidden="true" />
                  Move down
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Allowed to be refused in words: a task with time logged
                    against it stays, and the service says so. */}
                <DropdownMenuItem variant="destructive" onSelect={() => onDelete(task)}>
                  <Trash2 aria-hidden="true" />
                  Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </div>
  );
}
