"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { FormDialog } from "@/components/form/form-dialog";
import { FormInputField } from "@/components/form/form-input-field";
import { FormSwitchField } from "@/components/form/form-switch-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";

import {
  CreateNotificationTypeRequestDTO,
  createNotificationTypeSchema,
  NotificationTypeResponseDTO,
} from "../admin-notification-types.types";
import { createNotificationTypeAction, updateNotificationTypeAction } from "../admin-notification-types.actions";

type FormValues = CreateNotificationTypeRequestDTO;

const toDefaultValues = (notificationType: NotificationTypeResponseDTO | null): FormValues => ({
  name: notificationType?.name ?? "",
  description: notificationType?.description ?? "",
  isActive: notificationType?.isActive ?? true,
  orderBy: notificationType?.orderBy ?? 1,
});

type Props = {
  notificationType: NotificationTypeResponseDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AdminNotificationTypesFormDialog({ notificationType, open, onOpenChange }: Props) {
  const isEditing = !!notificationType;

  const form = useForm<FormValues>({
    resolver: zodResolver(createNotificationTypeSchema),
    mode: "onTouched",
    defaultValues: toDefaultValues(notificationType),
  });

  // No early return for the create instance: it is not remounted between opens,
  // so it relies on this to come back empty.
  useEffect(() => {
    form.reset(toDefaultValues(notificationType));
  }, [notificationType, open, form]);

  const { isPending, submit } = useFormDialogSubmit<FormValues>({ form, onOpenChange });

  const onSubmit = (values: FormValues) =>
    submit(
      values,
      () =>
        isEditing
          ? updateNotificationTypeAction({ id: notificationType.id, ...values })
          : createNotificationTypeAction(values),
      isEditing ? "Notification type updated" : "Notification type created",
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => form.reset(toDefaultValues(notificationType))}
      title={isEditing ? "Edit notification type" : "Add notification type"}
      description={
        isEditing
          ? "Rename or reorder this type. Its internal key stays the same."
          : "Add a new notification category for the send and template pickers."
      }
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel={isEditing ? "Save changes" : "Create notification type"}
      canSubmit={form.formState.isValid}
      isPending={isPending}
    >
      <FormInputField control={form.control} name="name" label="Name" placeholder="e.g. Events" />

      <FormInputField
        control={form.control}
        name="description"
        label="Description"
        placeholder="e.g. Event announcements and open days"
        description="Shown to clients as helper text under this option. Optional."
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
