"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import z from "zod";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormDialog } from "@/components/form/form-dialog";
import { FormInputField } from "@/components/form/form-input-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { createPhaseAction, deletePhaseAction, renamePhaseAction, reorderPhasesAction } from "../delivery-setup.actions";
import { PHASE_NAME_MAX_CHARS, formatMinutesAsClock, type PhaseDTO } from "../delivery.types";

// -------------------------------------------------------------------
// PHASES: the headings a board is organised under, and their order.
//
// Add, rename, reorder, delete. Nothing here is an access decision - a
// phase is board furniture - which is why phases are the one part of this
// screen a project LEAD can change as well as an admin, and why the buttons
// render on `canEditTasks` off the DTO rather than on a role read in a
// component. The service checks again; this only decides what to draw.
//
// REORDERING POSTS THE FULL ORDERED LIST, which is what ReorderPhasesSchema
// takes: "move this one to position 3" has to be interpreted against
// whatever the server currently holds, and two people dragging at once
// resolve it differently. A complete list is idempotent, so the last save
// wins cleanly.
//
// UP AND DOWN BUTTONS RATHER THAN DRAG AND DROP, deliberately. A drag is
// unreachable from a keyboard without building a parallel control anyway,
// and a project has a handful of phases rather than a hundred. Each button
// names the phase it moves, so the list is usable with a screen reader.
//
// DELETING CAN BE REFUSED, and the refusal is the useful part: a phase with
// time logged under its tasks, or with files attached to them, comes back as
// a sentence naming the hours or the files. It arrives as an ordinary
// formError, so it is SHOWN rather than treated as a fault - and the dialog
// stays open, because the sentence is the answer to what to do next.
// -------------------------------------------------------------------

const PhaseFormSchema = z.object({
  name: z.string().trim().min(1, "A phase needs a name").max(PHASE_NAME_MAX_CHARS),
});

type PhaseFormValues = z.infer<typeof PhaseFormSchema>;

type Props = {
  projectId: string;
  phases: PhaseDTO[];
  /** The viewer's own answer to "lead or admin", resolved server-side. */
  canEditTasks: boolean;
};

export function SetupPhasesPanel({ projectId, phases, canEditTasks }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [addOpen, setAddOpen] = useState(false);
  const [renaming, setRenaming] = useState<PhaseDTO | null>(null);
  const [deleting, setDeleting] = useState<PhaseDTO | null>(null);

  // The list as the server ordered it. `position` is what the reorder writes
  // back, so the array's own order is the truth being edited.
  const move = (index: number, direction: -1 | 1) =>
    startTransition(async () => {
      const target = index + direction;

      if (target < 0 || target >= phases.length) return;

      const reordered = [...phases];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(target, 0, moved);

      try {
        const response = await reorderPhasesAction({
          projectId,
          phaseIds: reordered.map((phase) => phase.id),
        });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  const confirmDelete = () =>
    startTransition(async () => {
      if (!deleting) return;

      try {
        const response = await deletePhaseAction({ phaseId: deleting.id });

        if (!response.success) {
          // Left open on purpose: the refusal names what stands in the way
          // and what to do instead, and closing the dialog would take the
          // question away with the answer.
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
        <CardTitle>Phases</CardTitle>
        <CardDescription>
          The headings this project&apos;s board is organised under, in the order they run. Every task sits in one
          of them.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {phases.length === 0 ? (
          <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            No phases yet. A board needs at least one, because a task is created inside a phase.
          </p>
        ) : (
          <ol className="space-y-2">
            {phases.map((phase, index) => (
              <li
                key={phase.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  {/* Typed by somebody, so it renders as a text node. */}
                  <p className="font-medium text-foreground">{phase.name}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {phase.taskCount} task{phase.taskCount === 1 ? "" : "s"}
                    {" - "}
                    {formatMinutesAsClock(phase.estimateMinutes)} estimated, {formatMinutesAsClock(phase.loggedMinutes)}{" "}
                    logged
                  </p>
                </div>

                {canEditTasks && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Move ${phase.name} up`}
                      disabled={isPending || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ChevronUp size={16} aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Move ${phase.name} down`}
                      disabled={isPending || index === phases.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ChevronDown size={16} aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setRenaming(phase)}>
                      Rename
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setDeleting(phase)}>
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}

        {canEditTasks && (
          <div className="flex justify-end">
            <Button type="button" onClick={() => setAddOpen(true)}>
              Add phase
            </Button>
          </div>
        )}
      </CardContent>

      <SetupPhaseFormDialog projectId={projectId} phase={null} open={addOpen} onOpenChange={setAddOpen} />

      {renaming && (
        <SetupPhaseFormDialog
          key={renaming.id}
          projectId={projectId}
          phase={renaming}
          open
          onOpenChange={(open) => {
            if (!open) setRenaming(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete ${deleting?.name ?? "this phase"}?`}
        description={
          deleting
            ? `Its ${deleting.taskCount} task${deleting.taskCount === 1 ? "" : "s"} go with it. A phase with time logged against its tasks, or files attached to them, cannot be deleted at all - you will be told which, and nothing will have changed.`
            : undefined
        }
        confirmLabel="Delete"
        pendingLabel="Deleting..."
        isPending={isPending}
        onConfirm={confirmDelete}
      />
    </Card>
  );
}

// Add a phase, or rename one. A phase is a heading with an order, so the
// name is the whole form; the order is the buttons on the list.
function SetupPhaseFormDialog({
  projectId,
  phase,
  open,
  onOpenChange,
}: {
  projectId: string;
  phase: PhaseDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEditing = phase !== null;

  const form = useForm<PhaseFormValues>({
    resolver: zodResolver(PhaseFormSchema),
    mode: "onChange",
    defaultValues: { name: phase?.name ?? "" },
  });

  useEffect(() => {
    if (open) form.reset({ name: phase?.name ?? "" });
  }, [open, phase, form]);

  const { isPending, submit } = useFormDialogSubmit<PhaseFormValues>({ form, onOpenChange });

  const onSubmit = (values: PhaseFormValues) =>
    submit(
      values,
      () =>
        isEditing
          ? renamePhaseAction({ phaseId: phase.id, name: values.name })
          : createPhaseAction({ projectId, name: values.name }),
      isEditing ? "Phase renamed" : "Phase added",
    );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => form.reset({ name: phase?.name ?? "" })}
      title={isEditing ? "Rename phase" : "Add phase"}
      description={
        isEditing
          ? "The new name appears on the board and on every task in this phase."
          : "A new phase goes at the end of the list. Move it with the arrows afterwards."
      }
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel={isEditing ? "Save name" : "Add phase"}
      canSubmit={form.formState.isValid}
      isPending={isPending}
    >
      <FormInputField
        control={form.control}
        name="name"
        label="Phase name"
        maxLength={PHASE_NAME_MAX_CHARS}
        placeholder="e.g. Discovery"
      />
    </FormDialog>
  );
}
