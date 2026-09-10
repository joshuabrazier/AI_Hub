"use client";

import { ArrowDown, ArrowUp, EllipsisVertical, ListTodo, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TASK_COLUMNS, type TaskColumn } from "@/lib/data/kysely-database-types";

import { describeTaskEffort, type BoardPhaseDTO, type PhaseDTO, type TaskCardDTO } from "../delivery.types";
import { BoardColumn } from "./board-column";
import { BoardEmptyState } from "./board-empty-state";
import type { BoardPhaseOption, MoveTaskHandler } from "./board-task-card";

// -------------------------------------------------------------------
// BoardPhaseSection
//
// ONE PHASE IS ONE BOARD. The screen is split vertically by phase and each
// phase carries the same four columns, rather than one board with a phase
// label on every card - because the question a delivery board is opened to
// answer is "where is discovery up to", and a single column mixing three
// phases cannot answer it without the reader sorting the cards by eye.
//
// The phase HEADING carries its totals, so the estimate against the time
// logged is readable without opening anything. Both come from the project
// read, already summed, in minutes - formatted here and divided by sixty
// nowhere.
//
// REORDERING SENDS THE WHOLE LIST rather than "move this one up", which is
// the shape ReorderPhasesSchema takes and the reason it is idempotent: two
// people nudging phases at once resolve to one order instead of
// interleaving. That list is built by the workspace, which holds them all.
// -------------------------------------------------------------------
export function BoardPhaseSection({
  phase,
  stats,
  phases,
  isFirst,
  isLast,
  canEditTasks,
  canLogTime,
  pendingTaskId,
  draggingTaskId,
  endPositionFor,
  onOpenTask,
  onLogTime,
  onDeleteTask,
  onMoveTask,
  onAddTask,
  onRenamePhase,
  onMovePhase,
  onDeletePhase,
  onDragStart,
  onDragEnd,
}: {
  phase: BoardPhaseDTO;
  /** The phase's own totals, from the project read. Absent is treated as nought. */
  stats?: PhaseDTO;
  phases: readonly BoardPhaseOption[];
  isFirst: boolean;
  isLast: boolean;
  canEditTasks: boolean;
  canLogTime: boolean;
  pendingTaskId: string | null;
  draggingTaskId: string | null;
  endPositionFor: (phaseId: string, boardColumn: TaskColumn) => number;
  onOpenTask: (task: TaskCardDTO) => void;
  onLogTime: (task: TaskCardDTO) => void;
  onDeleteTask: (task: TaskCardDTO) => void;
  onMoveTask: MoveTaskHandler;
  onAddTask: (phaseId: string, boardColumn: TaskColumn) => void;
  onRenamePhase: (phase: BoardPhaseDTO) => void;
  onMovePhase: (phase: BoardPhaseDTO, direction: -1 | 1) => void;
  onDeletePhase: (phase: BoardPhaseDTO) => void;
  onDragStart: (task: TaskCardDTO) => void;
  onDragEnd: () => void;
}) {
  const cardCount = phase.columns.reduce((total, column) => total + column.tasks.length, 0);
  const headingId = `phase-${phase.phaseId}-heading`;

  // Absent stats are treated as nought here rather than in the DTO, because
  // the only way to be missing one is for a phase to have been added between
  // the project read and the board read.
  const effort = describeTaskEffort(stats?.estimateMinutes ?? 0, stats?.loggedMinutes ?? 0);

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Phase names are typed by people. Text node, always. */}
          <h3 id={headingId} className="text-base font-semibold text-foreground">
            {phase.phaseName}
          </h3>
          {/* THE SAME EFFORT FORM AS THE CARDS UNDERNEATH IT. This used to
              spell both figures out - "24h estimated, 6h logged" - which is
              the right shape for a sentence and the wrong one for a heading
              sitting directly above a grid of cards written the other way.
              One form, read once, applies everywhere on the screen. */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {cardCount === 1 ? "1 task" : `${cardCount} tasks`}
            <span aria-hidden="true" className="font-mono"> &middot; {effort.short}</span>
            <span className="sr-only">, {effort.full}</span>
          </p>
        </div>

        {canEditTasks ? (
          <div className="flex items-center gap-1">
            <Button type="button" variant="outline" size="sm" onClick={() => onAddTask(phase.phaseId, TASK_COLUMNS.TODO)}>
              <Plus size={14} aria-hidden="true" />
              Add task
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-8 px-0 text-muted-foreground"
                  aria-label={`Actions for phase ${phase.phaseName}`}
                >
                  <EllipsisVertical size={16} aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={() => onRenamePhase(phase)}>
                  <Pencil aria-hidden="true" />
                  Rename phase
                </DropdownMenuItem>
                <DropdownMenuItem disabled={isFirst} onSelect={() => onMovePhase(phase, -1)}>
                  <ArrowUp aria-hidden="true" />
                  Move phase up
                </DropdownMenuItem>
                <DropdownMenuItem disabled={isLast} onSelect={() => onMovePhase(phase, 1)}>
                  <ArrowDown aria-hidden="true" />
                  Move phase down
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Refused in words when the phase has time logged against it
                    or files on its tasks - the service answers, not this menu. */}
                <DropdownMenuItem variant="destructive" onSelect={() => onDeletePhase(phase)}>
                  <Trash2 aria-hidden="true" />
                  Delete phase
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>

      {cardCount === 0 ? (
        <BoardEmptyState
          className="mt-4"
          icon={<ListTodo size={18} aria-hidden="true" />}
          title="No tasks in this phase yet"
          detail={
            canEditTasks
              ? "Add the first task and it will appear in To do. The four columns below take it from there."
              : // Phrased as a fact rather than as instructions for somebody
                // else, because this is also what a lead sees on an archived
                // project, where the banner above has already said why the
                // button has gone.
                "Tasks here are added by a project lead or an administrator. Once one exists you can log time against it."
          }
          action={
            canEditTasks ? (
              <Button type="button" variant="outline" size="sm" onClick={() => onAddTask(phase.phaseId, TASK_COLUMNS.TODO)}>
                <Plus size={14} aria-hidden="true" />
                Add the first task
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {/* The four columns are rendered whether or not the phase has cards:
          an empty column is a drop target, and a phase somebody is about to
          drag work into needs all four. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {phase.columns.map((column) => (
          <BoardColumn
            key={column.column}
            phaseId={phase.phaseId}
            boardColumn={column.column}
            headingId={`phase-${phase.phaseId}-${column.column}`}
            tasks={column.tasks}
            phases={phases}
            canEditTasks={canEditTasks}
            canLogTime={canLogTime}
            pendingTaskId={pendingTaskId}
            draggingTaskId={draggingTaskId}
            endPositionFor={endPositionFor}
            onOpen={onOpenTask}
            onLogTime={onLogTime}
            onDelete={onDeleteTask}
            onMove={onMoveTask}
            onAddTask={onAddTask}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>
    </section>
  );
}
