import { TABLE_ID_LENGTH } from "@/lib/constants";
import { ATTENDANCE_STATUS, AttendanceStatus, SESSION_STATUS, SessionStatus } from "@/lib/data/kysely-database-types";
import z from "zod";

export type SelectOption = { value: string; label: string };

// Sentinel select value for "no lead" (Radix Select disallows an empty-string
// item value). Mapped back to NULL before it reaches the service.
export const UNASSIGNED_LEAD = "unassigned";

export const SESSION_STATUS_VALUES = [
  SESSION_STATUS.SCHEDULED,
  SESSION_STATUS.COMPLETED,
  SESSION_STATUS.CANCELLED,
] as const;

// -------------------------------------------------------------------
// One session as the week grid DRAWS it.
//
// This is the whole contract of the shared grid, and it is deliberately the
// smaller half: a read-only week (the manager's) builds exactly this and keeps
// the editable fields below off the wire entirely.
// -------------------------------------------------------------------
export type WeekSessionDTO = {
  id: string;
  className: string;
  programName: string;
  locationName: string;
  leadUserName: string | null;
  sessionDate: string; // YYYY-MM-DD
  sessionStart: string; // HH:MM
  sessionEnd: string; // HH:MM
  status: SessionStatus;
  // Set when the session falls on a closure day: shown as cancelled with this
  // reason, without its stored status being changed. Null otherwise.
  closureReason: string | null;
  capacity: number;
  // People occupying a place (booked / attended / absent).
  attendeeCount: number;
  // People who have cancelled their place, so it is free again.
  cancelledCount: number;
};

// -------------------------------------------------------------------
// One session on the ADMIN weekly schedule: the drawn fields plus the ones the
// detail dialog edits.
//
// `teamId` is the owning team of the session's class - null for an admin-only
// class. It travels with the row so the UI can label whose class it is; the
// scoping itself already happened server-side.
// -------------------------------------------------------------------
export type ScheduleSessionDTO = WeekSessionDTO & {
  classId: string;
  teamId: string | null;
  leadUserId: string | null;
  notes: string | null;
};

// -------------------------------------------------------------------
// A day the whole school is closed. Keyed by the calendar day rather than by
// session, because the reason is shown on the day's lane even when that day has
// no sessions at all - it is why the lane is empty.
// -------------------------------------------------------------------
export type ClosureDayDTO = {
  dateIso: string; // YYYY-MM-DD
  reason: string;
};

// -------------------------------------------------------------------
// One person's line on a session's roster. Rosters are users now, and there is
// no medical information anywhere in this model.
// -------------------------------------------------------------------
export type RosterEntryDTO = {
  attendeeId: string;
  userId: string;
  userName: string;
  status: AttendanceStatus;
};

// -------------------------------------------------------------------
// The statuses STAFF may set on a roster line.
//
// 'cancelled' is deliberately absent: it means the member gave up their place,
// which frees it for someone else. That is the member's own decision, recorded
// on their behalf nowhere else - staff marking it here would take a place off
// somebody without their asking.
// -------------------------------------------------------------------
export const MARKABLE_ATTENDANCE_STATUSES = [
  ATTENDANCE_STATUS.BOOKED,
  ATTENDANCE_STATUS.ATTENDED,
  ATTENDANCE_STATUS.ABSENT,
] as const;

export type MarkableAttendanceStatus = (typeof MARKABLE_ATTENDANCE_STATUSES)[number];

export const SetAttendanceSchema = z.object({
  attendeeId: z.string().min(TABLE_ID_LENGTH),
  status: z.enum(MARKABLE_ATTENDANCE_STATUSES),
});

export type SetAttendanceRequestDTO = z.infer<typeof SetAttendanceSchema>;

export type ScheduleWeekData = {
  weekStartIso: string; // Monday, YYYY-MM-DD
  // The app's own calendar day, resolved server-side. The grid decides "today"
  // and "past" from this rather than from the browser's clock, so a viewer in
  // another timezone sees the same week the rest of the app does.
  todayIso: string; // YYYY-MM-DD
  sessions: ScheduleSessionDTO[];
  closureDays: ClosureDayDTO[];
  leadOptions: SelectOption[];
};

// -------------------------------------------------------------------
// Read the schedule for a week. The date is a window, not a permission - what
// the caller may see inside it is resolved from their session.
// -------------------------------------------------------------------
export const GetScheduleWeekSchema = z.object({
  weekStartIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"),
});

export type GetScheduleWeekRequestDTO = z.infer<typeof GetScheduleWeekSchema>;

export const GetSessionRosterSchema = z.object({
  sessionId: z.string().min(TABLE_ID_LENGTH),
});

export type GetSessionRosterRequestDTO = z.infer<typeof GetSessionRosterSchema>;

// -------------------------------------------------------------------
// Cancel / restore / complete one session. Split from the edit below because
// the schedule's buttons act immediately, whatever state the form is in.
// -------------------------------------------------------------------
export const SetSessionStatusSchema = z.object({
  id: z.string().min(TABLE_ID_LENGTH),
  status: z.enum(SESSION_STATUS_VALUES),
});

export type SetSessionStatusRequestDTO = z.infer<typeof SetSessionStatusSchema>;

// -------------------------------------------------------------------
// Update a single session from the schedule detail dialog.
// -------------------------------------------------------------------
export const UpdateScheduleSessionSchema = z
  .object({
    id: z.string().min(TABLE_ID_LENGTH),
    sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"),
    sessionStart: z.string().regex(/^\d{2}:\d{2}$/, "Enter a valid time"),
    sessionEnd: z.string().regex(/^\d{2}:\d{2}$/, "Enter a valid time"),
    status: z.enum(SESSION_STATUS_VALUES),
    leadUserId: z.string().min(1).nullable(),
    notes: z.string().trim().max(1000),
  })
  .refine((values) => values.sessionEnd > values.sessionStart, {
    message: "End time must be after the start time",
    path: ["sessionEnd"],
  });

export type UpdateScheduleSessionRequestDTO = z.infer<typeof UpdateScheduleSessionSchema>;
