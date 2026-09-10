"use client";

import { useState, useTransition } from "react";

import { ArrowLeftRight, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { AppDialog } from "@/components/app-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { adjustTaskEstimateAction } from "../delivery-time.actions";
import { NOTE_MAX_CHARS, formatMinutesAsClock, hoursToMinutes } from "../delivery.types";
import type { TimesheetProjectOption, TimesheetTaskOption } from "./timesheet-catalogue";

// -------------------------------------------------------------------
// ===================================================================
// MOVING AN ESTIMATE, IN TWO FORMS THAT MUST NEVER BE MISTAKEN FOR EACH
// OTHER
// ===================================================================
//
// The service takes both under one schema, and they are two different acts:
//
//   `project`  - the project's TOTAL changes. Hours appear that were not
//                budgeted before, or go away. The client's plan is bigger or
//                smaller than it was this morning.
//   `transfer` - the total does NOT change. Hours move out of one task and
//                into another, which is how an overrun gets absorbed and is
//                exactly why estimate_changes records where they came from.
//
// One grows a budget and the other rearranges it. So they are two TABS
// rather than one form with a dropdown, each says in a sentence what it is
// about to do BEFORE the button is pressed, and the sentence is built from
// the same numbers the request carries. A form where the difference is a
// select somebody skimmed past is how a project quietly gains forty hours.
//
// THE ARITHMETIC IS FINISHED BEFORE IT IS SHOWN. `formatMinutesAsClock`
// renders the figures and the schema converts the hours somebody typed into
// minutes at the boundary. Nothing here multiplies by sixty.
//
// LEAD OR ADMINISTRATOR ONLY, and this component does not decide that: the
// caller renders it only when `canEditTasks` - the server's own answer, off
// the board read - is true, and the service checks again on the write. Both
// are needed. A screen that offers a button the server refuses is as bad as
// one that hides a button it would have allowed.
//
// USED FROM THE TIMESHEET AND FROM THE BOARD, which is why it is no longer
// called TimesheetEstimateDialog. It was reachable only from the timesheet,
// so changing what a card was expected to take meant leaving the board -
// which is where somebody is standing when they find out it will take
// longer. Its props are still the catalogue's shapes: the board folds its
// own single project into one through buildTimesheetCatalogue, so both
// callers describe a task to it the same way.
// -------------------------------------------------------------------

type EstimateMode = "project" | "transfer";

const HOURS_STEP = "0.25";

export function EstimateAdjustDialog({
  project,
  task,
  onOpenChange,
  onAdjusted,
}: {
  project: TimesheetProjectOption;
  task: TimesheetTaskOption;
  onOpenChange: (open: boolean) => void;
  onAdjusted: () => void;
}) {
  const [mode, setMode] = useState<EstimateMode>("project");
  // Add to this task, or take off it. A positive number in the box either
  // way: expecting somebody to type "-2" to remove two hours is how a
  // reduction gets entered as an increase.
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [hours, setHours] = useState("");
  const [fromTaskId, setFromTaskId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const typedHours = Number(hours);
  const hasHours = hours.trim().length > 0 && Number.isFinite(typedHours) && typedHours > 0;

  // Every other task on the SAME project, which is the only place minutes
  // may come from - they cannot cross between clients' budgets, and the
  // service refuses it in one sentence whether the task is on another
  // project or does not exist.
  const sourcePhases = project.phases
    .map((phase) => ({
      phaseId: phase.phaseId,
      name: phase.name,
      tasks: phase.tasks.filter((candidate) => candidate.taskId !== task.taskId),
    }))
    .filter((phase) => phase.tasks.length > 0);

  const sourceTask =
    sourcePhases.flatMap((phase) => phase.tasks).find((candidate) => candidate.taskId === fromTaskId) ?? null;

  const canSubmit = hasHours && (mode === "project" || sourceTask !== null);

  const submit = () =>
    startTransition(async () => {
      setHoursError(null);

      try {
        const response = await adjustTaskEstimateAction(
          mode === "project"
            ? {
                source: "project",
                taskId: task.taskId,
                // SIGNED on this branch, and the sign is the whole decision:
                // the box holds a positive number and the choice above it is
                // what makes it a reduction.
                hours: direction === "add" ? typedHours : -typedHours,
                reason,
              }
            : {
                source: "transfer",
                taskId: task.taskId,
                // Narrowed by canSubmit, which is what the button is gated
                // on. The fallback keeps the request a valid shape rather
                // than sending an empty id the schema would refuse anyway.
                fromTaskId: sourceTask?.taskId ?? "",
                hours: typedHours,
                reason,
              },
        );

        if (!response.success) {
          const fieldError = response.fieldErrors?.hours?.[0] ?? null;

          setHoursError(fieldError);

          // The refusals worth reading are the service's own: a source task
          // that has less than was asked for, an archived project, somebody
          // who is not a lead. Each names the figure or the rule.
          if (!fieldError) {
            toast.error(response.fieldErrors?.fromTaskId?.[0] ?? response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          }

          return;
        }

        toast.success(mode === "project" ? "Estimate adjusted" : "Hours moved");
        onAdjusted();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  // FOR THE SENTENCE ONLY. What is SENT is the number as typed, and
  // AdjustTaskEstimateSchema converts it at the boundary - this is the same
  // exported conversion the schema uses, so the figure somebody reads before
  // pressing the button is the figure that gets written, rounding and all.
  const amount = hasHours ? formatMinutesAsClock(hoursToMinutes(typedHours)) : null;

  return (
    <AppDialog
      open
      onOpenChange={onOpenChange}
      title="Adjust the estimate"
      description="Estimate changes are recorded against the project, with who made them and why."
      contentClassName="sm:max-w-xl"
    >
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <p className="text-sm font-medium text-foreground">{task.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {project.clientName} - {project.title} - {task.phaseName}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Estimated at{" "}
          <span className="font-medium figure text-foreground">{formatMinutesAsClock(task.estimateMinutes)}</span>
          , with{" "}
          <span className="font-medium figure text-foreground">{formatMinutesAsClock(task.loggedMinutes)}</span>{" "}
          logged against it.
        </p>
      </div>

      <Tabs
        value={mode}
        onValueChange={(value) => {
          setMode(value as EstimateMode);
          setHoursError(null);
        }}
      >
        <TabsList className="w-full">
          <TabsTrigger value="project">Change the project total</TabsTrigger>
          <TabsTrigger value="transfer">Move hours from another task</TabsTrigger>
        </TabsList>

        <TabsContent value="project" className="space-y-5 pt-4">
          <div className="grid gap-2">
            <Label htmlFor="timesheet-estimate-direction">What is happening</Label>
            <Select value={direction} onValueChange={(value) => setDirection(value as "add" | "remove")}>
              <SelectTrigger id="timesheet-estimate-direction" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="add">Add hours to this task</SelectItem>
                <SelectItem value="remove">Take hours off this task</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <EstimateConsequence
            tone={direction === "add" ? "grow" : "shrink"}
            headline={
              direction === "add"
                ? `The project's total estimate GROWS by ${amount ?? "the hours you enter"}.`
                : `The project's total estimate SHRINKS by ${amount ?? "the hours you enter"}.`
            }
            detail={
              direction === "add"
                ? "The hours come from nowhere else. This project is planned to take longer than it was before."
                : `Nothing else gains them. This task has ${formatMinutesAsClock(task.estimateMinutes)} estimated, and cannot go below nothing.`
            }
          />
        </TabsContent>

        <TabsContent value="transfer" className="space-y-5 pt-4">
          <div className="grid gap-2">
            <Label htmlFor="timesheet-estimate-source">Take the hours from</Label>
            <Select
              value={fromTaskId ?? ""}
              disabled={sourcePhases.length === 0}
              onValueChange={(value) => setFromTaskId(value)}
            >
              <SelectTrigger id="timesheet-estimate-source" className="w-full">
                <SelectValue placeholder="Choose a task on this project" />
              </SelectTrigger>
              <SelectContent>
                {/* Grouped by phase, because the hours routinely come from
                    another part of the job rather than the one in hand. */}
                {sourcePhases.map((phase) => (
                  <SelectGroup key={phase.phaseId}>
                    <SelectLabel>{phase.name}</SelectLabel>
                    {phase.tasks.map((candidate) => (
                      <SelectItem key={candidate.taskId} value={candidate.taskId}>
                        {candidate.title} ({formatMinutesAsClock(candidate.estimateMinutes)})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            {sourcePhases.length === 0 && (
              <p className="text-sm text-muted-foreground">
                This is the only task on the project, so there is nowhere for the hours to come from.
              </p>
            )}
          </div>

          <EstimateConsequence
            tone="move"
            headline={
              sourceTask
                ? `${amount ?? "The hours you enter"} move from "${sourceTask.title}" to "${task.title}".`
                : "Hours move from one task on this project to this one."
            }
            detail={
              sourceTask
                ? `The project's total estimate does NOT change. "${sourceTask.title}" is estimated at ${formatMinutesAsClock(sourceTask.estimateMinutes)} and cannot give away more than that.`
                : "The project's total estimate does not change. Only the split between two tasks does."
            }
          />
        </TabsContent>
      </Tabs>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="space-y-5"
      >
        <div className="grid gap-2">
          <Label htmlFor="timesheet-estimate-hours">Hours</Label>
          <Input
            id="timesheet-estimate-hours"
            type="number"
            inputMode="decimal"
            step={HOURS_STEP}
            min={0}
            placeholder="e.g. 4"
            value={hours}
            onChange={(event) => setHours(event.target.value)}
            aria-invalid={hoursError !== null}
            aria-describedby={hoursError ? "timesheet-estimate-hours-error" : undefined}
            className="figure"
          />
          {hoursError && (
            <p id="timesheet-estimate-hours-error" className="text-sm text-destructive">
              {hoursError}
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="timesheet-estimate-reason">Why (optional)</Label>
          <Textarea
            id="timesheet-estimate-reason"
            value={reason}
            maxLength={NOTE_MAX_CHARS}
            placeholder="The change of scope, or where the extra work came from"
            onChange={(event) => setReason(event.target.value)}
            className="min-h-20"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending || !canSubmit} loading={isPending}>
            {isPending
              ? "Saving..."
              : mode === "project"
                ? direction === "add"
                  ? "Add to the estimate"
                  : "Take off the estimate"
                : "Move the hours"}
          </Button>
        </div>
      </form>
    </AppDialog>
  );
}

// -------------------------------------------------------------------
// The sentence that says what the button is about to do.
//
// It is a PANEL rather than help text under a field, and it changes shape
// with the choice above it, because the two acts have different consequences
// for a budget and the difference has to be visible without reading. Tokens
// only: the growth case is tinted with the accent this app is themed on, and
// the transfer case is quiet, so rebranding stays a one-file change.
// -------------------------------------------------------------------
function EstimateConsequence({
  tone,
  headline,
  detail,
}: {
  tone: "grow" | "shrink" | "move";
  headline: string;
  detail: string;
}) {
  return (
    <div
      className={
        tone === "move"
          ? "flex gap-3 rounded-lg border border-border bg-muted/40 p-3"
          : "flex gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3"
      }
    >
      <span className="mt-0.5 text-muted-foreground" aria-hidden="true">
        {tone === "grow" ? (
          <TrendingUp size={18} />
        ) : tone === "shrink" ? (
          <TrendingDown size={18} />
        ) : (
          <ArrowLeftRight size={18} />
        )}
      </span>
      <div>
        <p className="text-sm font-medium text-foreground">{headline}</p>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
