"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Layers, Plus } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MESSAGES } from "@/lib/constants";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  TASK_COLUMNS,
  TASK_COLUMN_LABELS,
  type ProjectStatus,
  type TaskColumn,
} from "@/lib/data/kysely-database-types";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import type { ServerApiResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

import { deleteTaskAction, moveTaskAction } from "../delivery-board.actions";
import { deletePhaseAction, reorderPhasesAction } from "../delivery-setup.actions";
import {
  type BoardDTO,
  type BoardPhaseDTO,
  type PhaseDTO,
  type ProjectMemberDTO,
  type ProjectSummaryDTO,
  type TaskCardDTO,
} from "../delivery.types";
import { BoardEmptyState } from "./board-empty-state";
import {
  applyMove,
  indexBoard,
  isSamePlace,
  movePhaseOrder,
  type BoardPlacement,
} from "./board-move";
import { EstimateAdjustDialog } from "./estimate-adjust-dialog";
import { buildTimesheetCatalogue, findCatalogueTask } from "./timesheet-catalogue";
import { BoardLogTimeDialog } from "./board-log-time-dialog";
import { BoardPhaseDialog } from "./board-phase-dialog";
import { BoardPhaseSection } from "./board-phase-section";
import { BoardTaskDialog } from "./board-task-dialog";
import { BoardTaskPanel } from "./board-task-panel";
import type { BoardPhaseOption } from "./board-task-card";

// -------------------------------------------------------------------
// BoardWorkspace
//
// The two-column screen: the projects this person is on down the left, the
// open one's board on the right. Deliberately the same shape as the
// transcription workspace and AI chat, because they are the same kind of
// screen and somebody who has used one should not have to learn another.
//
// WHICH PROJECT IS OPEN LIVES IN THE URL - it is the path segment the route
// already carries - so a board is linkable, survives a refresh and works
// with the back button. Nothing about that grants access: the services
// re-check the id against `project_members` on every render, and a project
// the caller is not on answers notFound().
//
// WHICH CARD IS OPEN IS LOCAL STATE, and that is the one place this differs
// from the transcription workspace. There the server resolves `?id=` and
// hands back the open item; here the route file passes only a project id,
// so a `?task=` in the URL would promise a link that survives a refresh
// while nothing on the server could read it. A panel built from the board
// the server already sent is honest about what it is.
//
// EVERY WRITE GOES THROUGH AN ACTION AND THEN A REFRESH. The services
// revalidate all three areas themselves, so router.refresh() picks up a
// board the server rebuilt rather than one patched here - which is what
// keeps two people dragging on the same board from diverging.
//
// `canEditTasks` COMES OFF THE BOARD DTO and is passed down unchanged. It
// is "lead OR admin", decided once on the server; nothing in this tree
// derives it from a role, and every write is re-checked there anyway.
// -------------------------------------------------------------------

/** One entry in the left-hand list. The href is built on the server, by role. */
export type BoardProjectLink = {
  id: string;
  title: string;
  clientName: string;
  status: ProjectStatus;
  href: string;
};

export function BoardWorkspace({
  projects,
  project,
  activeProjectId,
  projectStatus,
  board,
  phaseStats,
  members,
  yourName,
  yourUserId,
}: {
  projects: readonly BoardProjectLink[];
  /** This project's summary, folded into a catalogue for the estimate dialog. */
  project: ProjectSummaryDTO;
  activeProjectId: string;
  projectStatus: ProjectStatus;
  board: BoardDTO;
  /** Per-phase totals from the project read, keyed up by phase id below. */
  phaseStats: readonly PhaseDTO[];
  members: readonly ProjectMemberDTO[];
  /** The signed-in person, named on the log-time dialog. Time is always theirs. */
  yourName: string;
  /**
   * The viewer's own id, for the task panel: a time entry of theirs is
   * editable and a colleague's is not, unless they lead the project. It is
   * the SAME rule requireEntryControl applies on the server, and this copy
   * decides only whether a button is offered.
   */
  yourUserId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<{ phaseId: string; boardColumn: TaskColumn } | null>(null);
  const [loggingTime, setLoggingTime] = useState<TaskCardDTO | null>(null);
  const [deletingTask, setDeletingTask] = useState<TaskCardDTO | null>(null);
  const [phaseDialog, setPhaseDialog] = useState<{ phase: BoardPhaseDTO | null } | null>(null);
  const [deletingPhase, setDeletingPhase] = useState<BoardPhaseDTO | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [adjustingTask, setAdjustingTask] = useState<TaskCardDTO | null>(null);

  // -------------------------------------------------------------------
  // The board, indexed once per render.
  //
  // A move needs to know where a card is NOW (to skip a move to where it
  // already is) and how long its destination column is (to append to it).
  // Both are questions about the whole board, which is why they are
  // answered in board-move.ts - a column can only see itself - and why that
  // arithmetic is tested on its own.
  // -------------------------------------------------------------------
  // -------------------------------------------------------------------
  // THE BOARD AS IT WILL BE, DRAWN AT ONCE.
  //
  // A move used to await the action and then router.refresh(), so the card
  // stayed put for a whole round trip. After a DRAG that is unmistakable:
  // the gesture ends, the card snaps back to where it came from, and some
  // time later it appears where it was dropped. People read that as broken
  // and drag it again.
  //
  // useOptimistic holds the moved board only while the transition is open.
  // `run` keeps that transition open across the action AND the
  // router.refresh() that follows it, so the optimistic value is replaced by
  // real server data rather than being dropped in between - which would show
  // the card snapping back for a frame before landing again.
  //
  // A REFUSAL PUTS THE CARD BACK BY ITSELF. Nothing here has to undo
  // anything: the transition ends, the optimistic value is discarded, and
  // the board re-renders from the props it always had. The toast says why.
  // -------------------------------------------------------------------
  const [optimisticBoard, applyOptimisticMove] = useOptimistic(
    board,
    (current: BoardDTO, move: { taskId: string; destination: BoardPlacement }) =>
      applyMove(current, move.taskId, move.destination),
  );

  const { located, endPositionFor } = indexBoard(optimisticBoard);

  const phaseOptions: BoardPhaseOption[] = optimisticBoard.phases.map((phase) => ({
    phaseId: phase.phaseId,
    phaseName: phase.phaseName,
  }));

  const statsByPhase = new Map(phaseStats.map((phase) => [phase.id, phase]));

  // Archiving is this module's soft delete, and the services refuse new work
  // on an archived project in words. The screen stops offering it rather
  // than letting somebody fill in a form to be told no.
  const isArchived = projectStatus === PROJECT_STATUSES.ARCHIVED;
  const canEditTasks = board.canEditTasks && !isArchived;
  const canLogTime = !isArchived;

  const openTask = openTaskId ? (located.get(openTaskId) ?? null) : null;

  // -------------------------------------------------------------------
  // This project as the estimate dialog wants it.
  //
  // Built with buildTimesheetCatalogue - the timesheet's own function - so
  // there is one answer to what a task option looks like rather than two.
  // The dialog needs every OTHER task on the project as possible sources for
  // a transfer, which is a question about the whole board and not about the
  // card being adjusted.
  //
  // From the OPTIMISTIC board, so a card dragged a moment ago is offered at
  // the phase it was dropped in rather than the one it came from.
  // -------------------------------------------------------------------
  const estimateProject =
    buildTimesheetCatalogue([project], [optimisticBoard]).projects[0] ?? null;

  const adjustingOption = adjustingTask
    ? (findCatalogueTask(
        { projects: estimateProject ? [estimateProject] : [] },
        adjustingTask.id,
      ) ?? null)
    : null;

  // -------------------------------------------------------------------
  // One place every action reports from.
  //
  // A refusal from a service arrives as `formError` and is a SENTENCE
  // somebody can act on - "that task has time logged against it" - so it is
  // shown as it was written rather than collapsed into a generic failure.
  // -------------------------------------------------------------------
  const run = (
    action: () => Promise<ServerApiResponse<unknown>>,
    successMessage: string,
    onDone?: () => void,
    // Applied INSIDE the transition, before the await. useOptimistic refuses
    // an update outside one, and the transition is also what keeps the value
    // alive until the refresh lands.
    optimistically?: () => void,
  ) =>
    startTransition(async () => {
      optimistically?.();

      try {
        const response = await action();

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        toast.success(successMessage);
        onDone?.();
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      } finally {
        setPendingTaskId(null);
      }
    });

  const moveTask = (
    taskId: string,
    destination: { phaseId: string; boardColumn: TaskColumn; position: number },
  ) => {
    setDraggingTaskId(null);

    // A card dropped where it already is. Skipped rather than sent, because
    // the write would renumber a column to the order it is already in.
    if (isSamePlace(located.get(taskId), destination)) return;

    setPendingTaskId(taskId);

    run(
      () =>
        moveTaskAction({
          taskId,
          phaseId: destination.phaseId,
          boardColumn: destination.boardColumn,
          position: destination.position,
        }),
      "Task moved",
      undefined,
      // The card lands where it was dropped before the request is even sent.
      () => applyOptimisticMove({ taskId, destination }),
    );
  };

  const confirmDeleteTask = () => {
    if (!deletingTask) return;

    const taskId = deletingTask.id;

    run(() => deleteTaskAction({ taskId }), "Task deleted", () => {
      setDeletingTask(null);
      // The panel may be showing the card that just went.
      if (openTaskId === taskId) setOpenTaskId(null);
    });
  };

  // -------------------------------------------------------------------
  // Reordering sends the WHOLE ordered list, which is the shape the schema
  // takes: replaying it produces the same order, where "move this one up"
  // has to be re-interpreted against whatever the server currently holds.
  // -------------------------------------------------------------------
  const movePhase = (phase: BoardPhaseDTO, direction: -1 | 1) => {
    const reordered = movePhaseOrder(
      board.phases.map((item) => item.phaseId),
      phase.phaseId,
      direction,
    );

    // Already at the end it was being pushed towards, or a phase this board
    // no longer holds. Nothing to send, and nothing to report.
    if (!reordered) return;

    run(() => reorderPhasesAction({ projectId: board.projectId, phaseIds: reordered }), "Phase order saved");
  };

  const confirmDeletePhase = () => {
    if (!deletingPhase) return;

    run(() => deletePhaseAction({ phaseId: deletingPhase.phaseId }), "Phase deleted", () => setDeletingPhase(null));
  };

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* Projects. Membership decides what is in this list, which is why
            it is the same list in all three areas. */}
        <aside className="flex min-w-0 flex-col gap-3">
          <nav aria-label="Your projects">
            <ul className="space-y-1">
              {projects.map((project) => {
                const isActive = project.id === activeProjectId;

                return (
                  <li key={project.id}>
                    <Link
                      href={project.href}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "block rounded-lg px-3 py-2 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                        isActive ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {/* Project titles and client names are typed by
                          people. Text nodes, always. */}
                      <span className="block truncate text-sm font-medium">{project.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {project.clientName}
                        {project.status === PROJECT_STATUSES.ACTIVE
                          ? ""
                          : ` - ${PROJECT_STATUS_LABELS[project.status]}`}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        {/* The open project's board */}
        <section className="min-w-0 space-y-4">
          {/* THE ROLLUP LINE HAS GONE FROM HERE. It said "6h logged of 240h
              estimated" directly beneath a page header that said nothing at
              all, so the figure is in the header now - see the `metric` prop
              on this page - and this row is left with just the controls it
              always had. One fewer line, and the header earns its height. */}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {projectStatus === PROJECT_STATUSES.ACTIVE ? null : (
                <Badge variant={isArchived ? "destructive" : "warning"}>
                  {PROJECT_STATUS_LABELS[projectStatus]}
                </Badge>
              )}

              {board.canEditTasks && !isArchived ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setPhaseDialog({ phase: null })}>
                  <Plus size={14} aria-hidden="true" />
                  Add phase
                </Button>
              ) : null}
            </div>
          </div>

          {isArchived ? (
            <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              This project has been archived, so no new tasks or time can be added to it. An administrator can
              make it active again.
            </p>
          ) : null}

          {optimisticBoard.phases.length === 0 ? (
            <BoardEmptyState
              icon={<Layers size={18} aria-hidden="true" />}
              title="This project has no phases yet"
              detail={
                board.canEditTasks
                  ? "A board is split by phase, and each phase gets its own four columns. Add the first one - Discovery, Build, whatever the work is called here - and the tasks go in it."
                  : "A board is split by phase, and this project has none yet. A project lead or an administrator adds the first one, and the tasks appear underneath it."
              }
              action={
                board.canEditTasks && !isArchived ? (
                  <Button type="button" onClick={() => setPhaseDialog({ phase: null })}>
                    <Plus size={16} aria-hidden="true" />
                    Add the first phase
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-4">
              {optimisticBoard.phases.map((phase, index) => (
                <BoardPhaseSection
                  key={phase.phaseId}
                  phase={phase}
                  stats={statsByPhase.get(phase.phaseId)}
                  phases={phaseOptions}
                  isFirst={index === 0}
                  isLast={index === optimisticBoard.phases.length - 1}
                  canEditTasks={canEditTasks}
                  canLogTime={canLogTime}
                  pendingTaskId={pendingTaskId}
                  draggingTaskId={draggingTaskId}
                  endPositionFor={endPositionFor}
                  onOpenTask={(task) => setOpenTaskId(task.id)}
                  onLogTime={setLoggingTime}
                  onDeleteTask={setDeletingTask}
                  onMoveTask={moveTask}
                  onAddTask={(phaseId, boardColumn) => setAddingTo({ phaseId, boardColumn })}
                  onRenamePhase={(target) => setPhaseDialog({ phase: target })}
                  onMovePhase={movePhase}
                  onDeletePhase={setDeletingPhase}
                  onDragStart={(task) => setDraggingTaskId(task.id)}
                  onDragEnd={() => setDraggingTaskId(null)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {openTask ? (
        <BoardTaskPanel
          // KEYED ON THE CARD, so opening a different one mounts a fresh
          // panel rather than reusing this one. The panel fetches the task it
          // is showing, and without the key it would briefly show the
          // previous card's description and files under the new card's title.
          key={openTask.task.id}
          task={openTask.task}
          boardColumn={openTask.boardColumn}
          phaseName={openTask.phaseName}
          canEditTasks={canEditTasks}
          canLogTime={canLogTime}
          isPending={isPending}
          members={members}
          yourUserId={yourUserId}
          endPositionFor={endPositionFor}
          onOpenChange={(open) => {
            if (!open) setOpenTaskId(null);
          }}
          onLogTime={setLoggingTime}
          onDelete={setDeletingTask}
          onMove={moveTask}
          onAdjustEstimate={setAdjustingTask}
        />
      ) : null}

      {/* -------------------------------------------------------------
          CHANGING WHAT A CARD IS EXPECTED TO TAKE, FROM THE BOARD.

          This was reachable only from the timesheet, so realising a task
          will take longer meant leaving the board to say so - and the board
          is exactly where somebody is standing when they realise it.

          Rendered here rather than inside the panel because the panel is a
          Sheet: a dialog opened from within one is nested inside it, and
          closing the sheet would take the dialog with it mid-edit.
          ------------------------------------------------------------- */}
      {adjustingTask && estimateProject && adjustingOption ? (
        <EstimateAdjustDialog
          project={estimateProject}
          task={adjustingOption}
          onOpenChange={(open) => {
            if (!open) setAdjustingTask(null);
          }}
          onAdjusted={() => {
            setAdjustingTask(null);
            router.refresh();
          }}
        />
      ) : null}

      {addingTo ? (
        <BoardTaskDialog
          open
          onOpenChange={(open) => {
            if (!open) setAddingTo(null);
          }}
          phaseId={addingTo.phaseId}
          boardColumn={addingTo.boardColumn}
          phases={phaseOptions}
          members={members}
        />
      ) : null}

      {loggingTime ? (
        <BoardLogTimeDialog
          open
          onOpenChange={(open) => {
            if (!open) setLoggingTime(null);
          }}
          task={loggingTime}
          yourName={yourName}
        />
      ) : null}

      {phaseDialog ? (
        <BoardPhaseDialog
          open
          onOpenChange={(open) => {
            if (!open) setPhaseDialog(null);
          }}
          projectId={board.projectId}
          phase={phaseDialog.phase}
        />
      ) : null}

      {/* A task with time logged against it is refused in words by the
          service, and that sentence is what the toast shows. */}
      <ConfirmDialog
        open={deletingTask !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingTask(null);
        }}
        title="Delete this task?"
        description={`"${deletingTask?.title ?? ""}" will be permanently deleted, along with any files attached to it. A task with time logged against it cannot be deleted - move it to ${TASK_COLUMN_LABELS[TASK_COLUMNS.DONE]} instead.`}
        confirmLabel="Delete task"
        pendingLabel="Deleting…"
        isPending={isPending}
        onConfirm={confirmDeleteTask}
      />

      <ConfirmDialog
        open={deletingPhase !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingPhase(null);
        }}
        title="Delete this phase?"
        description={`"${deletingPhase?.phaseName ?? ""}" and every task in it will be permanently deleted. A phase with time logged against it cannot be deleted.`}
        confirmLabel="Delete phase"
        pendingLabel="Deleting…"
        isPending={isPending}
        onConfirm={confirmDeletePhase}
      />
    </>
  );
}
