"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";

import { FormDialog } from "@/components/form/form-dialog";
import { FormInputField } from "@/components/form/form-input-field";
import { FormTextareaField } from "@/components/form/form-textarea-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";
import { todayInAppZone } from "@/lib/timezone";

import { logTimeAction } from "../delivery-time.actions";
import {
  MAX_ENTRY_HOURS,
  NOTE_MAX_CHARS,
  formatMinutesAsClock,
  isCalendarDate,
  type TaskCardDTO,
} from "../delivery.types";

// -------------------------------------------------------------------
// BoardLogTimeDialog
//
// An hour against a card, from the board.
//
// YOUR OWN TIME, ALWAYS. There is no person field here and there is none in
// LogTimeSchema either - the owner is resolved from the session in the
// service, so nothing a caller sends can name somebody else. That is why
// the dialog says whose time it is rather than asking.
//
// THE DAY IS A 'YYYY-MM-DD' STRING from a date input, start to finish. No
// Date is constructed from it, here or anywhere downstream: the column is a
// Postgres DATE and the type parser hands it back as a string on purpose.
//
// TODAY IS DERIVED IN THE APP ZONE, not from the browser's idea of the day
// and not from `new Date()` on the server. It is the default and the
// maximum, because the service refuses a future work date in that same zone
// - and being told "that day has not happened yet" at nine in the evening,
// on the day you are sitting in, is exactly the failure the app zone exists
// to prevent.
// -------------------------------------------------------------------

const hoursField = z
  .string()
  .trim()
  .refine((value) => value.length > 0 && Number.isFinite(Number(value)), "Enter a number of hours")
  .refine((value) => Number(value) > 0, "Enter at least a minute")
  .refine((value) => Number(value) <= MAX_ENTRY_HOURS, `One entry cannot be longer than ${MAX_ENTRY_HOURS} hours`);

// Built per open rather than at module load: a tab left open overnight would
// otherwise keep yesterday as its maximum.
function buildSchema(today: string) {
  return z.object({
    workDate: z
      .string()
      .refine(isCalendarDate, "Use a date like 2026-07-01")
      .refine((value) => value <= today, "That day has not happened yet"),
    hours: hoursField,
    notes: z.string().trim().max(NOTE_MAX_CHARS),
  });
}

type LogTimeFormValues = {
  workDate: string;
  hours: string;
  notes: string;
};

export function BoardLogTimeDialog({
  open,
  onOpenChange,
  task,
  yourName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TaskCardDTO;
  /** Named so it is never in doubt whose timesheet this lands on. */
  yourName: string;
}) {
  const today = todayInAppZone();

  const form = useForm<LogTimeFormValues>({
    resolver: zodResolver(buildSchema(today)),
    mode: "onChange",
    defaultValues: { workDate: today, hours: "", notes: "" },
  });

  // A different card, or a second entry against the same one, starts clean -
  // with today back in the date box.
  useEffect(() => {
    form.reset({ workDate: today, hours: "", notes: "" });
  }, [task.id, open, today, form]);

  const { isPending, submit } = useFormDialogSubmit<LogTimeFormValues>({ form, onOpenChange });

  const onSubmit = (values: LogTimeFormValues) =>
    submit(
      values,
      () =>
        logTimeAction({
          taskId: task.id,
          workDate: values.workDate,
          // HOURS. LogTimeSchema rounds it to the nearest minute.
          hours: Number(values.hours),
          notes: values.notes.length > 0 ? values.notes : null,
        }),
      "Time logged",
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => form.reset({ workDate: today, hours: "", notes: "" })}
      title="Log time"
      description={`Against "${task.title}", on your own timesheet as ${yourName}.`}
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel="Log time"
      pendingLabel="Logging..."
      canSubmit={form.formState.isValid}
      isPending={isPending}
    >
      <p className="text-sm text-muted-foreground">
        {task.estimateMinutes > 0
          ? `${formatMinutesAsClock(task.loggedMinutes)} logged of ${formatMinutesAsClock(task.estimateMinutes)} estimated.`
          : `${formatMinutesAsClock(task.loggedMinutes)} logged. This task has no estimate.`}
      </p>

      <FormInputField control={form.control} name="workDate" label="Day" type="date" max={today} />

      <FormInputField
        control={form.control}
        name="hours"
        label="Hours"
        type="number"
        min={0}
        step="0.25"
        inputMode="decimal"
        placeholder="e.g. 1.5"
        description="1.5 is an hour and a half. Stored to the nearest minute."
      />

      <FormTextareaField
        control={form.control}
        name="notes"
        label="Notes"
        placeholder="What you did"
        maxLength={NOTE_MAX_CHARS}
      />
    </FormDialog>
  );
}
