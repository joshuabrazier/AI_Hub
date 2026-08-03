"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";
import { MapPin, Users } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormInputField } from "@/components/form/form-input-field";
import { FormTimeSelectField } from "@/components/form/form-time-select-field";
import { FormSelectField } from "@/components/form/form-select-field";
import { FormTextareaField } from "@/components/form/form-textarea-field";
import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { SESSION_STATUS, SessionStatus } from "@/lib/data/kysely-database-types";

import { setSessionStatusAction, updateScheduleSessionAction } from "./admin-schedule.actions";
import { ScheduleSessionDTO, SelectOption, UNASSIGNED_LEAD } from "./admin-schedule.types";
import { SessionRoster } from "./session-roster";

// Details form. Status is NOT here - it is owned by the Cancel/Restore buttons,
// which act immediately regardless of these fields.
const DetailFormSchema = z
  .object({
    sessionDate: z.string().min(1, "Date is required"),
    sessionStart: z.string().regex(/^\d{2}:\d{2}$/, "Start time is required"),
    sessionEnd: z.string().regex(/^\d{2}:\d{2}$/, "End time is required"),
    leadUserId: z.string(),
    notes: z.string().trim().max(1000),
  })
  .refine((values) => values.sessionEnd > values.sessionStart, {
    message: "End time must be after the start time",
    path: ["sessionEnd"],
  });

type DetailFormValues = z.infer<typeof DetailFormSchema>;

const toFormValues = (session: ScheduleSessionDTO | null): DetailFormValues => ({
  sessionDate: session?.sessionDate ?? "",
  sessionStart: session?.sessionStart ?? "",
  sessionEnd: session?.sessionEnd ?? "",
  leadUserId: session?.leadUserId ?? UNASSIGNED_LEAD,
  notes: session?.notes ?? "",
});

type Props = {
  session: ScheduleSessionDTO | null;
  leadOptions: SelectOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SessionDetailDialog({ session, leadOptions, open, onOpenChange }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const leadSelectOptions: SelectOption[] = [{ value: UNASSIGNED_LEAD, label: "No lead" }, ...leadOptions];

  // Remounted per session (keyed by id in the parent), so defaultValues and
  // local state initialise fresh each time it opens.
  const form = useForm<DetailFormValues>({
    resolver: zodResolver(DetailFormSchema),
    mode: "onChange",
    defaultValues: toFormValues(session),
  });

  // Move focus to the confirm action when the inline confirm appears.
  useEffect(() => {
    if (confirmingCancel) confirmButtonRef.current?.focus();
  }, [confirmingCancel]);

  if (!session) return null;

  const isCancelled = session.status === SESSION_STATUS.CANCELLED;

  // Save the editable details. Status is preserved as-is here.
  const onSubmit = (values: DetailFormValues) => {
    startTransition(async () => {
      try {
        const response = await updateScheduleSessionAction({
          id: session.id,
          sessionDate: values.sessionDate,
          sessionStart: values.sessionStart,
          sessionEnd: values.sessionEnd,
          status: session.status,
          leadUserId: values.leadUserId === UNASSIGNED_LEAD ? null : values.leadUserId,
          notes: values.notes,
        });

        if (!response.success) {
          if (response.fieldErrors) {
            Object.entries(response.fieldErrors).forEach(([field, errors]) => {
              if (field in values) {
                form.setError(field as keyof DetailFormValues, { type: "server", message: errors[0] });
              }
            });
          }
          if (response.formError) toast.error(response.formError);
          return;
        }

        toast.success(MESSAGES.SESSION_UPDATED);
        router.refresh();
        onOpenChange(false);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  // Cancel / restore is a status-only change - it always works, even if the
  // time fields are mid-edit or invalid, and doesn't depend on the form.
  const setStatus = (status: SessionStatus) => {
    startTransition(async () => {
      try {
        const response = await setSessionStatusAction({ id: session.id, status });
        if (!response.success) {
          if (response.formError) toast.error(response.formError);
          return;
        }
        toast.success(status === SESSION_STATUS.CANCELLED ? "Session cancelled" : "Session restored");
        router.refresh();
        onOpenChange(false);
      } catch {
        toast.error(MESSAGES.SOMETHING_WENT_WRONG);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        // The Date field is the first form control, so the dialog's default
        // auto-focus lands on it and some browsers then pop the native date
        // picker on open. Suppress auto-focus so nothing opens uninvited.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader className="pr-8 text-left">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">{session.programName}</p>
          <DialogTitle className="text-2xl font-extrabold leading-tight">{session.className}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <MapPin size={13} aria-hidden="true" />
              {session.locationName}
            </span>
            <span className="flex items-center gap-1">
              <Users size={13} aria-hidden="true" />
              {session.attendeeCount} / {session.capacity}
            </span>
          </DialogDescription>
        </DialogHeader>

        {isCancelled && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
            This session is cancelled.
          </p>
        )}

        {session.closureReason && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
            Closed on this date, {session.closureReason}. Every session is shown as cancelled. Manage this from the
            Closure days tab.
          </p>
        )}

        {/* Roster + attendance (independent of the details form below) */}
        <SessionRoster sessionId={session.id} />

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormInputField control={form.control} name="sessionDate" label="Date" type="date" />
            <FormSelectField control={form.control} name="leadUserId" label="Lead" options={leadSelectOptions} />
            <FormTimeSelectField control={form.control} name="sessionStart" label="Start time" />
            <FormTimeSelectField control={form.control} name="sessionEnd" label="End time" />
          </div>

          <FormTextareaField
            control={form.control}
            name="notes"
            label="Notes"
            placeholder="Optional - a stand-in lead, why it was cancelled, etc."
          />

          {/* Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            {isCancelled ? (
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => setStatus(SESSION_STATUS.SCHEDULED)}
              >
                Restore session
              </Button>
            ) : confirmingCancel ? (
              <div role="alert" className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Cancel it?</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingCancel(false)}>
                  Keep
                </Button>
                <Button
                  ref={confirmButtonRef}
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setStatus(SESSION_STATUS.CANCELLED)}
                >
                  Yes, cancel
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmingCancel(true)}
              >
                Cancel session
              </Button>
            )}

            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button
                type="submit"
                disabled={isPending || !form.formState.isValid || !form.formState.isDirty}
                loading={isPending}
              >
                {isPending ? "Saving..." : "Save changes"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
