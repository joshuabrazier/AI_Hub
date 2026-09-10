"use client";

import { useState, type DragEvent } from "react";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TASK_COLUMN_LABELS, type TaskColumn } from "@/lib/data/kysely-database-types";
import { cn } from "@/lib/utils";

import type { TaskCardDTO } from "../delivery.types";
import { BoardTaskCard, type BoardPhaseOption, type MoveTaskHandler } from "./board-task-card";

// -------------------------------------------------------------------
// BoardColumn
//
// One of the four columns of one phase's board. The four are fixed and
// always rendered, even when empty, because an empty column is a drop
// target: leave it out and there is nowhere to put the first card that ever
// gets blocked.
//
// DRAGGING IS THE SECONDARY INTERFACE. Every drop this column accepts is
// also a menu item on the card - see BoardTaskCard - so nothing here is the
// only way to do anything. A drop on the column APPENDS; a drop on a card
// inserts at that card's slot, which is the only reason the cards carry
// their own handlers.
// -------------------------------------------------------------------
export function BoardColumn({
  phaseId,
  boardColumn,
  headingId,
  tasks,
  phases,
  canEditTasks,
  canLogTime,
  pendingTaskId,
  draggingTaskId,
  endPositionFor,
  onOpen,
  onLogTime,
  onDelete,
  onMove,
  onAddTask,
  onDragStart,
  onDragEnd,
}: {
  phaseId: string;
  boardColumn: TaskColumn;
  headingId: string;
  tasks: readonly TaskCardDTO[];
  phases: readonly BoardPhaseOption[];
  canEditTasks: boolean;
  canLogTime: boolean;
  pendingTaskId: string | null;
  draggingTaskId: string | null;
  endPositionFor: (phaseId: string, boardColumn: TaskColumn) => number;
  onOpen: (task: TaskCardDTO) => void;
  onLogTime: (task: TaskCardDTO) => void;
  onDelete: (task: TaskCardDTO) => void;
  onMove: MoveTaskHandler;
  onAddTask: (phaseId: string, boardColumn: TaskColumn) => void;
  onDragStart: (task: TaskCardDTO) => void;
  onDragEnd: () => void;
}) {
  const [isOver, setIsOver] = useState(false);

  // A drop is only meaningful while a card is in the air and the reader may
  // move it. Everything below hangs off this rather than testing both again.
  const accepts = canEditTasks && draggingTaskId !== null;

  const allowDrop = (event: DragEvent) => {
    if (!accepts) return;

    // Without preventDefault the browser refuses the drop, silently.
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setIsOver(true);
  };

  const dropAt = (event: DragEvent, position: number) => {
    if (!accepts) return;

    event.preventDefault();
    event.stopPropagation();
    setIsOver(false);

    // The card being dragged is usually in ANOTHER column, so only its id is
    // known here. The workspace holds the board and resolves the rest.
    const taskId = event.dataTransfer.getData("text/plain") || draggingTaskId;

    if (!taskId) return;

    onMove(taskId, { phaseId, boardColumn, position });
  };

  return (
    <div
      onDragOver={allowDrop}
      onDragLeave={() => setIsOver(false)}
      onDrop={(event) => dropAt(event, tasks.length)}
      // A TRANSPARENT BORDER RATHER THAN NO BORDER, so the drop highlight
      // colours one in instead of adding one - a border appearing on
      // dragover reflows the whole grid by two pixels under the cursor.
      //
      // It used to be a drawn border in every state, which put three nested
      // outlines on the screen at once: the phase's card, the column, and
      // the task inside it. The tint is enough to bound a column, and a
      // board is easier to read with the one box that matters drawn.
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-xl border border-transparent bg-muted/40 p-2 transition-colors",
        isOver && accepts && "border-primary bg-primary/5",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        <h4 id={headingId} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {TASK_COLUMN_LABELS[boardColumn]}
          <span className="ml-1.5 font-normal normal-case">({tasks.length})</span>
        </h4>

        {canEditTasks ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-7 px-0 text-muted-foreground"
            aria-label={`Add a task to ${TASK_COLUMN_LABELS[boardColumn]}`}
            onClick={() => onAddTask(phaseId, boardColumn)}
          >
            <Plus size={14} aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <ul aria-labelledby={headingId} className="flex min-h-16 flex-col gap-2">
        {tasks.map((task, index) => (
          <li
            key={task.id}
            onDragOver={allowDrop}
            onDrop={(event) => dropAt(event, index)}
          >
            <BoardTaskCard
              task={task}
              boardColumn={boardColumn}
              index={index}
              columnLength={tasks.length}
              phases={phases}
              canEditTasks={canEditTasks}
              canLogTime={canLogTime}
              isPending={pendingTaskId === task.id}
              isDragging={draggingTaskId === task.id}
              endPositionFor={endPositionFor}
              onOpen={onOpen}
              onLogTime={onLogTime}
              onDelete={onDelete}
              onMove={onMove}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
