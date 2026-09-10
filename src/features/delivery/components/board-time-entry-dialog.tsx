"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";

import { FormDialog } from "@/components/form/form-dialog";
import { FormInputField } from "@/components/form/form-input-field";
import { FormTextareaField } from "@/components/form/form-textarea-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";

import { updateTimeEntryAction } from "../delivery-time.actions";
import {
  MAX_ENTRY_HOURS,
  NOTE_MAX_CHARS,
  minutesToHours,
  type TimeEntryDTO,
  type UpdateTimeEntryRequestDTO,
} from "../delivery.types";

// -------------------------------------------------------------------
// BoardTimeEntryDialog
//
// Correct one entry: the day it was worked, how long it took, what it was.
//
// WHO MAY OPEN IT is decided by the caller from the entry's own `userId`
// against the viewer's, or from `canEditTasks` - which is the same rule
// requireEntryControl applies on the server ("your own time, or a lead's
// call"). The service refuses again regardless; the check here is so people
// are not offered a button that will tell them no.
//
// -------------------------------------------------------------------
// IT POSTS ONLY WHAT CHANGED, AND THE DAY IS THE REASON THAT MATTERS.
//
// UpdateTimeEntrySchema is a patch, and `workDate` absent means the day has
// not moved. The service reads exactly that: it re-resolves the captured
// RATE SNAPSHOT only when the date actually changes, because an hour moved
// from June to July is a July hour, priced at July's rate. An edit that
// restated the same date every time would re-price hours nobody moved -
// silently rewriting what past work was worth, on a save that only fixed a
// typo in a note.
//
// `notes` is the second reason, and it is the bug this dialog exists to not
// have: the schema used to REQUIRE it, so a form that did not carry the note
// posted an empty one over whatever was written. A note is what a client's
// invoice narrative is written from. Absent leaves it; '' clears it.
// -------------------------------------------------------------------

const TimeEntryFormSchema = z.object({
  workDate: z.string().min(1, "Choose a date"),
  hours: z
    .string()
    .trim()
    .refine((value) => value.length > 0 && Number.isFinite(Number(value)), "Enter a number of hours")
    .refine((value) => Number(value) > 0, "An entry has to be more than nothing")
    .refine((value) => Number(value) <= MAX_ENTRY_HOURS, `One entry cannot be longer than ${MAX_ENTRY_HOURS} hours`),
  notes: z.string().trim().max(NOTE_MAX_CHARS),
});

type TimeEntryFormValues = z.infer<typeof TimeEntryFormSchema>;

const toFormValues = (entry: TimeEntryDTO): TimeEntryFormValues => ({
  // Already 'YYYY-MM-DD', which is what a date input holds. It is a string
  // all the way down on purpose - see the calendar-date note in
  // delivery.types.ts - so nothing here constructs a Date and shifts it a
  // day by timezone.
  workDate: entry.workDate,
  hours: String(minutesToHours(entry.minutes)),
  notes: entry.notes ?? "",
});

export function BoardTimeEntryDialog({
  open,
  onOpenChange,
  entry,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: TimeEntryDTO;
  onSaved: () => void;
}) {
  const form = useForm<TimeEntryFormValues>({
    resolver: zodResolver(TimeEntryFormSchema),
    mode: "onChange",
    defaultValues: toFormValues(entry),
  });

  useEffect(() => {
    form.reset(toFormValues(entry));
  }, [entry, open, form]);

  const { isPending, submit } = useFormDialogSubmit<TimeEntryFormValues>({
    form,
    onOpenChange,
    onSuccess: onSaved,
  });

  const onSubmit = (values: TimeEntryFormValues) => {
    const initial = toFormValues(entry);

    // THE REQUEST DTO, NOT THE INPUT ONE, which is the convention every
    // dialog in this module follows and is worth the sentence. `hours` is
    // COERCED by the schema, and on a coerced field z.input widens to
    // `unknown` - so an Input-typed patch would type-check nothing at the
    // one boundary that exists to check something. The value assigned below
    // is still HOURS as typed; the action re-validates and the schema
    // converts to minutes once, there.
    const patch: UpdateTimeEntryRequestDTO = { timeEntryId: entry.id };

    // Absent unless the day genuinely moved - see the note above about the
    // rate snapshot.
    if (values.workDate !== initial.workDate) patch.workDate = values.workDate;

    // HOURS. The schema converts to minutes once, at the boundary.
    if (values.hours !== initial.hours) patch.hours = Number(values.hours);

    if (values.notes !== initial.notes) patch.notes = values.notes;

    return submit(values, () => updateTimeEntryAction(patch), "Time updated");
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => form.reset(toFormValues(entry))}
      title="Edit time"
      description="Only what you change is saved, so the note stays unless you clear it."
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel="Save changes"
      pendingLabel="Saving…"
      canSubmit={form.formState.isValid}
      isPending={isPending}
    >
      <FormInputField control={form.control} name="workDate" label="Date" type="date" />

      <FormInputField
        control={form.control}
        name="hours"
        label="Hours"
        type="number"
        min={0}
        step="0.25"
        inputMode="decimal"
        description="Stored to the nearest minute, so 1.5 is an hour and a half."
      />

      <FormTextareaField
        control={form.control}
        name="notes"
        label="Note"
        maxLength={NOTE_MAX_CHARS}
        placeholder="What this time went on"
        description="Clearing the box removes the note."
      />
    </FormDialog>
  );
}
