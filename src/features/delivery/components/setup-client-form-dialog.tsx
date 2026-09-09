"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";

import { FormDialog } from "@/components/form/form-dialog";
import { FormInputField } from "@/components/form/form-input-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";

import { createClientAction, updateClientAction } from "../delivery-setup.actions";
import { CLIENT_NAME_MAX_CHARS, type ClientSummaryDTO } from "../delivery.types";

// -------------------------------------------------------------------
// Create a client, or rename one.
//
// THE NAME IS THE WHOLE FORM, and the missing field is deliberate rather
// than an oversight. `clients.notes` exists and both mutations carry it,
// but nothing on this screen can READ it: ClientSummaryDTO leaves notes out
// on purpose (a list of fifty clients has no use for fifty notes fields)
// and delivery-setup.actions.ts explains at length why getClientDetailService
// is not exposed as an action. A notes box built from the list would open
// empty and post that emptiness over whatever is stored - a rename that
// quietly deletes a note is worse than no notes field at all.
//
// So notes are not writable from here either, which is what makes the null
// below safe rather than destructive: no surface in the app can put a note
// on a client, so there is none to lose. The moment one can, this form needs
// the value to send back - see the note in the return message of this work.
//
// The name is unique case-insensitively in the database, and the service
// turns that into a sentence naming the client that already holds it. It
// arrives here as `formError` and useFormDialogSubmit toasts it.
// -------------------------------------------------------------------
const ClientFormSchema = z.object({
  name: z.string().trim().min(1, "A client needs a name").max(CLIENT_NAME_MAX_CHARS),
});

type ClientFormValues = z.infer<typeof ClientFormSchema>;

const toFormValues = (client: ClientSummaryDTO | null): ClientFormValues => ({ name: client?.name ?? "" });

type Props = {
  client: ClientSummaryDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SetupClientFormDialog({ client, open, onOpenChange }: Props) {
  const isEditing = client !== null;

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(ClientFormSchema),
    mode: "onChange",
    defaultValues: toFormValues(client),
  });

  useEffect(() => {
    form.reset(toFormValues(client));
  }, [client, open, form]);

  const { isPending, submit } = useFormDialogSubmit<ClientFormValues>({ form, onOpenChange });

  const onSubmit = (values: ClientFormValues) =>
    submit(
      values,
      () =>
        isEditing
          ? updateClientAction({
              clientId: client.id,
              name: values.name,
              // See the header: nothing can write a note, so there is none
              // to preserve. `isActive` is carried through unchanged so a
              // rename cannot retire or restore anybody as a side effect -
              // retiring is its own button, and its own mutation.
              notes: null,
              isActive: client.isActive,
            })
          : createClientAction({ name: values.name, notes: null }),
      isEditing ? "Client renamed" : "Client created",
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => form.reset(toFormValues(client))}
      title={isEditing ? "Rename client" : "Add client"}
      description={
        isEditing
          ? "The new name appears on every project and every report for this client."
          : "Add the organisation the work is for. Projects are started for it afterwards."
      }
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel={isEditing ? "Save name" : "Create client"}
      canSubmit={form.formState.isValid}
      isPending={isPending}
    >
      <FormInputField
        control={form.control}
        name="name"
        label="Client name"
        maxLength={CLIENT_NAME_MAX_CHARS}
        placeholder="e.g. Perks"
        description="Two clients cannot share a name, ignoring capitals - otherwise every report about either one is half right."
      />
    </FormDialog>
  );
}
