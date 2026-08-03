"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";

import { FormDialog } from "@/components/form/form-dialog";
import { FormInputField } from "@/components/form/form-input-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";

import { MESSAGES } from "@/lib/constants";

import { createClosureDayAction } from "../admin-closure-days.actions";

// -------------------------------------------------------------------
// Client form schema
// -------------------------------------------------------------------
const ClosureDayFormSchema = z.object({
  dayDate: z.string().min(1, "Date is required"),
  reason: z.string().trim().min(1, "Enter a reason").max(200),
});

type ClosureDayFormValues = z.infer<typeof ClosureDayFormSchema>;

const EMPTY_VALUES: ClosureDayFormValues = { dayDate: "", reason: "" };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// -------------------------------------------------------------------
// Add Closure Day dialog
// -------------------------------------------------------------------
export function ClosureDaysFormDialog({ open, onOpenChange }: Props) {
  const form = useForm<ClosureDayFormValues>({
    resolver: zodResolver(ClosureDayFormSchema),
    mode: "onChange",
    reValidateMode: "onChange",
    defaultValues: EMPTY_VALUES,
  });

  useEffect(() => {
    if (open) form.reset(EMPTY_VALUES);
  }, [open, form]);

  const { isPending, submit } = useFormDialogSubmit<ClosureDayFormValues>({ form, onOpenChange });

  const onSubmit = (values: ClosureDayFormValues) =>
    submit(values, () => createClosureDayAction(values), MESSAGES.CLOSURE_DAY_CREATED);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a closure day"
      description="Pick the date and give a reason members will see."
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel="Add day"
      canSubmit={form.formState.isValid}
      isPending={isPending}
    >
      <FormInputField control={form.control} name="dayDate" label="Date" type="date" />

      <FormInputField
        control={form.control}
        name="reason"
        label="Reason"
        placeholder="Shown to members on the schedule"
      />
    </FormDialog>
  );
}
