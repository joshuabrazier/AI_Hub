"use client";

import { useState, useTransition } from "react";

import { toast } from "sonner";

import { AppDialog } from "@/components/app-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MESSAGES } from "@/lib/constants";
import { TASK_COLUMNS, TASK_COLUMN_LABELS } from "@/lib/data/kysely-database-types";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { addTimesheetRowAction } from "../delivery-time.actions";
import { type TimesheetWeekDTO } from "../delivery.types";
import type { TimesheetCatalogueDTO, TimesheetTaskOption } from "./timesheet-catalogue";

// -------------------------------------------------------------------
// ===================================================================
// ADD A ROW: PROJECT, THEN PHASE, THEN TASK
// ===================================================================
//
// Three pickers, each filtered by the one above it, because that is the
// order somebody holds the question in: which job, which part of it, which
// piece of work. Choosing a project again clears the phase and the task
// rather than leaving a stale pair that belongs to a different project - a
// task id from the previous choice would be refused by the service, but
// only after somebody had pressed Add.
//
// TASKS ALREADY ON THE WEEK ARE LEFT OUT. A row exists once, so offering a
// task that is already a row would either duplicate it on screen or appear
// to do nothing. When that empties a phase the picker says so, rather than
// opening onto a list with nothing in it.
//
// A DONE TASK IS STILL OFFERED, and labelled. Writing up on Monday what was
// finished on Friday is ordinary, and a picker that hides finished work
// makes an honest timesheet impossible to fill in.
//
// THE ADD ITSELF STORES NOTHING - see addTimesheetRowService, which writes
// no row and exists for the authorisation. It is called anyway rather than
// adding the row client-side, because it is the only thing that will say
// "you are not on that project" out loud instead of dropping the row when
// the week is next read.
// -------------------------------------------------------------------

export function TimesheetAddRowDialog({
  open,
  week,
  catalogue,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  week: TimesheetWeekDTO;
  catalogue: TimesheetCatalogueDTO;
  onOpenChange: (open: boolean) => void;
  // The task that was added. The parent is what holds the browser-side list
  // of empty rows, so it stores the id and re-reads the week.
  onAdded: (taskId: string) => void;
}) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [phaseId, setPhaseId] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const project = catalogue.projects.find((candidate) => candidate.projectId === projectId) ?? null;
  const phase = project?.phases.find((candidate) => candidate.phaseId === phaseId) ?? null;

  // Already a row, whether it has time on it or was added earlier in this
  // same session.
  const onTheWeek = new Set(week.rows.map((row) => row.taskId));

  const selectableTasks: TimesheetTaskOption[] = (phase?.tasks ?? []).filter((task) => !onTheWeek.has(task.taskId));

  const reset = () => {
    setProjectId(null);
    setPhaseId(null);
    setTaskId(null);
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const submit = () =>
    startTransition(async () => {
      if (!taskId) return;

      try {
        const response = await addTimesheetRowAction({
          taskId,
          weekStart: week.weekStart,
          weekStartsOn: week.weekStartsOn,
        });

        if (!response.success) {
          // The service refuses in a sentence here rather than dropping the
          // row silently, because somebody asked for it - an archived
          // project, or one they are not a member of.
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);

          return;
        }

        onAdded(response.data.taskId);
        reset();
        onOpenChange(false);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title="Add a task to this week"
      description="The row appears with no time on it. Click a day to fill it in."
    >
      {catalogue.projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You are not a member of any project yet, so there is nothing to add. An administrator adds people to a
          project.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="space-y-5"
        >
          <div className="grid gap-2">
            <Label htmlFor="timesheet-add-project">Project</Label>
            <Select
              value={projectId ?? ""}
              onValueChange={(value) => {
                setProjectId(value);
                // A phase and a task from the previous project mean nothing
                // here, so they go rather than being carried over.
                setPhaseId(null);
                setTaskId(null);
              }}
            >
              <SelectTrigger id="timesheet-add-project" className="w-full">
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {catalogue.projects.map((option) => (
                  <SelectItem key={option.projectId} value={option.projectId}>
                    {option.clientName} - {option.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="timesheet-add-phase">Phase</Label>
            <Select
              value={phaseId ?? ""}
              disabled={project === null || project.phases.length === 0}
              onValueChange={(value) => {
                setPhaseId(value);
                setTaskId(null);
              }}
            >
              <SelectTrigger id="timesheet-add-phase" className="w-full">
                <SelectValue placeholder={project ? "Choose a phase" : "Choose a project first"} />
              </SelectTrigger>
              <SelectContent>
                {(project?.phases ?? []).map((option) => (
                  <SelectItem key={option.phaseId} value={option.phaseId}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {project && project.phases.length === 0 && (
              <p className="text-sm text-muted-foreground">
                This project has no phases yet, so it has no tasks to log time against.
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="timesheet-add-task">Task</Label>
            <Select
              value={taskId ?? ""}
              disabled={phase === null || selectableTasks.length === 0}
              onValueChange={setTaskId}
            >
              <SelectTrigger id="timesheet-add-task" className="w-full">
                <SelectValue placeholder={phase ? "Choose a task" : "Choose a phase first"} />
              </SelectTrigger>
              <SelectContent>
                {selectableTasks.map((option) => (
                  <SelectItem key={option.taskId} value={option.taskId}>
                    {option.title}
                    {option.boardColumn === TASK_COLUMNS.DONE
                      ? ` (${TASK_COLUMN_LABELS[TASK_COLUMNS.DONE]})`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {phase && selectableTasks.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {phase.tasks.length === 0
                  ? "This phase has no tasks on it yet."
                  : "Every task in this phase is already on this week."}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || taskId === null} loading={isPending}>
              {isPending ? "Adding…" : "Add the row"}
            </Button>
          </div>
        </form>
      )}
    </AppDialog>
  );
}
