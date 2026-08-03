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
import { TEAM_ROLE_OPTIONS, USER_ROLES, USER_ROLE_LABELS, USER_ROLE_OPTIONS } from "@/lib/data/kysely-database-types";

import { addAdminUserInvitationAction } from "../admin-users.actions";
import {
  AddAdminUserInvitationRequestDTO,
  AddAdminUserInvitationSchema,
  InvitableTeamDTO,
} from "../admin-users.types";

type AdminUserInvitationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invitableTeams: InvitableTeamDTO[];
};

type FormValues = AddAdminUserInvitationRequestDTO;

// The select has no "none" value of its own, so a sentinel stands in for
// "no team". It is mapped back to undefined before submitting, and never
// reaches the server.
const NO_TEAM = "__none__";

const DEFAULT_VALUES: FormValues = {
  name: "",
  email: "",
  userRole: USER_ROLES.MEMBER,
  teamId: undefined,
  teamRole: undefined,
};

// -------------------------------------------------------------------
// Invite somebody to the product.
//
// The platform role decides which AREA they land in; the optional team and
// team role decide what they can reach inside it. Both are only proposals
// here - the server re-checks the team exists and is active, and assigns the
// role itself.
// -------------------------------------------------------------------
export function AdminUsersInvitationDialog({ open, onOpenChange, invitableTeams }: AdminUserInvitationDialogProps) {
  const [confirmed, setConfirmed] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(AddAdminUserInvitationSchema),
    defaultValues: DEFAULT_VALUES,
  });

  const { name, email, userRole, teamId } = useWatch({ control: form.control });

  const hasTeam = !!teamId && teamId !== NO_TEAM;
  const canSubmit = !!name?.trim() && !!email?.trim() && !!userRole && confirmed;

  const teamOptions = [
    { value: NO_TEAM, label: "No team" },
    ...invitableTeams.map((team) => ({ value: team.id, label: team.name })),
  ];

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
      () => {
        // Map the sentinel back to "no team", and drop the team role with it -
        // a team role on its own is rejected by both the schema and the
        // database, so it must never be sent.
        const teamChosen = values.teamId && values.teamId !== NO_TEAM ? values.teamId : undefined;

        return addAdminUserInvitationAction({
          ...values,
          teamId: teamChosen,
          teamRole: teamChosen ? values.teamRole : undefined,
        });
      },
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
      pendingLabel="Sending..."
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
        description="Admins see everything. Managers see the teams they are assigned to. Members see their own portal."
      />

      {/* Optional team placement. Managers get nothing to manage until an
          admin puts them in a team as its manager, so this is where that
          usually starts. */}
      <FormSelectField
        control={form.control}
        name="teamId"
        label="Team (optional)"
        placeholder="No team"
        options={teamOptions}
      />

      {hasTeam && (
        <FormSelectField control={form.control} name="teamRole" label="Role in this team" options={TEAM_ROLE_OPTIONS} />
      )}

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
