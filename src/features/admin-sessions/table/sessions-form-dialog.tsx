"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";

import { Label } from "@/components/ui/label";
import { FormDialog } from "@/components/form/form-dialog";
import { FormInputField } from "@/components/form/form-input-field";
import { FormSelectField } from "@/components/form/form-select-field";
import { FormTextareaField } from "@/components/form/form-textarea-field";
import { FormTimeSelectField } from "@/components/form/form-time-select-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";

import { MESSAGES } from "@/lib/constants";
import { SESSION_STATUS_LABELS } from "@/lib/data/kysely-database-types";

import { createClassSessionAction, updateClassSessionAction } from "../admin-sessions.actions";
import { SelectOption, SESSION_STATUS_VALUES, SessionResponseDTO } from "../admin-sessions.types";

// The class is only part of the form when creating. Editing keeps a session on
// the class it was created under - moving one would leave the wrong people on
// its roster - so the edit form shows the class rather than offering it.
const SessionFormSchema = z
  .object({
    classId: z.string(),
    sessionDate: z.string().min(1, "Date is required"),
    sessionStart: z.string().regex(/^\d{2}:\d{2}$/, "Start time is required"),
    sessionEnd: z.string().regex(/^\d{2}:\d{2}$/, "End time is required"),
    status: z.enum(SESSION_STATUS_VALUES),
    notes: z.string().trim().max(1000),
  })
  .refine((values) => values.sessionEnd > values.sessionStart, {
    message: "End time must be after the start time",
    path: ["sessionEnd"],
  });

type SessionFormValues = z.infer<typeof SessionFormSchema>;

const toFormValues = (session: SessionResponseDTO | null): SessionFormValues => ({
  classId: session?.classId ?? "",
  sessionDate: session?.sessionDate ?? "",
  sessionStart: session?.sessionStart ?? "16:00",
  sessionEnd: session?.sessionEnd ?? "16:30",
  status: session?.status ?? "scheduled",
  notes: session?.notes ?? "",
});

type Props = {
  session: SessionResponseDTO | null;
  classOptions: SelectOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const statusOptions = SESSION_STATUS_VALUES.map((value) => ({ value, label: SESSION_STATUS_LABELS[value] }));

// -------------------------------------------------------------------
// Session Form Dialog (create + edit)
// -------------------------------------------------------------------
export function SessionFormDialog({ session, classOptions, open, onOpenChange }: Props) {
  const isEditing = !!session;

  const form = useForm<SessionFormValues>({
    resolver: zodResolver(SessionFormSchema),
    mode: "onChange",
    defaultValues: toFormValues(session),
  });

  useEffect(() => {
    form.reset(toFormValues(session));
  }, [session, open, form]);

  const { isPending, submit } = useFormDialogSubmit<SessionFormValues>({ form, onOpenChange });

  const onSubmit = (values: SessionFormValues) => {
    // A class is required to create a session; editing never sends one.
    if (!isEditing && values.classId === "") {
      form.setError("classId", { type: "manual", message: "Class is required" });
      return;
    }

    submit(
      values,
      () =>
        isEditing
          ? updateClassSessionAction({
              id: session.id,
              sessionDate: values.sessionDate,
              sessionStart: values.sessionStart,
              sessionEnd: values.sessionEnd,
              status: values.status,
              notes: values.notes,
            })
          : createClassSessionAction({
              classId: values.classId,
              sessionDate: values.sessionDate,
              sessionStart: values.sessionStart,
              sessionEnd: values.sessionEnd,
              status: values.status,
              notes: values.notes,
            }),
      isEditing ? MESSAGES.SESSION_UPDATED : "Session created",
    );
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => form.reset(toFormValues(session))}
      title={isEditing ? "Edit Session" : "Add Session"}
      description={isEditing ? "Update this session" : "Add a one-off session to an existing class"}
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel={isEditing ? "Save changes" : "Create session"}
      canSubmit={form.formState.isValid}
      isPending={isPending}
    >
      {isEditing ? (
        <div className="grid gap-2">
          <Label>Class</Label>
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-foreground">
            {session.className}
            <span className="text-muted-foreground"> · {session.programName}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            A session stays with the class it was created under, so its roster keeps matching the class.
          </p>
        </div>
      ) : (
        <FormSelectField control={form.control} name="classId" label="Class" options={classOptions} />
      )}

      <FormInputField control={form.control} name="sessionDate" label="Date" type="date" />

      <div className="grid grid-cols-2 gap-4">
        <FormTimeSelectField control={form.control} name="sessionStart" label="Start time" />
        <FormTimeSelectField control={form.control} name="sessionEnd" label="End time" />
      </div>

      <FormSelectField control={form.control} name="status" label="Status" options={statusOptions} />

      <FormTextareaField
        control={form.control}
        name="notes"
        label="Notes"
        placeholder="Optional notes (e.g. a stand-in lead, or why it was cancelled)"
      />
    </FormDialog>
  );
}
