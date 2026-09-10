"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";

import { FormDialog } from "@/components/form/form-dialog";
import { FormInputField } from "@/components/form/form-input-field";
import { FormSelectField } from "@/components/form/form-select-field";
import { FormTextareaField } from "@/components/form/form-textarea-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";
import { TASK_COLUMNS, TASK_COLUMN_LABELS, TASK_COLUMN_ORDER, type TaskColumn } from "@/lib/data/kysely-database-types";

import { createTaskAction } from "../delivery-board.actions";
import {
  DESCRIPTION_MAX_CHARS,
  MAX_PLANNED_HOURS,
  TASK_TITLE_MAX_CHARS,
  type ProjectMemberDTO,
} from "../delivery.types";
import type { BoardPhaseOption } from "./board-task-card";

// -------------------------------------------------------------------
// BoardTaskDialog
//
// Add a card. Lead or admin only, which the caller decides from
// `canEditTasks` off the board DTO - this dialog is never rendered for
// anybody else, and the service refuses it a second time regardless.
//
// HOURS IN, MINUTES STORED, converted ONCE by CreateTaskSchema on the way
// through the action. The field is called `estimateHours` on both sides for
// exactly that reason: nothing in this file multiplies by sixty, and
// nothing downstream ever handles a fractional hour.
//
// THE FORM HAS ITS OWN SCHEMA, as every dialog in this codebase does. The
// server schema coerces, so its input type widens to `unknown` and would
// type-check nothing here; this one describes what the CONTROLS hold -
// strings out of a number box - and the action re-validates the real thing.
//
// NO ESTIMATE FIELD AFTER CREATION, which is why this dialog only creates.
// A later change to an estimate belongs in the append-only log and is its
// own mutation; an edit form carrying one would leave the current figure
// right and the record of how it got there missing.
// -------------------------------------------------------------------

// The sentinel for "nobody yet". Radix Select has no empty-string value, and
// an unassigned card is the ordinary state of a task nobody has picked up.
const UNASSIGNED = "unassigned";

const hoursField = z
  .string()
  .trim()
  .refine((value) => value.length > 0 && Number.isFinite(Number(value)), "Enter a number of hours")
  .refine((value) => Number(value) >= 0, "Hours cannot be negative")
  .refine((value) => Number(value) <= MAX_PLANNED_HOURS, `Please enter no more than ${MAX_PLANNED_HOURS} hours`);

const TaskFormSchema = z.object({
  phaseId: z.string().min(1, "Choose a phase"),
  boardColumn: z.enum(TASK_COLUMNS),
  title: z.string().trim().min(1, "A task needs a title").max(TASK_TITLE_MAX_CHARS),
  description: z.string().trim().max(DESCRIPTION_MAX_CHARS),
  estimateHours: hoursField,
  assigneeId: z.string(),
});

type TaskFormValues = z.infer<typeof TaskFormSchema>;

const toFormValues = (phaseId: string, boardColumn: TaskColumn): TaskFormValues => ({
  phaseId,
  boardColumn,
  title: "",
  description: "",
  estimateHours: "",
  assigneeId: UNASSIGNED,
});

export function BoardTaskDialog({
  open,
  onOpenChange,
  phaseId,
  boardColumn,
  phases,
  members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the person pressed Add, so the card appears where they were looking. */
  phaseId: string;
  boardColumn: TaskColumn;
  phases: readonly BoardPhaseOption[];
  /** Only project members may be assigned - the service refuses anybody else. */
  members: readonly ProjectMemberDTO[];
}) {
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(TaskFormSchema),
    mode: "onChange",
    defaultValues: toFormValues(phaseId, boardColumn),
  });

  // Reopening from a different column has to bring that column with it,
  // which a form initialised once would not.
  useEffect(() => {
    form.reset(toFormValues(phaseId, boardColumn));
  }, [phaseId, boardColumn, open, form]);

  const { isPending, submit } = useFormDialogSubmit<TaskFormValues>({ form, onOpenChange });

  const onSubmit = (values: TaskFormValues) =>
    submit(
      values,
      () =>
        createTaskAction({
          phaseId: values.phaseId,
          title: values.title,
          // An empty box means nothing was written, which is null rather than
          // an empty string - the schema says the same thing on the way in.
          description: values.description.length > 0 ? values.description : null,
          // HOURS. CreateTaskSchema turns this into minutes.
          estimateHours: Number(values.estimateHours),
          assigneeId: values.assigneeId === UNASSIGNED ? undefined : values.assigneeId,
          boardColumn: values.boardColumn,
        }),
      "Task added",
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => form.reset(toFormValues(phaseId, boardColumn))}
      title="Add a task"
      description="It lands in the phase and column you choose. The estimate is in hours."
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel="Add task"
      pendingLabel="Adding…"
      canSubmit={form.formState.isValid}
      isPending={isPending}
    >
      <FormInputField
        control={form.control}
        name="title"
        label="Title"
        maxLength={TASK_TITLE_MAX_CHARS}
        placeholder="e.g. Draft the migration plan"
      />

      <FormTextareaField
        control={form.control}
        name="description"
        label="Description"
        placeholder="What this task covers"
        maxLength={DESCRIPTION_MAX_CHARS}
      />

      <FormInputField
        control={form.control}
        name="estimateHours"
        label="Estimate (hours)"
        type="number"
        min={0}
        step="0.25"
        inputMode="decimal"
        placeholder="e.g. 8"
        description="Stored to the nearest minute, so 1.5 is an hour and a half."
      />

      <FormSelectField
        control={form.control}
        name="phaseId"
        label="Phase"
        options={phases.map((phase) => ({ value: phase.phaseId, label: phase.phaseName }))}
      />

      <FormSelectField
        control={form.control}
        name="boardColumn"
        label="Column"
        options={TASK_COLUMN_ORDER.map((column) => ({ value: column, label: TASK_COLUMN_LABELS[column] }))}
      />

      <FormSelectField
        control={form.control}
        name="assigneeId"
        label="Assignee"
        options={[
          { value: UNASSIGNED, label: "Unassigned" },
          ...members.map((member) => ({
            value: member.userId,
            // The email is what tells two people with the same name apart,
            // which is why the DTO carries it.
            label: member.name ?? member.email ?? "Unnamed member",
          })),
        ]}
        description="Only people on this project can be assigned work."
      />
    </FormDialog>
  );
}
