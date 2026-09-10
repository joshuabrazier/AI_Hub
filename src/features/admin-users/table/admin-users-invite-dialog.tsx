"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { FormDialog } from "@/components/form/form-dialog";
import { FormInputField } from "@/components/form/form-input-field";
import { FormSelectField } from "@/components/form/form-select-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { MESSAGES } from "@/lib/constants";
import { USER_ROLES, USER_ROLE_LABELS, USER_ROLE_OPTIONS } from "@/lib/data/kysely-database-types";

import { addAdminUserInvitationAction } from "../admin-users.actions";
import {
  AddAdminUserInvitationRequestDTO,
  AddAdminUserInvitationSchema,
} from "../admin-users.types";

type AdminUserInvitationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type FormValues = AddAdminUserInvitationRequestDTO;

const DEFAULT_VALUES: FormValues = {
  name: "",
  email: "",
  userRole: USER_ROLES.MEMBER,
};

// -------------------------------------------------------------------
// Invite somebody to the product.
//
// The platform role decides which AREA they land in, and it is the only thing
// an invitation carries: it used to propose a team as well, and teams are gone
// from the base. The role is a proposal here - the server assigns it.
// -------------------------------------------------------------------
export function AdminUsersInvitationDialog({ open, onOpenChange }: AdminUserInvitationDialogProps) {
  const [confirmed, setConfirmed] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(AddAdminUserInvitationSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const { name, email, userRole } = useWatch({ control: form.control });
  const canSubmit = !!name?.trim() && !!email?.trim() && !!userRole && confirmed;

  const resetForm = () => {
    form.reset(DEFAULT_VALUES);
    setConfirmed(false);
  };

  const { isPending, submit } = useFormDialogSubmit<FormValues>({
    form,
    onOpenChange,
    onSuccess: resetForm,
  });

  const onSubmit = (values: FormValues) =>
    submit(
      values,
      () => addAdminUserInvitationAction(values),
      MESSAGES.USER_INVITATION_SENT,
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={resetForm}
      title="Invite person"
      description="Send an invitation to set up an account"
      beforeForm={<Separator />}
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel="Send invitation"
      pendingLabel="Sending…"
      canSubmit={canSubmit}
      isPending={isPending}
    >
      <FormInputField control={form.control} name="name" label="Name" placeholder="Enter full name" />

      <FormInputField
        control={form.control}
        name="email"
        label="Email"
        type="email"
        placeholder="person@example.com"
        autoComplete="email"
      />

      <FormSelectField
        control={form.control}
        name="userRole"
        label="Role"
        options={USER_ROLE_OPTIONS}
        description="Admins see everything. Managers see the projects they are on. Members see their own portal."
      />

      <div className="rounded-md border p-3">
        <p className="text-sm text-muted-foreground">
          You are about to invite {name || "this person"} as {userRole ? USER_ROLE_LABELS[userRole] : "a member"}.
        </p>

        <div className="mt-3 flex items-center gap-2">
          <Checkbox
            id="confirmInvite"
            checked={confirmed}
            onCheckedChange={(checked) => setConfirmed(checked === true)}
          />
          <Label htmlFor="confirmInvite" className="text-sm font-normal">
            I confirm this role is correct.
          </Label>
        </div>
      </div>
    </FormDialog>
  );
}
