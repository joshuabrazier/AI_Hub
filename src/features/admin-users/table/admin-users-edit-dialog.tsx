"use client";

import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { FormDialog } from "@/components/form/form-dialog";
import { FormSelectField } from "@/components/form/form-select-field";
import { FormSwitchField } from "@/components/form/form-switch-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";
import { Badge } from "@/components/ui/badge";
import { MESSAGES } from "@/lib/constants";
import { TEAM_ROLES, TEAM_ROLE_LABELS, USER_ROLE_OPTIONS } from "@/lib/data/kysely-database-types";

import { updateAdminUserAction } from "../admin-users.actions";
import {
  ADMIN_USER_DISPLAY_STATUS,
  AdminUserResponseDTO,
  UpdateAdminUserRequestDTO,
  UpdateAdminUserSchema,
} from "../admin-users.types";

type AdminUsersEditDialogProps = {
  user: AdminUserResponseDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type FormValues = UpdateAdminUserRequestDTO;

// -------------------------------------------------------------------
// Edit a person's platform role and active status.
//
// Team membership is deliberately NOT edited here: it is managed per team on
// the Teams screen, where the team is the thing being changed. This dialog
// shows the teams read-only so an admin can see the effect of a role change
// (a manager with no managed team reaches /manage and finds nothing).
// -------------------------------------------------------------------
export function AdminUsersEditDialog({ user, open, onOpenChange }: AdminUsersEditDialogProps) {
  const userIsActive = user?.displayStatus === ADMIN_USER_DISPLAY_STATUS.Active;

  const form = useForm<FormValues>({
    resolver: zodResolver(UpdateAdminUserSchema),
    defaultValues: {
      id: user?.id ?? "",
      userRole: user?.userRole,
      isActive: userIsActive,
    },
  });

  const { userRole, isActive } = useWatch({ control: form.control });

  useEffect(() => {
    if (!user) return;

    form.reset({
      id: user.id,
      userRole: user.userRole,
      isActive: user.displayStatus === ADMIN_USER_DISPLAY_STATUS.Active,
    });
  }, [user, open, form]);

  const { isPending, submit } = useFormDialogSubmit<FormValues>({ form, onOpenChange });

  if (!user) return null;

  // Nothing to save until the role or the active flag actually differs from
  // what the person already has.
  const isChanged = userRole !== user.userRole || isActive !== userIsActive;

  const onSubmit = (values: FormValues) => submit(values, () => updateAdminUserAction(values), MESSAGES.USER_UPDATED);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => form.reset()}
      title="Edit person"
      description="Update their role and whether they can sign in"
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel="Save changes"
      canSubmit={isChanged}
      isPending={isPending}
      beforeForm={
        // Who is being edited, plus the teams they are in (read-only).
        <div className="rounded-md border bg-muted p-3">
          <div className="pb-2 font-medium">{user.name}</div>
          <div className="text-sm text-muted-foreground">{user.email}</div>

          <div className="mt-3 flex flex-wrap items-center gap-1">
            {user.teams.length === 0 ? (
              <span className="text-sm text-muted-foreground">In no teams</span>
            ) : (
              user.teams.map((team) => (
                <Badge key={team.teamId} variant="outline" className="font-normal">
                  {team.teamName}
                  {team.teamRole === TEAM_ROLES.MANAGER && (
                    <span className="ml-1 text-muted-foreground">({TEAM_ROLE_LABELS[team.teamRole]})</span>
                  )}
                </Badge>
              ))
            )}
          </div>
        </div>
      }
    >
      <FormSelectField control={form.control} name="userRole" label="Role" options={USER_ROLE_OPTIONS} />

      {/* Deactivating also signs the person out everywhere - see the service,
          which deletes their sessions. */}
      <FormSwitchField
        control={form.control}
        name="isActive"
        label="Active"
        description="Turning this off signs them out immediately."
      />
    </FormDialog>
  );
}
