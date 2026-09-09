"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";

import { FormDialog } from "@/components/form/form-dialog";
import { FormInputField } from "@/components/form/form-input-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";

import { createPhaseAction, renamePhaseAction } from "../delivery-setup.actions";
import { PHASE_NAME_MAX_CHARS, type BoardPhaseDTO } from "../delivery.types";

// -------------------------------------------------------------------
// BoardPhaseDialog
//
// Add a phase, or rename one. Both are a single name, so both are this
// dialog - and which act it is comes from whether a phase was handed in
// rather than from a mode flag the caller has to keep in step.
//
// A PHASE IS A HEADING WITH AN ORDER, which is why there is nothing else on
// this form. A new one is appended; the order is changed from the phase
// menu, which sends the whole list.
//
// Deleting is NOT here. It is a confirmation rather than a form, and the
// service can refuse it in a sentence - a phase with time logged against it
// stays - so it belongs with the other confirmations in the workspace.
// -------------------------------------------------------------------

const PhaseFormSchema = z.object({
  name: z.string().trim().min(1, "A phase needs a name").max(PHASE_NAME_MAX_CHARS),
});

type PhaseFormValues = z.infer<typeof PhaseFormSchema>;

export function BoardPhaseDialog({
  open,
  onOpenChange,
  projectId,
  phase,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Null creates one; a phase renames that phase. */
  phase: BoardPhaseDTO | null;
}) {
  const form = useForm<PhaseFormValues>({
    resolver: zodResolver(PhaseFormSchema),
    mode: "onChange",
    defaultValues: { name: phase?.phaseName ?? "" },
  });

  useEffect(() => {
    form.reset({ name: phase?.phaseName ?? "" });
  }, [phase, open, form]);

  const { isPending, submit } = useFormDialogSubmit<PhaseFormValues>({ form, onOpenChange });

  const onSubmit = (values: PhaseFormValues) =>
    submit(
      values,
      () => (phase ? renamePhaseAction({ phaseId: phase.phaseId, name: values.name }) : createPhaseAction({ projectId, name: values.name })),
      phase ? "Phase renamed" : "Phase added",
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => form.reset({ name: phase?.phaseName ?? "" })}
      title={phase ? "Rename phase" : "Add a phase"}
      description={
        phase
          ? "The tasks in it stay where they are."
          : "A phase is a stage of the work. It gets its own board, with the same four columns."
      }
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel={phase ? "Save name" : "Add phase"}
      canSubmit={form.formState.isValid}
      isPending={isPending}
    >
      <FormInputField
        control={form.control}
        name="name"
        label="Name"
        maxLength={PHASE_NAME_MAX_CHARS}
        placeholder="e.g. Discovery"
      />
    </FormDialog>
  );
}
