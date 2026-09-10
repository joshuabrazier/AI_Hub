"use client";

import type { DragEvent } from "react";

import { ArrowDown, ArrowUp, EllipsisVertical, Paperclip, Trash2 } from "lucide-react";

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

import { describeTaskEffort, type ProjectMemberDTO, type TaskCardDTO } from "../delivery.types";
import { AssigneeMenuItems } from "./board-assign";

// -------------------------------------------------------------------
// BoardTaskCard
//
// One card. Its title, who has it, its effort as one figure, and a file
// count when there are files - and nothing else, because that is what fits
// on something people scan a hundred of, on one line, without wrapping.
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
  onAssign,
  members,
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
  onAssign: (task: TaskCardDTO, assigneeId: string | null) => void;
  /** The project's members, for the assign submenu. */
  members: readonly ProjectMemberDTO[];
  onMove: MoveTaskHandler;
  onDragStart: (task: TaskCardDTO) => void;
  onDragEnd: () => void;
}) {
  const effort = describeTaskEffort(task.estimateMinutes, task.loggedMinutes);

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

        {/* -----------------------------------------------------------
            ONE LINE, THREE FACTS, AND NO ICONS EXCEPT THE ONE THAT IS
            CONDITIONAL.

            This was four icon-and-label pairs - estimate, logged, assignee,
            files - which is a lot of furniture on something people scan a
            hundred of, and it wrapped to two lines on any card whose title
            was long. Three of those icons appeared on every card in the
            same order, so they identified nothing; position does that job
            for free.

            THE TWO EFFORT FIGURES ARE NOW ONE. See describeTaskEffort: the
            fact worth scanning for is the ratio, not either number, and a
            board where four fifths of the cards say "0m logged" is a board
            spending a third of every row on a constant.

            WHO HAS IT COMES FIRST. It is the field people scan a board by,
            and it was third of four.

            THE PAPERCLIP STAYS AN ICON because it is the one thing here
            that is present or absent rather than always present, so it is
            carrying its own "there are files" meaning as well as a count.
            ----------------------------------------------------------- */}
        <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn("min-w-0 truncate", !task.assigneeName && "italic")}>
            {task.assigneeName ?? "Unassigned"}
          </span>

          <span aria-hidden="true">&middot;</span>

          {/* The compact form is not self-describing, so it is hidden from
              assistive tech and the sentence beside it is what gets read. */}
          <span
            aria-hidden="true"
            className={cn("shrink-0 text-[0.6875rem] figure", effort.isOverBudget && "font-medium text-destructive")}
          >
            {effort.short}
          </span>
          <span className="sr-only">{effort.full}</span>

          {task.attachmentCount > 0 ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1">
              <Paperclip size={13} aria-hidden="true" />
              <span aria-hidden="true">{task.attachmentCount}</span>
              <span className="sr-only">
                {task.attachmentCount === 1 ? "1 file attached" : `${task.attachmentCount} files attached`}
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

                {/* ASSIGNMENT, FROM THE BOARD. It used to live only inside
                    the task panel's edit dialog, behind a button labelled
                    "Edit" sitting beside the Description heading - so the
                    commonest thing anybody wants to do to a card was the
                    hardest to find. A submenu, like "Move to phase", because
                    the list is as long as the project's membership. */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    {task.assigneeName ? `Assigned to ${task.assigneeName}` : "Assign to"}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                    <AssigneeMenuItems
                      members={members}
                      assigneeId={task.assigneeId}
                      onAssign={(assigneeId) => onAssign(task, assigneeId)}
                    />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

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
