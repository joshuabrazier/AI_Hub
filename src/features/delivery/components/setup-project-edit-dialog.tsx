"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil } from "lucide-react";
import z from "zod";

import { FormDialog } from "@/components/form/form-dialog";
import { FormInputField } from "@/components/form/form-input-field";
import { FormSelectField } from "@/components/form/form-select-field";
import { FormSwitchField } from "@/components/form/form-switch-field";
import { FormTextareaField } from "@/components/form/form-textarea-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";
import { Button } from "@/components/ui/button";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ProjectStatus,
} from "@/lib/data/kysely-database-types";

import { updateProjectAction } from "../delivery-setup.actions";
import {
  DESCRIPTION_MAX_CHARS,
  PROJECT_TITLE_MAX_CHARS,
  type UpdateProjectRequestDTO,
} from "../delivery.types";

// -------------------------------------------------------------------
// SetupProjectEditDialog
//
// A project's title, what it is for, whether it is billable, and where it
// is up to.
//
// THIS IS NEW BECAUSE THERE WAS NOTHING. updateProjectAction has existed
// since the module landed with no caller anywhere in the app - so a
// project's title, description and billable flag were whatever was typed
// into the create form, permanently. The action was written, guarded,
// audited and unreachable.
//
// -------------------------------------------------------------------
// IT POSTS ONLY WHAT CHANGED.
//
// UpdateProjectSchema is a patch now, and this is the form that made that
// worth doing. Two admins on a project setup screen is the ordinary case
// rather than a contrived one - it is where members, budget groups and
// phases are managed - so a form that posted all four fields back would let
// the second save silently revert the first person's edit. A patch cannot
// revert a field it does not mention.
//
// ARCHIVING IS NOT IN HERE, and the status picker below is where you would
// expect to find it. It is deliberately absent: archiving is this module's
// delete, and putting it behind a dropdown in a form somebody opened to fix
// a typo is how a project leaves the nav by accident. It has its own button,
// its own confirmation and its own audit line.
//
// AN ARCHIVED PROJECT CAN STILL BE EDITED HERE, which is what un-archives
// it: the picker shows `archived` as the current value when that is what it
// is - a form that lied about the present state would be worse - and
// choosing anything else restores it. That is why the option list is built
// per project rather than being a constant.
// -------------------------------------------------------------------

const ProjectEditFormSchema = z.object({
  title: z.string().trim().min(1, "A project needs a title").max(PROJECT_TITLE_MAX_CHARS),
  description: z.string().trim().max(DESCRIPTION_MAX_CHARS),
  isBillable: z.boolean(),
  status: z.enum(PROJECT_STATUSES),
});

type ProjectEditFormValues = z.infer<typeof ProjectEditFormSchema>;

export type EditableProject = {
  id: string;
  title: string;
  description: string | null;
  isBillable: boolean;
  status: ProjectStatus;
};

const toFormValues = (project: EditableProject): ProjectEditFormValues => ({
  title: project.title,
  // A null description and an empty box are the same state, which is what
  // lets an untouched empty one be diffed away rather than posted as a
  // clear.
  description: project.description ?? "",
  isBillable: project.isBillable,
  status: project.status,
});

// Everything but the soft delete, plus `archived` itself when that is where
// the project already is - see the note above.
//
// Ordered explicitly rather than taken from Object.values(PROJECT_STATUSES),
// because a picker's order is a presentation decision and inheriting it from
// however the constant happens to be declared means a reordered constant
// silently reorders this.
const STATUS_ORDER = [
  PROJECT_STATUSES.ACTIVE,
  PROJECT_STATUSES.ON_HOLD,
  PROJECT_STATUSES.COMPLETED,
] as const satisfies readonly ProjectStatus[];

const statusOptions = (current: ProjectStatus) => {
  const options = STATUS_ORDER.map((status) => ({
    value: status as ProjectStatus,
    label: PROJECT_STATUS_LABELS[status],
  }));

  // A form that offered no option matching the project's real status would
  // either show the wrong one as selected or show none at all. Appended
  // rather than filtered in, so the ordinary three keep their order.
  if (current === PROJECT_STATUSES.ARCHIVED) {
    options.push({ value: current, label: PROJECT_STATUS_LABELS[current] });
  }

  return options;
};

export function SetupProjectEditDialog({ project }: { project: EditableProject }) {
  const [open, setOpen] = useState(false);

  const form = useForm<ProjectEditFormValues>({
    resolver: zodResolver(ProjectEditFormSchema),
    mode: "onChange",
    defaultValues: toFormValues(project),
  });

  // The page re-renders after a save, so the form has to pick the new values
  // up or reopening it shows what was there before.
  useEffect(() => {
    form.reset(toFormValues(project));
  }, [project, open, form]);

  const { isPending, submit } = useFormDialogSubmit<ProjectEditFormValues>({
    form,
    onOpenChange: setOpen,
  });

  const onSubmit = (values: ProjectEditFormValues) => {
    const initial = toFormValues(project);

    // The REQUEST DTO, as every dialog in this module uses - see the note on
    // the first Input/Request pair in delivery.types.ts. The action
    // re-validates whatever is built here.
    const patch: UpdateProjectRequestDTO = { projectId: project.id };

    if (values.title !== initial.title) patch.title = values.title;

    // '' is how the schema spells "cleared", so a box somebody emptied posts
    // as '' and a box that was always empty posts nothing at all.
    if (values.description !== initial.description) patch.description = values.description;

    if (values.isBillable !== initial.isBillable) patch.isBillable = values.isBillable;

    if (values.status !== initial.status) patch.status = values.status;

    return submit(values, () => updateProjectAction(patch), "Project updated");
  };

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Pencil size={14} aria-hidden="true" />
        Edit project
      </Button>

      <FormDialog
        open={open}
        onOpenChange={setOpen}
        onDismiss={() => form.reset(toFormValues(project))}
        title="Edit project"
        description="Only what you change is saved, so two people on this screen cannot revert each other."
        onSubmit={form.handleSubmit(onSubmit)}
        submitLabel="Save changes"
        pendingLabel="Saving..."
        canSubmit={form.formState.isValid}
        isPending={isPending}
      >
        <FormInputField
          control={form.control}
          name="title"
          label="Title"
          maxLength={PROJECT_TITLE_MAX_CHARS}
          placeholder="e.g. Data platform"
        />

        <FormTextareaField
          control={form.control}
          name="description"
          label="Description"
          maxLength={DESCRIPTION_MAX_CHARS}
          placeholder="What this project covers"
          description="Clearing the box removes the description."
        />

        <FormSelectField
          control={form.control}
          name="status"
          label="Status"
          options={statusOptions(project.status)}
          description={
            project.status === PROJECT_STATUSES.ARCHIVED
              ? "Choosing anything else brings this project back."
              : "Archiving is separate, because it takes the project out of every list."
          }
        />

        <FormSwitchField
          control={form.control}
          name="isBillable"
          label="Billable"
          description="A non-billable project still records time and cost; it just is not charged for."
        />
      </FormDialog>
    </>
  );
}
