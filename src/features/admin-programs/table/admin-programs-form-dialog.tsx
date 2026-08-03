"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";

import { FormDialog } from "@/components/form/form-dialog";
import { FormInputField } from "@/components/form/form-input-field";
import { FormSwitchField } from "@/components/form/form-switch-field";
import { FormTextareaField } from "@/components/form/form-textarea-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";

import { MESSAGES } from "@/lib/constants";

import { createProgramAction, updateProgramAction } from "../admin-programs.actions";
import { ProgramResponseDTO } from "../admin-programs.types";

// -------------------------------------------------------------------
// Client form schema. Mirrors the server schema in admin-programs.types so
// the same rules are enforced either side; the server one is authoritative.
// -------------------------------------------------------------------
const ProgramFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000),
  isActive: z.boolean(),
});

type ProgramFormValues = z.infer<typeof ProgramFormSchema>;

const toFormValues = (program: ProgramResponseDTO | null): ProgramFormValues => ({
  name: program?.name ?? "",
  description: program?.description ?? "",
  isActive: program?.isActive ?? true,
});

type Props = {
  program: ProgramResponseDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// -------------------------------------------------------------------
// Admin Programs Form Dialog (create + edit)
// -------------------------------------------------------------------
export function AdminProgramsFormDialog({ program, open, onOpenChange }: Props) {
  const isEditing = !!program;

  const form = useForm<ProgramFormValues>({
    resolver: zodResolver(ProgramFormSchema),
    mode: "onChange",
    defaultValues: toFormValues(program),
  });

  useEffect(() => {
    form.reset(toFormValues(program));
  }, [program, open, form]);

  const { isPending, submit } = useFormDialogSubmit<ProgramFormValues>({ form, onOpenChange });

  const onSubmit = (values: ProgramFormValues) =>
    submit(
      values,
      () => (isEditing ? updateProgramAction({ id: program.id, ...values }) : createProgramAction(values)),
      isEditing ? MESSAGES.PROGRAM_UPDATED : MESSAGES.PROGRAM_CREATED,
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => form.reset(toFormValues(program))}
      title={isEditing ? "Edit Program" : "Add Program"}
      description={isEditing ? "Update this program's details" : "Create a new program for classes to run under"}
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel={isEditing ? "Save changes" : "Create program"}
      canSubmit={form.formState.isValid}
      isPending={isPending}
    >
      <FormInputField control={form.control} name="name" label="Name" placeholder="e.g. Foundation Course" />

      <FormTextareaField
        control={form.control}
        name="description"
        label="Description"
        placeholder="What this program is about"
      />

      <FormSwitchField control={form.control} name="isActive" label="Active" />
    </FormDialog>
  );
}
