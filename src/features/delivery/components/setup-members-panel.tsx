"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import z from "zod";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormComboboxField } from "@/components/form/form-combobox-field";
import { FormDialog } from "@/components/form/form-dialog";
import { FormSelectField } from "@/components/form/form-select-field";
import { FormSwitchField } from "@/components/form/form-switch-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MESSAGES } from "@/lib/constants";
import { RATE_BANDS, RATE_BAND_LABELS, type RateBand } from "@/lib/data/kysely-database-types";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import {
  addProjectMemberAction,
  removeProjectMemberAction,
  updateProjectMemberAction,
} from "../delivery-setup.actions";
import { memberLabel, type ProjectMemberDTO } from "../delivery.types";

// -------------------------------------------------------------------
// WHO IS ON THE PROJECT, who leads it, and which of their three rate bands
// this project pays.
//
// EVERY CONTROL HERE IS AN AUTHORIZATION CHANGE. A membership row is what
// lets somebody see the project at all, the lead flag is what lets them
// create and edit its tasks, and the band decides what the client is charged
// for their hours. All three are admin-only, all three are audited naming
// both parties, and the service re-checks every one of them - nothing on
// this screen is the gate.
//
// ONE PERSON AT A TIME, not the whole set. delivery.types.ts carries both
// shapes and says which is which: the set is for a form that was built from
// one read and saved as one act, and its failure mode is dropping the nine
// members it was not told about because the page had been open for ten
// minutes. Every control on this panel is about ONE person, so each posts
// only that person.
//
// THE BAND IS PER MEMBER PER PROJECT, and the column says so in words. The
// same consultant can be discounted for this client and standard for the
// next one, so a control that read "Ada's rate band" would be describing a
// property of the person that does not exist. What it is NOT is a rate: the
// DTO carries the band and never the cents, because naming which of three
// tiers applies tells a member nothing about what the client pays.
// -------------------------------------------------------------------

const BAND_OPTIONS = Object.values(RATE_BANDS).map((band) => ({
  value: band,
  label: RATE_BAND_LABELS[band],
}));

/** An account that may be put on a project. */
export type SetupAssignablePerson = {
  userId: string;
  name: string;
  email: string;
};

const AddMemberSchema = z.object({
  userId: z.string().min(1, "Choose somebody to add"),
  isLead: z.boolean(),
  rateBand: z.enum(RATE_BANDS),
});

type AddMemberValues = z.infer<typeof AddMemberSchema>;

type Props = {
  projectId: string;
  members: ProjectMemberDTO[];
  /** Everybody who could be put on the project, members included. */
  people: SetupAssignablePerson[];
};

export function SetupMembersPanel({ projectId, members, people }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<ProjectMemberDTO | null>(null);

  const memberIds = new Set(members.map((member) => member.userId));
  const hasLead = members.some((member) => member.isLead);

  // Somebody already on the project is not offered again: addProjectMember
  // leaves an existing row exactly as it was, so re-adding looks like it
  // worked and changes nothing.
  const addable = people.filter((person) => !memberIds.has(person.userId));

  // -----------------------------------------------------------------
  // Change one person's lead flag or band.
  //
  // Both fields travel every time, because the schema carries both and
  // sending a stale one back would undo the other control. They come from
  // the row being edited rather than from a form, so the pair is always the
  // one currently on screen.
  // -----------------------------------------------------------------
  const updateMember = (member: ProjectMemberDTO, changes: { isLead?: boolean; rateBand?: RateBand }) =>
    startTransition(async () => {
      try {
        const response = await updateProjectMemberAction({
          projectId,
          userId: member.userId,
          isLead: changes.isLead ?? member.isLead,
          rateBand: changes.rateBand ?? member.rateBand,
        });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        toast.success(`${memberLabel(member)} updated`);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  const confirmRemove = () =>
    startTransition(async () => {
      if (!removing) return;

      try {
        const response = await removeProjectMemberAction({ projectId, userId: removing.userId });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        toast.success(`${memberLabel(removing)} removed from this project`);
        setRemoving(null);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          Being on this list is what lets somebody see the project at all. A lead can also create and edit its
          tasks and move an estimate. The rate band applies to this project only, so the same person can be
          discounted here and standard elsewhere.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {members.length === 0 ? (
          <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            Nobody is on this project yet, so only an administrator can see it. Add the people who will work on it.
          </p>
        ) : (
          <>
            {!hasLead && (
              // A project with no lead is allowed - it is the honest state
              // while one is being replaced - so this warns and nothing
              // refuses. An admin can act on the project either way.
              <p role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">
                No lead. Nobody on this project can create or edit a task until somebody is made lead, or an
                administrator does it for them.
              </p>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-center">Lead</TableHead>
                  <TableHead>Rate band on this project</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {members.map((member) => {
                  const label = memberLabel(member);

                  return (
                    <TableRow key={member.userId}>
                      <TableCell>
                        {/* Typed by somebody, so both render as text nodes. */}
                        <span className="block font-medium text-foreground">{label}</span>
                        {member.email && (
                          <span className="block text-sm text-muted-foreground">{member.email}</span>
                        )}
                      </TableCell>

                      <TableCell className="text-center">
                        <Switch
                          checked={member.isLead}
                          disabled={isPending}
                          aria-label={`${label} leads this project`}
                          onCheckedChange={(checked) => updateMember(member, { isLead: checked })}
                        />
                      </TableCell>

                      <TableCell>
                        <Select
                          value={member.rateBand}
                          disabled={isPending}
                          onValueChange={(value) => updateMember(member, { rateBand: value as RateBand })}
                        >
                          <SelectTrigger className="w-40" aria-label={`Rate band for ${label} on this project`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {BAND_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>

                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() => setRemoving(member)}
                        >
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={() => setAddOpen(true)} disabled={addable.length === 0}>
            Add somebody
          </Button>
        </div>

        {addable.length === 0 && members.length > 0 && (
          <p className="text-right text-sm text-muted-foreground">Everybody with an active account is on this project.</p>
        )}
      </CardContent>

      <SetupAddMemberDialog
        projectId={projectId}
        addable={addable}
        open={addOpen}
        onOpenChange={setAddOpen}
      />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={`Remove ${removing ? memberLabel(removing) : "this person"}?`}
        description={
          removing
            ? `${memberLabel(removing)} loses access to this project, their open task assignments are cleared and they leave any budget group they were in. The time they have already logged stays exactly where it is - that is billing history.`
            : undefined
        }
        confirmLabel="Remove"
        pendingLabel="Removing..."
        isPending={isPending}
        onConfirm={confirmRemove}
      />
    </Card>
  );
}

// -------------------------------------------------------------------
// Put one person on the project.
//
// The band and the lead flag are chosen HERE rather than defaulted and
// corrected afterwards, because both are decisions somebody is making about
// this project and the row is written with them either way.
// -------------------------------------------------------------------
function SetupAddMemberDialog({
  projectId,
  addable,
  open,
  onOpenChange,
}: {
  projectId: string;
  addable: SetupAssignablePerson[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const form = useForm<AddMemberValues>({
    resolver: zodResolver(AddMemberSchema),
    mode: "onChange",
    defaultValues: { userId: "", isLead: false, rateBand: RATE_BANDS.STANDARD },
  });

  useEffect(() => {
    if (open) form.reset({ userId: "", isLead: false, rateBand: RATE_BANDS.STANDARD });
  }, [open, form]);

  const { isPending, submit } = useFormDialogSubmit<AddMemberValues>({ form, onOpenChange });

  const options = addable.map((person) => ({
    value: person.userId,
    // The address is here to tell two people of the same name apart, which
    // happens often enough in a picker to be worth the width.
    label: person.email ? `${person.name} (${person.email})` : person.name,
  }));

  const onSubmit = (values: AddMemberValues) =>
    submit(
      values,
      () =>
        addProjectMemberAction({
          projectId,
          userId: values.userId,
          isLead: values.isLead,
          rateBand: values.rateBand,
        }),
      "Added to the project",
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => form.reset({ userId: "", isLead: false, rateBand: RATE_BANDS.STANDARD })}
      title="Add somebody to this project"
      description="They can see the project as soon as this is saved."
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel="Add member"
      pendingLabel="Adding..."
      canSubmit={form.formState.isValid}
      isPending={isPending}
    >
      <FormComboboxField
        control={form.control}
        name="userId"
        label="Person"
        options={options}
        placeholder="Choose somebody"
        searchPlaceholder="Search people"
      />

      <FormSelectField
        control={form.control}
        name="rateBand"
        label="Rate band on this project"
        options={BAND_OPTIONS}
        description="Which of this person's three rates this project pays. It applies here only, and changing it later never restates work already logged."
      />

      <FormSwitchField
        control={form.control}
        name="isLead"
        label="Lead"
        description="A lead can create and edit this project's tasks, phases and estimates."
      />
    </FormDialog>
  );
}
