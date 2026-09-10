"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";

import { FormDialog } from "@/components/form/form-dialog";
import { FormInputField } from "@/components/form/form-input-field";
import { FormSelectField } from "@/components/form/form-select-field";
import { FormTextareaField } from "@/components/form/form-textarea-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";

import { updateTaskAction } from "../delivery-board.actions";
import {
  DESCRIPTION_MAX_CHARS,
  TASK_TITLE_MAX_CHARS,
  type ProjectMemberDTO,
  type UpdateTaskRequestDTO,
} from "../delivery.types";

// -------------------------------------------------------------------
// BoardTaskEditDialog
//
// Edit a card: its title, its description, who has it.
//
// IT IS OPENED FROM THE PANEL, NOT FROM A CARD, and that is the one
// structural thing to know about it. A card carries no description on
// purpose - a hundred of them on a board would be a megabyte - so a form
// built from one would open with an empty box over whatever had been
// written. The panel fetches the task in full before this can appear, so
// every box here starts on the real value.
//
// -------------------------------------------------------------------
// IT POSTS ONLY WHAT CHANGED, and that is not an optimisation.
//
// UpdateTaskSchema is a PATCH: an absent key means unchanged, and Kysely
// drops undefined out of the object it builds an UPDATE from, so a field
// nobody touched never reaches the SQL at all. Sending all three fields back
// every time would work until two people had the same card open - and then
// the second save would quietly restore whatever the first had changed,
// because a form holds the values it was seeded with, not the current ones.
//
// So the diff below is the point of the whole shape. Title unchanged, title
// absent. Description cleared, description as '' - which the schema reads as
// NULL, the file's one spelling of "nothing written here". Assignee
// unchanged, assignee absent; unassigned, assignee null, because there is no
// empty-string spelling of nobody.
//
// NO ESTIMATE FIELD. Changing an estimate is its own mutation and lands in
// the append-only log, so an edit form carrying one would leave the current
// figure right and the record of how it got there missing. That is the same
// line the create dialog draws, from the other side.
// -------------------------------------------------------------------

// The sentinel for "nobody". Radix Select has no empty-string value.
const UNASSIGNED = "unassigned";

const TaskEditFormSchema = z.object({
  title: z.string().trim().min(1, "A task needs a title").max(TASK_TITLE_MAX_CHARS),
  description: z.string().trim().max(DESCRIPTION_MAX_CHARS),
  assigneeId: z.string(),
});

type TaskEditFormValues = z.infer<typeof TaskEditFormSchema>;

export type EditableTask = {
  id: string;
  title: string;
  description: string | null;
  assigneeId: string | null;
};

const toFormValues = (task: EditableTask): TaskEditFormValues => ({
  title: task.title,
  // A null description and an empty box are the same state, which is what
  // lets an unchanged empty one be diffed away below rather than posted as a
  // clear.
  description: task.description ?? "",
  assigneeId: task.assigneeId ?? UNASSIGNED,
});

export function BoardTaskEditDialog({
  open,
  onOpenChange,
  task,
  members,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: EditableTask;
  /** Only project members may be assigned - the service refuses anybody else. */
  members: readonly ProjectMemberDTO[];
  onSaved: () => void;
}) {
  const form = useForm<TaskEditFormValues>({
    resolver: zodResolver(TaskEditFormSchema),
    mode: "onChange",
    defaultValues: toFormValues(task),
  });

  // Opening the dialog on a different card - or on the same one after
  // somebody else changed it - has to bring the new values with it, which a
  // form initialised once would not.
  useEffect(() => {
    form.reset(toFormValues(task));
  }, [task, open, form]);

  const { isPending, submit } = useFormDialogSubmit<TaskEditFormValues>({ form, onOpenChange, onSuccess: onSaved });

  const onSubmit = (values: TaskEditFormValues) => {
    const initial = toFormValues(task);

    // The patch. Every key is added only if this form actually moved it, so
    // a field nobody touched is absent rather than restated - see the note
    // above about two people with the same card open.
    // The REQUEST DTO, as every dialog in this module uses - see the note
    // on the first Input/Request pair in delivery.types.ts. The action
    // re-validates whatever is built here.
    const patch: UpdateTaskRequestDTO = { taskId: task.id };

    if (values.title !== initial.title) patch.title = values.title;

    // '' is how the schema spells "cleared", so a box somebody emptied posts
    // as '' and a box that was always empty posts nothing at all.
    if (values.description !== initial.description) patch.description = values.description;

    if (values.assigneeId !== initial.assigneeId) {
      patch.assigneeId = values.assigneeId === UNASSIGNED ? null : values.assigneeId;
    }

    return submit(values, () => updateTaskAction(patch), "Task updated");
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => form.reset(toFormValues(task))}
      title="Edit task"
      description="The estimate is changed separately, so it keeps its history."
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel="Save changes"
      pendingLabel="Saving…"
      canSubmit={form.formState.isValid}
      isPending={isPending}
    >
      <FormInputField
        control={form.control}
        name="title"
        label="Title"
        maxLength={TASK_TITLE_MAX_CHARS}
        placeholder="e.g. Draft the migration plan"
      />

      <FormTextareaField
        control={form.control}
        name="description"
        label="Description"
        placeholder="What this task covers"
        maxLength={DESCRIPTION_MAX_CHARS}
        description="Clearing the box removes the description."
      />

      <FormSelectField
        control={form.control}
        name="assigneeId"
        label="Assignee"
        options={[
          { value: UNASSIGNED, label: "Unassigned" },
          ...members.map((member) => ({
            value: member.userId,
            // The email is what tells two people with the same name apart,
            // which is why the DTO carries it.
            label: member.name ?? member.email ?? "Unnamed member",
          })),
        ]}
        description="Only people on this project can be assigned work."
      />
    </FormDialog>
  );
}
