"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import z from "zod";

import { AppDialog } from "@/components/app-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormDialog } from "@/components/form/form-dialog";
import { FormInputField } from "@/components/form/form-input-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import {
  createBudgetGroupAction,
  deleteBudgetGroupAction,
  setBudgetGroupMembersAction,
  updateBudgetGroupAction,
} from "../delivery-setup.actions";
import {
  BUDGET_GROUP_NAME_MAX_CHARS,
  MAX_PLANNED_HOURS,
  formatMinutesAsHours,
  memberLabel,
  type BudgetGroupReportDTO,
  type ProjectMemberDTO,
} from "../delivery.types";
import { SetupBudgetBar } from "./setup-budget-bar";

// -------------------------------------------------------------------
// BUDGET GROUPS: a named bundle of specific people with a POOLED budget.
//
// "These two interns have 400 hours between them." The pool is the point -
// it is one budget shared by the people in the group, not a budget each -
// so the members are shown as the group's label rather than tucked away
// behind an edit button.
//
// ONE GROUP PER PERSON PER PROJECT, AND THE UI DOES NOT OFFER A SECOND.
// A unique index enforces it, and setting a group's list is inherently a
// MOVE - the repository takes somebody out of their old group on the way in.
// That is the right behaviour for a save, and the wrong thing to discover:
// a tickbox that silently empties another group is how a pooled budget ends
// up counting the same person twice in somebody's head. So anybody already
// in a sibling group appears in the list DISABLED, with the group they are
// in named beside them, and moving them means taking them out of that one
// first.
//
// NO MONEY HERE, not even for an admin. A pooled budget's chargeable value
// needs the rate snapshots, which is the budget report's work under its own
// guard; this is the setup view and it deals in minutes.
//
// HOURS IN, MINUTES ON THE WIRE - and the direction is the opposite of what
// the type says. Every `budgetHours` field below is sent as HOURS, because
// the action re-validates through the same schema and plannedHoursField
// converts it. The action's parameter is typed against the OUTPUT DTO (where
// the field holds minutes) for the reason delivery.types.ts gives about
// coerced fields, so the compiler will not catch a value converted twice.
// Send what somebody typed.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// The hours box holds a STRING, and is checked as one.
//
// It is what an input posts, and it keeps the form's value type the same on
// both sides of validation: a `z.coerce.number()` field has an input type of
// `unknown`, which makes the resolver's shape disagree with the form's and
// proves nothing at compile time anyway. Converted once, at the call.
// -------------------------------------------------------------------
const budgetHoursField = z
  .string()
  .trim()
  .refine((value) => value.length > 0 && Number.isFinite(Number(value)), "Enter a number of hours")
  .refine((value) => Number(value) >= 0, "Hours cannot be negative")
  .refine((value) => Number(value) <= MAX_PLANNED_HOURS, `Please enter no more than ${MAX_PLANNED_HOURS} hours`);

const GroupFormSchema = z.object({
  name: z.string().trim().min(1, "A group needs a name").max(BUDGET_GROUP_NAME_MAX_CHARS),
  budgetHours: budgetHoursField,
});

type GroupFormValues = {
  name: string;
  budgetHours: string;
};

type Props = {
  projectId: string;
  groups: BudgetGroupReportDTO[];
  /** The project's own members. Only they may be put in one of its groups. */
  members: ProjectMemberDTO[];
};

// The group report carries a name and no address; a project member carries
// both. Either is enough to draw a row, and a de-identified account has
// neither - this app de-identifies dormant accounts in place rather than
// deleting them, so something still has to render for one.

export function SetupBudgetGroupsPanel({ projectId, groups, members }: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetGroupReportDTO | null>(null);
  const [choosingFor, setChoosingFor] = useState<BudgetGroupReportDTO | null>(null);
  const [deleting, setDeleting] = useState<BudgetGroupReportDTO | null>(null);

  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const confirmDelete = () =>
    startTransition(async () => {
      if (!deleting) return;

      try {
        const response = await deleteBudgetGroupAction({ groupId: deleting.groupId });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        toast.success(`${deleting.name} deleted`);
        setDeleting(null);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget groups</CardTitle>
        <CardDescription>
          A named bundle of people with a pool of hours between them - two interns sharing 400 hours, say. Somebody
          can be in one group per project, and the hours are shared rather than each.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {groups.length === 0 ? (
          <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            No budget groups yet. They are optional: without one, time is still logged and still reported, it just
            is not counted against a pool.
          </p>
        ) : (
          <ul className="space-y-3">
            {groups.map((group) => (
              <li key={group.groupId} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    {/* Typed by somebody, so it renders as a text node. */}
                    <p className="font-medium text-foreground">{group.name}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {group.members.length === 0
                        ? "Nobody in this group yet, so nothing counts against its pool."
                        : group.members.map((member) => memberLabel(member)).join(", ")}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setChoosingFor(group)}>
                      People
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditing(group)}>
                      Edit
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setDeleting(group)}>
                      Delete
                    </Button>
                  </div>
                </div>

                <SetupBudgetBar
                  className="mt-3"
                  rollup={group.rollup}
                  label={`${group.name} pooled budget`}
                  emptyMessage="No hours pooled for this group yet."
                />
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={() => setAddOpen(true)}>
            New budget group
          </Button>
        </div>
      </CardContent>

      {/* Create. A group is made before its people are picked, because the
          member list is keyed on the group's id. */}
      <SetupBudgetGroupFormDialog
        projectId={projectId}
        group={null}
        open={addOpen}
        onOpenChange={setAddOpen}
      />

      {/* Edit, keyed on the group so opening a second one does not show the
          first one's values. */}
      {editing && (
        <SetupBudgetGroupFormDialog
          key={editing.groupId}
          projectId={projectId}
          group={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      )}

      {choosingFor && (
        <SetupBudgetGroupPeopleDialog
          key={choosingFor.groupId}
          group={choosingFor}
          groups={groups}
          members={members}
          onClose={() => setChoosingFor(null)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? "this group"}?`}
        description="The hours logged by its people stay exactly where they are; they just stop being counted against a pool and show as ungrouped on the budget report."
        confirmLabel="Delete"
        pendingLabel="Deleting..."
        isPending={isPending}
        onConfirm={confirmDelete}
      />
    </Card>
  );
}

// -------------------------------------------------------------------
// Create a group, or change its name and its pool.
// -------------------------------------------------------------------
function SetupBudgetGroupFormDialog({
  projectId,
  group,
  open,
  onOpenChange,
}: {
  projectId: string;
  group: BudgetGroupReportDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEditing = group !== null;

  // The stored figure is minutes; the box is hours, which is what somebody
  // typed in the first place. formatMinutesAsHours is the one place that
  // decides how many decimals a duration shows, so the value comes back in
  // the same form it went in.
  const defaults: GroupFormValues = {
    name: group?.name ?? "",
    budgetHours: group ? formatMinutesAsHours(group.rollup.budgetMinutes) : "",
  };

  const form = useForm<GroupFormValues>({
    resolver: zodResolver(GroupFormSchema),
    mode: "onChange",
    defaultValues: defaults,
  });

  useEffect(() => {
    if (open) form.reset(defaults);
    // The defaults object is rebuilt each render; the group and the open
    // flag are what actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group?.groupId]);

  const { isPending, submit } = useFormDialogSubmit<GroupFormValues>({ form, onOpenChange });

  const onSubmit = (values: GroupFormValues) =>
    submit(
      values,
      () =>
        isEditing
          ? updateBudgetGroupAction({
              groupId: group.groupId,
              name: values.name,
              // HOURS, not minutes - see the note at the top of this file.
              budgetHours: Number(values.budgetHours),
            })
          : createBudgetGroupAction({ projectId, name: values.name, budgetHours: Number(values.budgetHours) }),
      isEditing ? "Budget group updated" : "Budget group created. Now choose who shares it.",
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => form.reset(defaults)}
      title={isEditing ? "Edit budget group" : "New budget group"}
      description={
        isEditing
          ? "The pool is shared by everybody in the group."
          : "Name the bundle and give it a pool of hours. Who is in it comes next."
      }
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel={isEditing ? "Save group" : "Create group"}
      canSubmit={form.formState.isValid}
      isPending={isPending}
    >
      <FormInputField
        control={form.control}
        name="name"
        label="Group name"
        maxLength={BUDGET_GROUP_NAME_MAX_CHARS}
        placeholder="e.g. The two interns"
      />

      <FormInputField
        control={form.control}
        name="budgetHours"
        label="Pooled hours"
        type="number"
        min={0}
        step="0.25"
        inputMode="decimal"
        description="Hours shared between everybody in the group, not each. Stored to the nearest minute."
      />
    </FormDialog>
  );
}

// -------------------------------------------------------------------
// Who shares this group's pool.
//
// The WHOLE SET is posted, which is what the schema takes and what makes the
// save match what the admin was looking at. Anybody in a sibling group is
// shown and disabled rather than hidden: "why is Ada not in this list" has
// an answer on screen, and the answer names the group she is already in.
// -------------------------------------------------------------------
function SetupBudgetGroupPeopleDialog({
  group,
  groups,
  members,
  onClose,
}: {
  group: BudgetGroupReportDTO;
  groups: BudgetGroupReportDTO[];
  members: ProjectMemberDTO[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [selected, setSelected] = useState<string[]>(() => group.members.map((member) => member.userId));

  // Which OTHER group somebody is in, if any. Built from the groups already
  // read for the panel rather than from a second query.
  const otherGroupByUserId = new Map<string, string>();

  for (const candidate of groups) {
    if (candidate.groupId === group.groupId) continue;

    for (const member of candidate.members) otherGroupByUserId.set(member.userId, candidate.name);
  }

  const toggle = (userId: string, checked: boolean) =>
    setSelected((current) =>
      checked ? [...new Set([...current, userId])] : current.filter((id) => id !== userId),
    );

  const save = () =>
    startTransition(async () => {
      try {
        const response = await setBudgetGroupMembersAction({ groupId: group.groupId, userIds: selected });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        toast.success(`${group.name} updated`);
        onClose();
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  return (
    <AppDialog
      open
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
      title={group.name}
      description="Everybody ticked here shares this group's pool of hours."
    >
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody is on this project yet. Add its members first, then come back and pool their hours.
        </p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {members.map((member) => {
            const otherGroup = otherGroupByUserId.get(member.userId);
            const inputId = `group-member-${member.userId}`;

            return (
              <li key={member.userId} className="flex items-start gap-3 rounded-md px-1 py-1.5">
                <Checkbox
                  id={inputId}
                  className="mt-0.5"
                  checked={selected.includes(member.userId)}
                  disabled={isPending || otherGroup !== undefined}
                  onCheckedChange={(checked) => toggle(member.userId, checked === true)}
                />

                <Label htmlFor={inputId} className="grid gap-0.5 font-normal">
                  <span className="text-foreground">{memberLabel(member)}</span>
                  {otherGroup && (
                    <span className="text-sm text-muted-foreground">
                      Already in {otherGroup}. Take them out of that group first.
                    </span>
                  )}
                </Label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={isPending || members.length === 0} loading={isPending}>
          {isPending ? "Saving..." : "Save group"}
        </Button>
      </div>
    </AppDialog>
  );
}
