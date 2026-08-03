"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { FormDialog } from "@/components/form/form-dialog";
import { FormInputField } from "@/components/form/form-input-field";
import { FormSwitchField } from "@/components/form/form-switch-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";

import { createEnquiryCategoryAction, updateEnquiryCategoryAction } from "../admin-enquiry-categories.actions";
import {
  CreateEnquiryCategoryRequestDTO,
  createEnquiryCategorySchema,
  EnquiryCategoryResponseDTO,
} from "../admin-enquiry-categories.types";

type FormValues = CreateEnquiryCategoryRequestDTO;

const toDefaultValues = (enquiryCategory: EnquiryCategoryResponseDTO | null): FormValues => ({
  name: enquiryCategory?.name ?? "",
  isActive: enquiryCategory?.isActive ?? true,
  orderBy: enquiryCategory?.orderBy ?? 1,
});

type Props = {
  enquiryCategory: EnquiryCategoryResponseDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// -------------------------------------------------------------------
// Enquiry category form dialog (create + edit)
// -------------------------------------------------------------------
export function AdminEnquiryCategoriesFormDialog({ enquiryCategory, open, onOpenChange }: Props) {
  const isEditing = !!enquiryCategory;

  const form = useForm<FormValues>({
    resolver: zodResolver(createEnquiryCategorySchema),
    mode: "onTouched",
    defaultValues: toDefaultValues(enquiryCategory),
  });

  // No early return for the create instance: it is not remounted between opens,
  // so it relies on this to come back empty.
  useEffect(() => {
    form.reset(toDefaultValues(enquiryCategory));
  }, [enquiryCategory, open, form]);

  const { isPending, submit } = useFormDialogSubmit<FormValues>({ form, onOpenChange });

  const onSubmit = (values: FormValues) =>
    submit(
      values,
      () =>
        isEditing
          ? updateEnquiryCategoryAction({ id: enquiryCategory.id, ...values })
          : createEnquiryCategoryAction(values),
      isEditing ? "Enquiry category updated" : "Enquiry category created",
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => form.reset(toDefaultValues(enquiryCategory))}
      title={isEditing ? "Edit enquiry category" : "Add enquiry category"}
      description={isEditing ? "Update this enquiry category" : "Add a new enquiry category"}
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel={isEditing ? "Save changes" : "Create category"}
      canSubmit={form.formState.isValid}
      isPending={isPending}
    >
      <FormInputField
        control={form.control}
        name="name"
        label="Name"
        placeholder="e.g. General enquiry"
        description="Shown in the category dropdown on the public enquiry form."
      />

      <FormInputField
        control={form.control}
        name="orderBy"
        label="Order (1 = top)"
        type="number"
        inputMode="numeric"
        min={1}
        max={50}
        placeholder="e.g. 1"
        transformValue={(e) => (e.target.value === "" ? undefined : e.target.valueAsNumber)}
      />

      <FormSwitchField control={form.control} name="isActive" label="Active" />
    </FormDialog>
  );
}
