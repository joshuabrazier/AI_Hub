"use client";

import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserRoundPlus, UsersRound } from "lucide-react";
import z from "zod";

import { AppDialog } from "@/components/app-dialog";
import { FormComboboxField } from "@/components/form/form-combobox-field";
import { FormSelectField } from "@/components/form/form-select-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MESSAGES } from "@/lib/constants";
import { TEAM_ROLE_OPTIONS, TEAM_ROLES, type TeamRole } from "@/lib/data/kysely-database-types";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import {
  addTeamMemberAction,
  getTeamDetailAction,
  removeTeamMemberAction,
  updateTeamMemberRoleAction,
} from "../admin-teams.actions";
import { TeamDetailResponseDTO, TeamResponseDTO } from "../admin-teams.types";

// The add-member row. The user id is opaque here; the server re-checks that it
// is a real, assignable account before writing anything.
const AddMemberFormSchema = z.object({
  userId: z.string().min(1, "Choose someone to add"),
  teamRole: z.enum(TEAM_ROLES),
});

type AddMemberFormValues = z.infer<typeof AddMemberFormSchema>;

const EMPTY_ADD_FORM: AddMemberFormValues = { userId: "", teamRole: TEAM_ROLES.MEMBER };

type Props = {
  team: TeamResponseDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// -------------------------------------------------------------------
// Admin Team Members Dialog
//
// Views one team and manages who is in it. Every control here changes
// authorization - membership is what team-scoped queries filter on, and a team
// role of Manager is what hands somebody the team - so each one is a single,
// explicit action rather than part of a larger save.
// -------------------------------------------------------------------
export function AdminTeamMembersDialog({ team, open, onOpenChange }: Props) {
  const router = useRouter();
  const [detail, setDetail] = useState<TeamDetailResponseDTO | null>(null);
  // Starts true and is only cleared once a fetch has finished. The dialog is
  // keyed on the team id, so it mounts fresh each time one is opened and the
  // first render genuinely is a loading one.
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  // The member currently being changed, so only that row's controls disable.
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const form = useForm<AddMemberFormValues>({
    resolver: zodResolver(AddMemberFormSchema),
    mode: "onChange",
    defaultValues: EMPTY_ADD_FORM,
  });

  const teamId = team?.id ?? null;

  useEffect(() => {
    if (!open || !teamId) return;

    // The dialog can close mid-request; `active` stops a late response writing
    // into an unmounted (or re-keyed) dialog.
    let active = true;

    (async () => {
      const response = await getTeamDetailAction({ teamId });
      if (!active) return;

      if (response.success) setDetail(response.data);
      else toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);

      setIsLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [open, teamId]);

  // Re-read the team after a membership change, so the list and the picker
  // both reflect what was just written.
  const refresh = async () => {
    if (!teamId) return;

    const response = await getTeamDetailAction({ teamId });
    if (response.success) setDetail(response.data);
  };

  const afterChange = async (message: string) => {
    toast.success(message);
    form.reset(EMPTY_ADD_FORM);
    await refresh();
    // Refresh the page behind the dialog so the table's member count follows.
    router.refresh();
  };

  const onAddMember = (values: AddMemberFormValues) => {
    if (!teamId) return;

    startTransition(async () => {
      try {
        const response = await addTeamMemberAction({ teamId, ...values });

        if (!response.success) {
          if (response.formError) toast.error(response.formError);
          return;
        }

        await afterChange(MESSAGES.TEAM_MEMBER_ADDED);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  const onChangeRole = (userId: string, teamRole: TeamRole) => {
    if (!teamId) return;

    setBusyUserId(userId);
    startTransition(async () => {
      try {
        const response = await updateTeamMemberRoleAction({ teamId, userId, teamRole });

        if (!response.success) {
          if (response.formError) toast.error(response.formError);
          return;
        }

        await afterChange(MESSAGES.TEAM_MEMBER_UPDATED);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      } finally {
        setBusyUserId(null);
      }
    });
  };

  const onRemoveMember = (userId: string) => {
    if (!teamId) return;

    setBusyUserId(userId);
    startTransition(async () => {
      try {
        const response = await removeTeamMemberAction({ teamId, userId });

        if (!response.success) {
          if (response.formError) toast.error(response.formError);
          return;
        }

        await afterChange(MESSAGES.TEAM_MEMBER_REMOVED);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      } finally {
        setBusyUserId(null);
      }
    });
  };

  const assignableOptions = (detail?.assignableUsers ?? []).map((user) => ({
    value: user.id,
    label: `${user.name} (${user.email})`,
  }));

  const nobodyLeftToAdd = !isLoading && assignableOptions.length === 0;

  return (
    <AppDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) form.reset(EMPTY_ADD_FORM);
        onOpenChange(isOpen);
      }}
      title={team?.name ?? "Team"}
      description={team?.description || "Who belongs to this team, and what they can do in it."}
      contentClassName="sm:max-w-2xl"
    >
      <div className="space-y-6">
        {/* Add a member */}
        <form onSubmit={form.handleSubmit(onAddMember)} className="space-y-4 rounded-xl bg-muted/40 p-4">
          <div className="flex items-center gap-2">
            <UserRoundPlus size={18} aria-hidden="true" className="text-primary" />
            <h3 className="font-heading text-sm font-semibold text-foreground">Add a member</h3>
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <FormComboboxField
              control={form.control}
              name="userId"
              label="Person"
              options={assignableOptions}
              placeholder={nobodyLeftToAdd ? "Nobody left to add" : "Choose a person"}
              searchPlaceholder="Search by name or email"
              disabled={isLoading || nobodyLeftToAdd}
            />

            <FormSelectField
              control={form.control}
              name="teamRole"
              label="Team role"
              options={TEAM_ROLE_OPTIONS}
              disabled={isLoading}
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={isPending || !form.formState.isValid} loading={isPending}>
              Add to team
            </Button>
          </div>
        </form>

        {/* Current membership */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <UsersRound size={18} aria-hidden="true" className="text-primary" />
            <h3 className="font-heading text-sm font-semibold text-foreground">
              Members {detail ? `(${detail.members.length})` : ""}
            </h3>
          </div>

          {isLoading && !detail ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading members...</p>
          ) : detail && detail.members.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nobody is in this team yet. Add someone above.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {detail?.members.map((member) => {
                const rowBusy = isPending && busyUserId === member.userId;

                return (
                  <li key={member.membershipId} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                        {member.displayName}
                        {!member.isActive && <Badge variant="destructive">Inactive</Badge>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                    </div>

                    <Select
                      value={member.teamRole}
                      onValueChange={(value) => onChangeRole(member.userId, value as TeamRole)}
                      disabled={rowBusy}
                    >
                      <SelectTrigger className="w-36" aria-label={`Team role for ${member.displayName}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TEAM_ROLE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={rowBusy}
                      onClick={() => onRemoveMember(member.userId)}
                    >
                      Remove
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </div>
    </AppDialog>
  );
}
