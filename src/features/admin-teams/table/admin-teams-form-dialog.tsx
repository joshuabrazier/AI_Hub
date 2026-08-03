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

import { createTeamAction, updateTeamAction } from "../admin-teams.actions";
import { TeamResponseDTO } from "../admin-teams.types";

// -------------------------------------------------------------------
// Client form schema
// -------------------------------------------------------------------
const TeamFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500),
  isActive: z.boolean(),
});

type TeamFormValues = z.infer<typeof TeamFormSchema>;

const toFormValues = (team: TeamResponseDTO | null): TeamFormValues => ({
  name: team?.name ?? "",
  description: team?.description ?? "",
  isActive: team?.isActive ?? true,
});

type Props = {
  team: TeamResponseDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// -------------------------------------------------------------------
// Admin Teams Form Dialog (create + edit)
//
// Membership is not edited here - adding or removing somebody is an
// authorization change and lives in its own dialog, so a rename can never
// carry one along by accident.
// -------------------------------------------------------------------
export function AdminTeamsFormDialog({ team, open, onOpenChange }: Props) {
  const isEditing = !!team;

  const form = useForm<TeamFormValues>({
    resolver: zodResolver(TeamFormSchema),
    mode: "onChange",
    defaultValues: toFormValues(team),
  });

  useEffect(() => {
    form.reset(toFormValues(team));
  }, [team, open, form]);

  const { isPending, submit } = useFormDialogSubmit<TeamFormValues>({ form, onOpenChange });

  const onSubmit = (values: TeamFormValues) =>
    submit(
      values,
      () => (isEditing ? updateTeamAction({ id: team.id, ...values }) : createTeamAction(values)),
      isEditing ? MESSAGES.TEAM_UPDATED : MESSAGES.TEAM_CREATED,
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => form.reset(toFormValues(team))}
      title={isEditing ? "Edit Team" : "Add Team"}
      description={isEditing ? "Update this team's details" : "Create a team, then add people to it"}
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel={isEditing ? "Save changes" : "Create team"}
      canSubmit={form.formState.isValid}
      isPending={isPending}
    >
      <FormInputField control={form.control} name="name" label="Name" placeholder="e.g. Weekday Coaches" />

      <FormTextareaField
        control={form.control}
        name="description"
        label="Description"
        placeholder="What this team is for"
      />

      <FormSwitchField control={form.control} name="isActive" label="Active" />

      {/* Retiring a team keeps its membership and its classes; it just
          stops being offered anywhere new. */}
      <p className="text-sm text-muted-foreground">
        Retiring a team keeps its members and history. It only stops the team being offered when assigning new work.
      </p>
    </FormDialog>
  );
}
