"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  ChevronDown,
  Clock,
  Loader2,
  MoreHorizontal,
  Pencil,
  Timer,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MESSAGES } from "@/lib/constants";
import {
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
  describeTaskEffort,
  formatMinutesAsClock,
  type ProjectMemberDTO,
  type TaskCardDTO,
  type TaskDetailDTO,
  type TimeEntryDTO,
} from "../delivery.types";
import { BoardTaskAttachments } from "./board-task-attachments";
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

// -------------------------------------------------------------------
// WHICH COLUMN THIS CARD IS IN - shown as the thing that changes it.
//
// This replaces a headed "Move" section holding a paragraph, four buttons
// and a badge repeating the current column, plus the column half of the
// sheet's own subtitle. Four renderings, one fact.
//
// A DROPDOWN RATHER THAN FOUR BUTTONS because a column is a single value
// out of a closed set, and a row of buttons where one is disabled and
// slightly darker is a control that has to be decoded before it can be
// read. This reads as the answer and opens as the choices.
//
// RADIO ITEMS, not plain items, so the current column is stated by the
// control instead of by a badge beside it - and a screen reader is told
// which of four is selected rather than being handed four buttons where
// one happens to be unavailable.
//
// READ-ONLY IS STILL RENDERED. Somebody who cannot move a card still needs
// to know where it is, and this is now the only place that says so.
// -------------------------------------------------------------------
function TaskColumnControl({
  boardColumn,
  canEditTasks,
  isPending,
  onSelect,
}: {
  boardColumn: TaskColumn;
  canEditTasks: boolean;
  isPending: boolean;
  onSelect: (column: TaskColumn) => void;
}) {
  if (!canEditTasks) {
    return (
      <span className="rounded-md border border-border px-2 py-1 text-sm text-muted-foreground">
        {TASK_COLUMN_LABELS[boardColumn]}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={isPending}>
          {TASK_COLUMN_LABELS[boardColumn]}
          <ChevronDown size={14} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={boardColumn}
          onValueChange={(value) => {
            // Radix hands back a string. Selecting the column it is already
            // in is a no-op rather than a write, because the menu closes on
            // any selection and re-appending a card to its own column would
            // silently move it to the bottom.
            if (value !== boardColumn) onSelect(value as TaskColumn);
          }}
        >
          {TASK_COLUMN_ORDER.map((column) => (
            <DropdownMenuRadioItem key={column} value={column}>
              {TASK_COLUMN_LABELS[column]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        {/* KEPT, because it is true and it is not obvious: this appends,
            where dragging chooses a slot. It is a note at the foot of the
            menu now rather than a paragraph at the top of a section. */}
        <DropdownMenuSeparator />
        <p className="px-1.5 py-1 text-xs text-muted-foreground">
          Appends to the column. Drag a card to choose a slot.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
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
  /**
   * `onDone` runs after the write and the board refresh. The panel passes its
   * own refetch, because router.refresh() rebuilds the BOARD and this panel
   * holds a separately fetched copy of the same card.
   */
  onAssign: (task: TaskCardDTO, assigneeId: string | null, onDone?: () => void) => void;
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
  // full, and blanking it back to "Loading…" between a save and its result
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
          {/* THE PHASE ONLY. The column used to be here as well as in a
              headed "Move" section further down and again in a badge inside
              it - three renderings of one fact. It is a control now, below,
              which is the one place it can both be read and changed. */}
          <SheetDescription className="text-left">{phaseName}</SheetDescription>
        </SheetHeader>

        {/* -----------------------------------------------------------
            WHAT THIS CARD IS, AND WHAT YOU CAN DO TO IT.

            This strip replaces two headed sections and four rows of a
            description list, which between them said less than it does.

            "Move" WAS A SECTION with a paragraph, four buttons and a badge -
            and its own copy admitted the better way was to drag the card.
            A column is a piece of state, so it belongs where the state is
            shown: one control that reads as the current value and changes
            it. The drag path is untouched and is still the good one; this is
            what a keyboard reaches for.

            "Remove" WAS A SECTION TOO, with a heading the same size as
            Description and Time. Deleting a task is not a third of what this
            panel is about, and giving it equal weight is how somebody
            reaches for it by accident. It is in the menu, last, marked.

            ASSIGNEE MOVED UP HERE out of a list called "Effort", where it
            had been filed because there was nowhere else to put it. Who has
            a card is the second thing anybody wants to know about it.
            ----------------------------------------------------------- */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <TaskColumnControl
            boardColumn={boardColumn}
            canEditTasks={canEditTasks}
            isPending={isPending}
            onSelect={(column) =>
              onMove(card.id, {
                phaseId: card.phaseId,
                boardColumn: column,
                position: endPositionFor(card.phaseId, column),
              })
            }
          />

          {/* -----------------------------------------------------------
              WHO HAS IT, AS A CONTROL.

              Two changes met here. The assignee used to be a plain text row
              inside a description list headed "Effort" - which is not what
              an assignee is - and the only way to CHANGE it was the Edit
              button beside the Description heading three sections down, a
              button that edits the whole task from a place that says
              otherwise. That list is gone and Edit is in the menu on the
              right, so this is where both halves land: the fact and the way
              to change it, next to the column, which is the same shape.
              ----------------------------------------------------------- */}
          {canEditTasks ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {/* Disabled while a write is in flight, like the column
                    control beside it. Somebody who sees nothing change
                    should not be able to stack a second assignment on the
                    first. */}
                <Button type="button" variant="outline" size="sm" disabled={isPending}>
                  <UserRound size={14} aria-hidden="true" />
                  {card.assigneeName ?? "Unassigned"}
                  <ChevronDown size={14} aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
                <AssigneeMenuItems
                  members={members}
                  assigneeId={card.assigneeId}
                  // The refetch, so this panel's own copy of the card catches
                  // up. The board behind it is refreshed by the workspace
                  // either way.
                  onAssign={(assigneeId) => onAssign(card, assigneeId, () => void refresh())}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <UserRound size={14} aria-hidden="true" />
              {card.assigneeName ?? "Unassigned"}
            </span>
          )}

          {canEditTasks ? (
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" disabled={isPending}>
                    <MoreHorizontal size={16} aria-hidden="true" />
                    <span className="sr-only">More actions for this task</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setIsEditing(true)} disabled={!detail}>
                    <Pencil size={14} aria-hidden="true" />
                    Edit title, description and assignee
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => onDelete(card)}>
                    <Trash2 size={14} aria-hidden="true" />
                    Delete task
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>

        <div className="mt-6 space-y-6">
          <section aria-labelledby="task-panel-effort">
            <h3 id="task-panel-effort" className="text-sm font-semibold text-foreground">
              Effort
            </h3>

            {/* THE SAME SENTENCE THE CARD READS OUT, from the same function,
                so the panel and the card it was opened from cannot word one
                fact two ways. The figures are the accessible version; the
                bar is decoration over them, which is why it is hidden from
                assistive tech. */}
            <p className="mt-1 text-sm text-muted-foreground">
              {describeTaskEffort(card.estimateMinutes, card.loggedMinutes).full}
            </p>

            {rollup.percentUsed !== null ? (
              <div aria-hidden="true" className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", rollup.isOverBudget ? "bg-destructive" : "bg-primary")}
                  style={{ width: `${rollup.barPercent}%` }}
                />
              </div>
            ) : null}

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
            {/* NO EDIT BUTTON HERE ANY MORE. It edits the title and the
                assignee as well as the description, so sitting in this
                heading it was the one control whose scope was wider than
                the section it was in. It is in the header menu, which is
                where a control over the whole card belongs. */}
            <h3 id="task-panel-description" className="text-sm font-semibold text-foreground">
              Description
            </h3>

            {isLoading ? (
              <p className="mt-1 text-sm text-muted-foreground">Loading…</p>
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
              <p className="mt-1 text-sm text-muted-foreground">Loading…</p>
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
              <p className="mt-1 text-sm text-muted-foreground">Loading…</p>
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
        pendingLabel="Deleting…"
        isPending={deletingEntryId !== null}
        onConfirm={() => {
          if (deletingEntry) deleteEntry(deletingEntry);
          setDeletingEntry(null);
        }}
      />
    </Sheet>
  );
}
