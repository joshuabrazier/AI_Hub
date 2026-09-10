"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ChevronDown, Clock, Loader2, Paperclip, Pencil, Timer, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MESSAGES } from "@/lib/constants";
import {
  TASK_COLUMNS,
  TASK_COLUMN_LABELS,
  TASK_COLUMN_ORDER,
  type TaskColumn,
} from "@/lib/data/kysely-database-types";
import { formatDateTime } from "@/lib/format";
import type { ServerApiResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

import { getTaskDetailAction } from "../delivery-board.actions";
import { deleteTimeEntryAction } from "../delivery-time.actions";
import {
  budgetProgress,
  formatMinutesAsClock,
  type ProjectMemberDTO,
  type TaskCardDTO,
  type TaskDetailDTO,
  type TimeEntryDTO,
} from "../delivery.types";
import { BoardTaskAttachments } from "./board-task-attachments";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { AssigneeMenuItems } from "./board-assign";
import { BoardTaskEditDialog } from "./board-task-edit-dialog";
import type { MoveTaskHandler } from "./board-task-card";
import { BoardTimeEntryDialog } from "./board-time-entry-dialog";

// -------------------------------------------------------------------
// BoardTaskPanel
//
// One card, opened: what it is, what has been written about it, the files on
// it, every hour anybody has logged against it, how its estimate got to
// where it is - and the things people do from here.
//
// -------------------------------------------------------------------
// IT FETCHES, AND THAT IS A CHANGE WORTH EXPLAINING.
//
// The board read carries a hundred cards, so it deliberately carries no
// description, no attachment list, no entries and no history - a megabyte on
// every render of the screen people leave open all day. This panel asks for
// the one card it is showing, once, when it opens.
//
// THROUGH getTaskDetailAction, WHICH IS THE ONLY READ ACTION IN THE MODULE.
// The page-shaped read answers a miss with notFound(), and notFound() thrown
// inside a server action is propagated by unstable_rethrow and REPLACES THE
// PAGE - so a card a lead deleted a second ago would take the whole board
// away and read as a broken app. The action calls a service that refuses in
// words instead, and this panel shows the sentence and stays put.
//
// UNTIL IT ARRIVES, THE CARD IS SHOWN. Every figure in the header is on the
// board DTO already, so the panel opens complete rather than as a spinner,
// and the fetched detail replaces it. Nothing here is invented while it
// waits: the sections that need the fetch say they are loading.
//
// EVERY MUTATION REFETCHES rather than patching local state. A time entry
// edited here changes the logged total, the bar above it, and possibly the
// estimate history; keeping those in step by hand is three chances to
// disagree with the server, and the read is one round trip.
// -------------------------------------------------------------------

function TimeEntryRow({
  entry,
  canEdit,
  onEdit,
  onDelete,
  isDeleting,
}: {
  entry: TimeEntryDTO;
  canEdit: boolean;
  onEdit: (entry: TimeEntryDTO) => void;
  onDelete: (entry: TimeEntryDTO) => void;
  isDeleting: boolean;
}) {
  return (
    <li className="flex items-start gap-2 rounded-md border border-border bg-card p-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">
          {formatMinutesAsClock(entry.minutes)}
          <span className="text-muted-foreground"> - {entry.userName ?? "Someone no longer here"}</span>
        </p>
        {/* 'YYYY-MM-DD' as stored. Rendered as it is rather than through a
            Date, which would shift it a day in either direction depending on
            the reader's offset. */}
        <p className="text-xs text-muted-foreground">{entry.workDate}</p>
        {/* Somebody's own words, as a text node. */}
        {entry.notes ? <p className="mt-1 wrap-break-word text-sm text-muted-foreground">{entry.notes}</p> : null}
      </div>

      {canEdit ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="icon" title="Edit this entry" onClick={() => onEdit(entry)}>
            <Pencil size={14} aria-hidden="true" />
            <span className="sr-only">Edit this entry</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Delete this entry"
            disabled={isDeleting}
            onClick={() => onDelete(entry)}
          >
            {isDeleting ? (
              <Loader2 size={14} aria-hidden="true" className="animate-spin" />
            ) : (
              <Trash2 size={14} aria-hidden="true" />
            )}
            <span className="sr-only">Delete this entry</span>
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function BoardTaskPanel({
  task,
  boardColumn,
  phaseName,
  canEditTasks,
  canLogTime,
  isPending,
  members,
  yourUserId,
  endPositionFor,
  onOpenChange,
  onLogTime,
  onDelete,
  onMove,
  onAdjustEstimate,
  onAssign,
}: {
  task: TaskCardDTO;
  boardColumn: TaskColumn;
  phaseName: string;
  canEditTasks: boolean;
  canLogTime: boolean;
  isPending: boolean;
  members: readonly ProjectMemberDTO[];
  /** The viewer, so an entry of theirs can be told from a colleague's. */
  yourUserId: string;
  endPositionFor: (phaseId: string, boardColumn: TaskColumn) => number;
  onOpenChange: (open: boolean) => void;
  onLogTime: (task: TaskCardDTO) => void;
  onDelete: (task: TaskCardDTO) => void;
  onMove: MoveTaskHandler;
  /**
   * Opened by the WORKSPACE, not from inside this sheet. A dialog rendered
   * within a Sheet is nested in it, so closing the sheet would take the
   * dialog with it mid-edit.
   */
  onAdjustEstimate: (task: TaskCardDTO) => void;
  onAssign: (task: TaskCardDTO, assigneeId: string | null) => void;
}) {
  const [detail, setDetail] = useState<TaskDetailDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntryDTO | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<TimeEntryDTO | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const taskId = task.id;

  // Turning a response into the next state, written ONCE so the mount path
  // and every refresh after a mutation cannot disagree about what a failure
  // looks like. A failed read leaves whatever is on screen alone: the card
  // has gone or the viewer is off the project, and one sentence covers both
  // by design - the board stays where it is either way.
  const apply = useCallback((response: ServerApiResponse<TaskDetailDTO>) => {
    if (!response.success) {
      toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
      return;
    }

    setDetail(response.data);
  }, []);

  // -------------------------------------------------------------------
  // THE FETCH, AND NOTHING ELSE.
  //
  // No clearing of what a previous card left behind, because there is never
  // a previous card: the workspace gives this panel `key={task.id}`, so
  // opening a different one MOUNTS A NEW PANEL with its own empty state.
  // `isLoading` starts true in its initialiser for the same reason.
  //
  // The action is called here rather than through a helper because every
  // setState has to sit inside a callback: written in the effect body they
  // are a synchronous cascade, which is what react-hooks/set-state-in-effect
  // exists to catch. Same shape as the Teams import list.
  // -------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    getTaskDetailAction({ taskId })
      .then((response) => {
        if (!cancelled) apply(response);
      })
      .catch((error) => {
        console.warn("[task-panel] could not read the task", error);

        if (!cancelled) toast.error(MESSAGES.SOMETHING_WENT_WRONG);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [taskId, apply]);

  // Reading it again after a mutation. An event handler rather than an
  // effect, and deliberately NOT touching `isLoading`: the panel is already
  // full, and blanking it back to "Loading..." between a save and its result
  // is a flicker rather than information.
  const refresh = useCallback(async () => {
    apply(await getTaskDetailAction({ taskId }));
  }, [taskId, apply]);

  const deleteEntry = (entry: TimeEntryDTO) =>
    startTransition(async () => {
      setDeletingEntryId(entry.id);

      try {
        const response = await deleteTimeEntryAction({ timeEntryId: entry.id });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        toast.success("Time removed");
        await refresh();
      } finally {
        setDeletingEntryId(null);
      }
    });

  // The fetched card once it is here, the board's until then. They agree on
  // everything the header shows; the fetched one is fresher, which matters
  // after an edit made from this panel.
  const card = detail?.task ?? task;
  const rollup = detail?.rollup ?? budgetProgress(card.estimateMinutes, card.loggedMinutes);

  // A lead or admin edits anybody's time; everybody edits their own. The
  // same rule requireEntryControl applies on the server - this decides
  // whether a button is offered, never whether the write is allowed.
  const canEditEntry = (entry: TimeEntryDTO) => canEditTasks || entry.userId === yourUserId;

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-6 sm:max-w-md">
        <SheetHeader className="p-0">
          {/* Typed by a person. A text node, like everything else here. */}
          <SheetTitle className="pr-8 text-left text-lg">{card.title}</SheetTitle>
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
              {card.estimateMinutes > 0
                ? `${formatMinutesAsClock(card.loggedMinutes)} logged of ${formatMinutesAsClock(card.estimateMinutes)} estimated`
                : `${formatMinutesAsClock(card.loggedMinutes)} logged, no estimate set`}
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
                  {card.estimateMinutes > 0 ? formatMinutesAsClock(card.estimateMinutes) : "None set"}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock size={14} aria-hidden="true" />
                  Logged
                </dt>
                <dd className="text-foreground">{formatMinutesAsClock(card.loggedMinutes)}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <UserRound size={14} aria-hidden="true" />
                  Assignee
                </dt>
                {/* A CONTROL RATHER THAN A LABEL when the viewer may edit.
                    It read as plain text, which meant the only route to
                    assignment was the Edit button beside the Description
                    heading three sections down - a button that edits the
                    whole task but sits somewhere that says otherwise. */}
                <dd className="text-foreground">
                  {canEditTasks ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="h-7">
                          {card.assigneeName ?? "Unassigned"}
                          <ChevronDown size={14} aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
                        <AssigneeMenuItems
                          members={members}
                          assigneeId={card.assigneeId}
                          onAssign={(assigneeId) => onAssign(card, assigneeId)}
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    (card.assigneeName ?? "Unassigned")
                  )}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="flex items-center gap-1.5 text-muted-foreground">
                  <Paperclip size={14} aria-hidden="true" />
                  Files
                </dt>
                <dd className="text-foreground">
                  {card.attachmentCount === 0
                    ? "None"
                    : card.attachmentCount === 1
                      ? "1 file"
                      : `${card.attachmentCount} files`}
                </dd>
              </div>
            </dl>

            {/* -----------------------------------------------------------
                CHANGING THE ESTIMATE, FROM THE BOARD.

                This was reachable only from the timesheet, so realising a
                card will take longer meant leaving the board to say so - and
                the board is where somebody is standing when they realise it.

                It is here rather than in the edit dialog because an estimate
                is not an ordinary field: every change lands in the
                append-only log with a reason, and it can TRANSFER hours from
                another task instead of growing the project. A number box in
                an edit form would lose both.
                ----------------------------------------------------------- */}
            {canEditTasks ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => onAdjustEstimate(card)}
              >
                <Timer size={14} aria-hidden="true" />
                Adjust estimate
              </Button>
            ) : null}
          </section>

          <section aria-labelledby="task-panel-description">
            <div className="flex items-center justify-between gap-2">
              <h3 id="task-panel-description" className="text-sm font-semibold text-foreground">
                Description
              </h3>

              {/* Only once the fetch has landed: an edit form built from the
                  card would open with an empty description box over
                  whatever had been written. */}
              {canEditTasks && detail ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  <Pencil size={14} aria-hidden="true" />
                  Edit
                </Button>
              ) : null}
            </div>

            {isLoading ? (
              <p className="mt-1 text-sm text-muted-foreground">Loading...</p>
            ) : detail?.description ? (
              // Typed by a person. `whitespace-pre-wrap` keeps the line
              // breaks they typed without any markup being interpreted.
              <p className="mt-1 whitespace-pre-wrap wrap-break-word text-sm text-muted-foreground">
                {detail.description}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Nothing written yet.</p>
            )}
          </section>

          {isLoading ? (
            <section aria-labelledby="task-panel-files-loading">
              <h3 id="task-panel-files-loading" className="text-sm font-semibold text-foreground">
                Files
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">Loading...</p>
            </section>
          ) : detail ? (
            <BoardTaskAttachments
              taskId={card.id}
              attachments={detail.attachments}
              canUpload={canLogTime}
              canRemoveAny={canEditTasks}
              onChanged={() => void refresh()}
            />
          ) : null}

          <section aria-labelledby="task-panel-time">
            <h3 id="task-panel-time" className="text-sm font-semibold text-foreground">
              Time logged
            </h3>

            {isLoading ? (
              <p className="mt-1 text-sm text-muted-foreground">Loading...</p>
            ) : detail && detail.timeEntries.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {detail.timeEntries.map((entry) => (
                  <TimeEntryRow
                    key={entry.id}
                    entry={entry}
                    canEdit={canEditEntry(entry)}
                    onEdit={setEditingEntry}
                    onDelete={setDeletingEntry}
                    isDeleting={deletingEntryId === entry.id}
                  />
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No time against this task yet.</p>
            )}

            {canLogTime ? (
              <>
                <p className="mt-3 text-sm text-muted-foreground">
                  Time is always your own here. There is no way to log an hour for somebody else.
                </p>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => onLogTime(card)}>
                  <Clock size={14} aria-hidden="true" />
                  Log time
                </Button>
              </>
            ) : null}
          </section>

          {detail && detail.estimateHistory.length > 0 ? (
            <section aria-labelledby="task-panel-history">
              <h3 id="task-panel-history" className="text-sm font-semibold text-foreground">
                Estimate history
              </h3>
              <ul className="mt-2 space-y-2">
                {detail.estimateHistory.map((change) => (
                  <li key={change.id} className="rounded-md border border-border bg-card p-2 text-sm">
                    <p className="text-foreground">
                      {/* Signed from THIS task's point of view, which is the
                          service's doing - a transfer is one row read from
                          two sides. */}
                      {change.minutes >= 0 ? "+" : "-"}
                      {formatMinutesAsClock(Math.abs(change.minutes))}
                      {change.counterpartTaskTitle ? (
                        <span className="text-muted-foreground">
                          {change.direction === "in" ? " from " : " to "}
                          {change.counterpartTaskTitle}
                        </span>
                      ) : null}
                    </p>
                    {change.reason ? (
                      <p className="mt-1 wrap-break-word text-muted-foreground">{change.reason}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {change.changedByName ?? "Someone no longer here"} - {formatDateTime(change.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
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
                        onMove(card.id, {
                          phaseId: card.phaseId,
                          boardColumn: column,
                          position: endPositionFor(card.phaseId, column),
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
                onClick={() => onDelete(card)}
              >
                <Trash2 size={14} aria-hidden="true" />
                Delete task
              </Button>
            </section>
          ) : null}
        </div>
      </SheetContent>

      {isEditing && detail ? (
        <BoardTaskEditDialog
          open
          onOpenChange={setIsEditing}
          task={{
            id: card.id,
            title: card.title,
            description: detail.description,
            assigneeId: card.assigneeId,
          }}
          members={members}
          onSaved={() => void refresh()}
        />
      ) : null}

      {editingEntry ? (
        <BoardTimeEntryDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditingEntry(null);
          }}
          entry={editingEntry}
          onSaved={() => void refresh()}
        />
      ) : null}

      {/* -------------------------------------------------------------
          DELETING AN HOUR ASKS FIRST.

          It did not, and it was the only destructive act in the module that
          did not: deleting a task, a phase, a rate, a budget group and
          removing a member are all confirmed. This one went straight from a
          small trash icon to a hard DELETE - `deleteTimeEntryRepo` removes
          the row outright, there is no soft delete and no undo - and the
          hours it takes are what a client is invoiced from.

          The note is named because the note is the part that cannot be
          reconstructed: the figure could be retyped from a timesheet, the
          sentence explaining what the time went on could not.
          ------------------------------------------------------------- */}
      <ConfirmDialog
        open={deletingEntry !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingEntry(null);
        }}
        title="Delete this time entry?"
        description={
          deletingEntry
            ? `${formatMinutesAsClock(deletingEntry.minutes)} on ${deletingEntry.workDate} will be removed from this task and from the timesheet it was logged on.${
                deletingEntry.notes ? ` Its note - "${deletingEntry.notes}" - goes with it.` : ""
              }`
            : ""
        }
        confirmLabel="Delete entry"
        pendingLabel="Deleting..."
        isPending={deletingEntryId !== null}
        onConfirm={() => {
          if (deletingEntry) deleteEntry(deletingEntry);
          setDeletingEntry(null);
        }}
      />
    </Sheet>
  );
}
