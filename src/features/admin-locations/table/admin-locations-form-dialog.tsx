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

import { createLocationAction, updateLocationAction } from "../admin-locations.actions";
import { LocationResponseDTO } from "../admin-locations.types";

// -------------------------------------------------------------------
// Client form schema
// -------------------------------------------------------------------
const LocationFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  address: z.string().trim().min(1, "Address is required").max(500),
  isActive: z.boolean(),
});

type LocationFormValues = z.infer<typeof LocationFormSchema>;

const toFormValues = (location: LocationResponseDTO | null): LocationFormValues => ({
  name: location?.name ?? "",
  address: location?.address ?? "",
  isActive: location?.isActive ?? true,
});

type Props = {
  location: LocationResponseDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// -------------------------------------------------------------------
// Admin Locations Form Dialog (create + edit)
// -------------------------------------------------------------------
export function AdminLocationsFormDialog({ location, open, onOpenChange }: Props) {
  const isEditing = !!location;

  const form = useForm<LocationFormValues>({
    resolver: zodResolver(LocationFormSchema),
    mode: "onChange",
    defaultValues: toFormValues(location),
  });

  useEffect(() => {
    form.reset(toFormValues(location));
  }, [location, open, form]);

  const { isPending, submit } = useFormDialogSubmit<LocationFormValues>({ form, onOpenChange });

  const onSubmit = (values: LocationFormValues) =>
    submit(
      values,
      () => (isEditing ? updateLocationAction({ id: location.id, ...values }) : createLocationAction(values)),
      isEditing ? MESSAGES.LOCATION_UPDATED : MESSAGES.LOCATION_CREATED,
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => form.reset(toFormValues(location))}
      title={isEditing ? "Edit Location" : "Add Location"}
      description={isEditing ? "Update this venue's details" : "Add a venue where classes run"}
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel={isEditing ? "Save changes" : "Create location"}
      canSubmit={form.formState.isValid}
      isPending={isPending}
    >
      <FormInputField control={form.control} name="name" label="Name" placeholder="e.g. Main Pool" />

      <FormTextareaField control={form.control} name="address" label="Address" placeholder="Street, suburb, state" />

      <FormSwitchField control={form.control} name="isActive" label="Active" />
    </FormDialog>
  );
}
