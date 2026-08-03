"use client";

import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import z from "zod";
import { format, parseISO } from "date-fns";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { TimeSelect } from "@/components/ui/time-select";
import { FormDialog } from "@/components/form/form-dialog";
import { FormInputField } from "@/components/form/form-input-field";
import { FormSelectField } from "@/components/form/form-select-field";
import { FormSwitchField } from "@/components/form/form-switch-field";
import { FormTextareaField } from "@/components/form/form-textarea-field";
import { useFormDialogSubmit } from "@/components/form/use-form-dialog-submit";

import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DAY_OF_WEEK_LABELS, DAYS_OF_WEEK, DayOfWeek } from "@/lib/data/kysely-database-types";

import { createClassAction, getClassSessionsAction, updateClassAction } from "../admin-classes.actions";
import {
  ClassResponseDTO,
  ClassScheduleDay,
  ClassSessionEditDTO,
  DAY_VALUES,
  NO_TEAM,
  SelectOption,
  UNASSIGNED_LEAD,
} from "../admin-classes.types";
import { buildScheduleSessions } from "../session-generation";

const TIME_RE = /^\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_START = "16:00";
const DEFAULT_END = "16:30";

// Simple, non-schedule fields go through react-hook-form. Dates stay strings
// here for the same reason they do everywhere else: they are calendar days.
const ClassFieldsSchema = z
  .object({
    programId: z.string().min(1, "Program is required"),
    name: z.string().trim().min(1, "Name is required").max(120),
    description: z.string().trim().max(2000),
    locationId: z.string().min(1, "Location is required"),
    teamId: z.string().min(1, "Team is required"),
    leadUserId: z.string(),
    capacity: z
      .string()
      .trim()
      .regex(/^\d+$/, "Enter a whole number")
      .refine((value) => Number(value) >= 1 && Number(value) <= 500, "Must be between 1 and 500"),
    startDate: z.string().regex(DATE_RE, "Start date is required"),
    endDate: z.string().regex(DATE_RE, "End date is required"),
    isActive: z.boolean(),
  })
  .refine((values) => values.endDate >= values.startDate, {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  });

type ClassFieldsValues = z.infer<typeof ClassFieldsSchema>;

// A row in the editable session list. `id` is set for existing sessions (edit
// mode); id-less rows are new/generated ones.
type PreviewRow = { key: string; id?: string; sessionDate: string; sessionStart: string; sessionEnd: string };

const toFieldValues = (classRow: ClassResponseDTO | null): ClassFieldsValues => ({
  programId: classRow?.programId ?? "",
  name: classRow?.name ?? "",
  description: classRow?.description ?? "",
  locationId: classRow?.locationId ?? "",
  teamId: classRow?.teamId ?? NO_TEAM,
  leadUserId: classRow?.leadUserId ?? UNASSIGNED_LEAD,
  capacity: classRow != null ? String(classRow.capacity) : "",
  startDate: classRow?.startDate ?? "",
  endDate: classRow?.endDate ?? "",
  isActive: classRow?.isActive ?? true,
});

type Props = {
  classRow: ClassResponseDTO | null;
  programOptions: SelectOption[];
  locationOptions: SelectOption[];
  teamOptions: SelectOption[];
  leadOptions: SelectOption[];
  // Only an admin may leave a class team-less. The service enforces this too -
  // hiding the option is a courtesy, not the control.
  canCreateWithoutTeam: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AdminClassFormDialog({
  classRow,
  programOptions,
  locationOptions,
  teamOptions,
  leadOptions,
  canCreateWithoutTeam,
  open,
  onOpenChange,
}: Props) {
  const isEditing = !!classRow;

  const leadSelectOptions: SelectOption[] = [{ value: UNASSIGNED_LEAD, label: "No lead" }, ...leadOptions];

  // "No team" is offered to admins, and to anyone editing a class that already
  // has no team, so the current value is always representable.
  const teamSelectOptions: SelectOption[] =
    canCreateWithoutTeam || (isEditing && classRow.teamId === null)
      ? [{ value: NO_TEAM, label: "No team (admin only)" }, ...teamOptions]
      : teamOptions;

  const form = useForm<ClassFieldsValues>({
    resolver: zodResolver(ClassFieldsSchema),
    mode: "onChange",
    defaultValues: toFieldValues(classRow),
  });

  const watchedStartDate = useWatch({ control: form.control, name: "startDate" });
  const watchedEndDate = useWatch({ control: form.control, name: "endDate" });

  // Per-day schedule (days + each day's times).
  const [schedule, setSchedule] = useState<ClassScheduleDay[]>(() => classRow?.schedule ?? []);

  // Editable session list. Regenerated whenever the date range or the schedule
  // changes (manual per-session edits are discarded on regeneration). In edit
  // mode it is first populated with the class's existing sessions, which carry
  // ids.
  const [sessions, setSessions] = useState<PreviewRow[]>([]);
  const [sessionsSig, setSessionsSig] = useState<string | null>(null);
  const [sessionsLoaded, setSessionsLoaded] = useState(!isEditing);
  const [loadFailed, setLoadFailed] = useState(false);
  // The class's sessions as loaded (immutable reference) - used to detect which
  // sessions with recorded attendance a regeneration would drop.
  const [loadedSessions, setLoadedSessions] = useState<ClassSessionEditDTO[]>([]);
  const [confirmPending, setConfirmPending] = useState(false);

  const { isPending, submit } = useFormDialogSubmit<ClassFieldsValues>({ form, onOpenChange });

  // Load the class's existing sessions into the list when editing.
  useEffect(() => {
    if (!isEditing || !open || !classRow) return;
    let active = true;
    (async () => {
      const response = await getClassSessionsAction({ classId: classRow.id });
      if (!active) return;
      if (response.success) {
        setLoadedSessions(response.data);
        setSessions(
          response.data.map((session, index) => ({
            key: `e${index}`,
            id: session.id,
            sessionDate: session.sessionDate,
            sessionStart: session.sessionStart,
            sessionEnd: session.sessionEnd,
          })),
        );
        // Seed the signature to the current dates/schedule so we don't
        // immediately regenerate over the just-loaded sessions.
        setSessionsSig(`${classRow.startDate}|${classRow.endDate}|${JSON.stringify(classRow.schedule)}`);
      } else {
        // Don't fall through to "generate from scratch" - that would replace
        // every existing session (and its attendance) on save. Block the form.
        setLoadFailed(true);
        toast.error(response.formError ?? "Could not load sessions");
      }
      setSessionsLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [isEditing, open, classRow]);

  // Regenerate the list when the date range or schedule changes. Gated so we
  // don't regenerate before the existing sessions load, after a load failure,
  // or while the range is incomplete or inverted. In edit mode we rebuild only
  // future dates and keep past sessions (with their ids and attendance); create
  // generates the whole range. `today` stays in the past bucket so a session
  // dated today keeps its attendance.
  const rangeUsable =
    DATE_RE.test(watchedStartDate) && DATE_RE.test(watchedEndDate) && watchedEndDate >= watchedStartDate;
  const ready = (!isEditing || sessionsLoaded) && !loadFailed;

  if (ready && rangeUsable) {
    const signature = `${watchedStartDate}|${watchedEndDate}|${JSON.stringify(schedule)}`;
    if (signature !== sessionsSig) {
      setSessionsSig(signature);
      const todayStr = format(new Date(), "yyyy-MM-dd");
      const generated =
        schedule.length > 0
          ? buildScheduleSessions(watchedStartDate, watchedEndDate, schedule)
              .filter((session) => !isEditing || session.sessionDate > todayStr)
              .map((session, index) => ({ key: `g${index}`, ...session }))
          : [];
      const past = isEditing ? sessions.filter((session) => session.id && session.sessionDate <= todayStr) : [];
      setSessions([...past, ...generated]);
    }
  }

  const toggleDay = (day: DayOfWeek) => {
    setSchedule((previous) => {
      const exists = previous.some((slot) => slot.day === day);
      const next = exists
        ? previous.filter((slot) => slot.day !== day)
        : [
            ...previous,
            {
              day,
              startTime: previous[previous.length - 1]?.startTime ?? DEFAULT_START,
              endTime: previous[previous.length - 1]?.endTime ?? DEFAULT_END,
            },
          ];
      return next.slice().sort((a, b) => DAY_VALUES.indexOf(a.day) - DAY_VALUES.indexOf(b.day));
    });
  };

  const updateDayTime = (day: DayOfWeek, field: "startTime" | "endTime", value: string) => {
    setSchedule((previous) => previous.map((slot) => (slot.day === day ? { ...slot, [field]: value } : slot)));
  };

  const updateSession = (key: string, field: "sessionDate" | "sessionStart" | "sessionEnd", value: string) => {
    setSessions((previous) => previous.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  };

  const removeSession = (key: string) => {
    setSessions((previous) => previous.filter((row) => row.key !== key));
  };

  const scheduleValid =
    schedule.length > 0 &&
    schedule.every(
      (slot) => TIME_RE.test(slot.startTime) && TIME_RE.test(slot.endTime) && slot.endTime > slot.startTime,
    );
  const sessionsValid =
    sessions.length > 0 &&
    sessions.every(
      (session) =>
        DATE_RE.test(session.sessionDate) &&
        TIME_RE.test(session.sessionStart) &&
        TIME_RE.test(session.sessionEnd) &&
        session.sessionEnd > session.sessionStart,
    );
  const canSubmit = form.formState.isValid && scheduleValid && sessionsValid && !loadFailed;

  // Whether the dates/schedule changed from what was loaded - the sessions
  // below have been regenerated to match.
  const originalSig =
    isEditing && classRow ? `${classRow.startDate}|${classRow.endDate}|${JSON.stringify(classRow.schedule)}` : "";
  const regenerated =
    isEditing &&
    sessionsLoaded &&
    !loadFailed &&
    rangeUsable &&
    `${watchedStartDate}|${watchedEndDate}|${JSON.stringify(schedule)}` !== originalSig;
  const datesChanged =
    isEditing && !!classRow && (watchedStartDate !== classRow.startDate || watchedEndDate !== classRow.endDate);

  // Loaded sessions with recorded attendance that the current (regenerated)
  // list no longer keeps - saving would delete them. Drives the confirm step.
  const currentIdSet = new Set(sessions.filter((session) => session.id).map((session) => session.id as string));
  const droppedMarked = loadedSessions.filter(
    (session) => session.hasMarkedAttendance && !currentIdSet.has(session.id),
  );

  const doSubmit = (values: ClassFieldsValues) => {
    setConfirmPending(false);

    const base = {
      programId: values.programId,
      name: values.name,
      description: values.description,
      locationId: values.locationId,
      teamId: values.teamId === NO_TEAM ? null : values.teamId,
      leadUserId: values.leadUserId === UNASSIGNED_LEAD ? null : values.leadUserId,
      capacity: Number(values.capacity),
      startDate: values.startDate,
      endDate: values.endDate,
      isActive: values.isActive,
      schedule,
    };

    // Captured as a const so the non-null narrowing survives into the closure.
    const editing = classRow;

    if (editing) {
      submit(
        values,
        () =>
          updateClassAction({
            id: editing.id,
            ...base,
            sessions: sessions.map(({ id, sessionDate, sessionStart, sessionEnd }) => ({
              id,
              sessionDate,
              sessionStart,
              sessionEnd,
            })),
          }),
        ({ sessionCount }) => `Class updated - ${sessionCount} session${sessionCount === 1 ? "" : "s"}`,
      );
      return;
    }

    submit(
      values,
      () =>
        createClassAction({
          ...base,
          sessions: sessions.map(({ sessionDate, sessionStart, sessionEnd }) => ({
            sessionDate,
            sessionStart,
            sessionEnd,
          })),
        }),
      `Class created with ${sessions.length} sessions`,
    );
  };

  const onSubmit = (values: ClassFieldsValues) => {
    if (!scheduleValid || !sessionsValid) return;
    // Regenerating would delete upcoming sessions that already have recorded
    // attendance - confirm before doing so.
    if (isEditing && droppedMarked.length > 0) {
      setConfirmPending(true);
      return;
    }
    doSubmit(values);
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      onDismiss={() => {
        form.reset(toFieldValues(classRow));
        setSchedule(classRow?.schedule ?? []);
      }}
      title={isEditing ? "Edit Class" : "Add Class"}
      description={
        isEditing
          ? "Update the class and its sessions"
          : "Set the dates, pick the days and times, then fine-tune the sessions below"
      }
      contentClassName="sm:max-w-2xl"
      onSubmit={form.handleSubmit(onSubmit)}
      submitLabel={isEditing ? "Save changes" : "Create class"}
      canSubmit={canSubmit}
      isPending={isPending}
      footer={
        confirmPending ? (
          <div className="grid gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm font-medium text-destructive">
              Delete recorded attendance on {droppedMarked.length} upcoming session
              {droppedMarked.length === 1 ? "" : "s"}?
            </p>
            <p className="text-xs text-muted-foreground">
              Those sessions have attended/absent marks. Regenerating replaces them with new sessions - the recorded
              attendance can&apos;t be recovered.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setConfirmPending(false)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" loading={isPending} onClick={() => doSubmit(form.getValues())}>
                Regenerate anyway
              </Button>
            </div>
          </div>
        ) : undefined
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormSelectField control={form.control} name="programId" label="Program" options={programOptions} />
        <FormInputField control={form.control} name="name" label="Class name" placeholder="e.g. Monday Beginners" />
        <FormSelectField control={form.control} name="locationId" label="Location" options={locationOptions} />
        <FormSelectField
          control={form.control}
          name="teamId"
          label="Team"
          options={teamSelectOptions}
          description="The team whose managers can administer this class."
        />
        <FormSelectField control={form.control} name="leadUserId" label="Lead" options={leadSelectOptions} />
        <FormInputField
          control={form.control}
          name="capacity"
          label="Capacity"
          type="number"
          inputMode="numeric"
          min={1}
          max={500}
          placeholder="e.g. 8"
        />
        <FormInputField control={form.control} name="startDate" label="Start date" type="date" />
        <FormInputField control={form.control} name="endDate" label="End date" type="date" />
      </div>

      <FormTextareaField
        control={form.control}
        name="description"
        label="Description"
        placeholder="Optional - what this class covers"
      />

      {/* Days + per-day times */}
      <div className="grid gap-2">
        <Label id="days-label">Days &amp; times</Label>
        <p className="text-xs text-muted-foreground">
          {isEditing
            ? "Changing a day, its time, or the dates rebuilds the upcoming sessions below (past sessions are kept)."
            : "Changing a day or its time rebuilds the session list below, discarding any manual edits there."}
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby="days-label">
          {DAYS_OF_WEEK.map((day) => {
            const selected = schedule.some((slot) => slot.day === day.value);
            return (
              <button
                key={day.value}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleDay(day.value)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                  selected
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {day.label.slice(0, 3)}
              </button>
            );
          })}
        </div>

        {schedule.length > 0 && (
          <div className="mt-1 space-y-2 rounded-lg border p-3">
            {schedule.map((slot) => {
              const invalid = slot.endTime <= slot.startTime;
              return (
                <div key={slot.day} className="flex flex-wrap items-center gap-2">
                  <span className="w-24 shrink-0 text-sm font-medium text-foreground">
                    {DAY_OF_WEEK_LABELS[slot.day]}
                  </span>
                  <TimeSelect
                    aria-label={`${DAY_OF_WEEK_LABELS[slot.day]} start time`}
                    value={slot.startTime}
                    onChange={(value) => updateDayTime(slot.day, "startTime", value)}
                    invalid={invalid}
                  />
                  <span aria-hidden="true" className="text-muted-foreground">
                    -
                  </span>
                  <TimeSelect
                    aria-label={`${DAY_OF_WEEK_LABELS[slot.day]} end time`}
                    value={slot.endTime}
                    onChange={(value) => updateDayTime(slot.day, "endTime", value)}
                    invalid={invalid}
                  />
                  {invalid && <p className="w-full text-xs text-destructive">End time must be after the start time.</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <FormSwitchField control={form.control} name="isActive" label="Active" />

      {/* Signifier: the change regenerated the sessions below */}
      {regenerated && (
        <div className="grid gap-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="text-sm font-medium">
            {datesChanged ? "Dates changed" : "Schedule changed"} - upcoming sessions regenerated
          </p>
          <p className="text-xs">
            The upcoming sessions below have been rebuilt to match. Past sessions are kept, and the people in this class
            are re-booked into the new sessions on save.
            {droppedMarked.length > 0 && (
              <>
                {" "}
                <span className="font-semibold">
                  {droppedMarked.length} upcoming session{droppedMarked.length === 1 ? "" : "s"} with recorded
                  attendance will be replaced.
                </span>
              </>
            )}
          </p>
        </div>
      )}

      {/* Editable session list (create + edit) */}
      {isEditing && loadFailed ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Couldn&apos;t load this class&apos;s sessions. Close and reopen to try again - saving is disabled so nothing
          is overwritten.
        </p>
      ) : isEditing && !sessionsLoaded ? (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">Loading sessions…</p>
      ) : sessions.length > 0 ? (
        <div className="grid gap-2">
          <Label>
            Sessions ({sessions.length}) - edit or remove any {isEditing ? "before saving" : "before creating"}
          </Label>
          <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border p-3">
            {sessions.map((session) => {
              const dateLabel = DATE_RE.test(session.sessionDate)
                ? format(parseISO(session.sessionDate), "EEE d MMM")
                : "this session";
              const timeInvalid = session.sessionEnd <= session.sessionStart;
              return (
                <div key={session.key} className="flex flex-wrap items-center gap-2">
                  <Input
                    type="date"
                    aria-label={`Date for ${dateLabel}`}
                    value={session.sessionDate}
                    onChange={(event) => updateSession(session.key, "sessionDate", event.target.value)}
                    className="w-40"
                    aria-invalid={!DATE_RE.test(session.sessionDate)}
                  />
                  <TimeSelect
                    aria-label={`Start time for ${dateLabel}`}
                    value={session.sessionStart}
                    onChange={(value) => updateSession(session.key, "sessionStart", value)}
                    invalid={timeInvalid}
                  />
                  <span aria-hidden="true" className="text-muted-foreground">
                    -
                  </span>
                  <TimeSelect
                    aria-label={`End time for ${dateLabel}`}
                    value={session.sessionEnd}
                    onChange={(value) => updateSession(session.key, "sessionEnd", value)}
                    invalid={timeInvalid}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${dateLabel}`}
                    onClick={() => removeSession(session.key)}
                    className="text-destructive hover:text-destructive"
                  >
                    <X size={16} />
                  </Button>
                  {timeInvalid && <p className="w-full text-xs text-destructive">End time must be after the start time.</p>}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          Set the start and end dates and pick day(s) above to build the session list.
        </p>
      )}
    </FormDialog>
  );
}
