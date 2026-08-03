import { TABLE_ID_LENGTH } from "@/lib/constants";
import { DAYS_OF_WEEK, DayOfWeek } from "@/lib/data/kysely-database-types";
import z from "zod";

export type SelectOption = { value: string; label: string };

// Sentinel select values. Radix Select disallows an empty-string item value, so
// "not set" needs a value of its own; both map back to NULL before they reach
// the service.
export const UNASSIGNED_LEAD = "unassigned";
export const NO_TEAM = "no-team";

// Derived from the single source of truth (DAYS_OF_WEEK) so they can't drift.
export const DAY_VALUES = DAYS_OF_WEEK.map((day) => day.value) as [DayOfWeek, ...DayOfWeek[]];

// One day of a class's weekly schedule, with that day's times.
export type ClassScheduleDay = { day: DayOfWeek; startTime: string; endTime: string };

// A single session to create (the class dialog sends the finalised list).
export type SessionInput = { sessionDate: string; sessionStart: string; sessionEnd: string };

// -------------------------------------------------------------------
// Class response DTO (what the classes table consumes)
//
// A class carries its own start/end dates: there is no term above it. The dates
// stay 'YYYY-MM-DD' strings all the way to the screen - they are calendar days,
// not instants, and converting them to Date would move them across midnight.
// -------------------------------------------------------------------
export type ClassResponseDTO = {
  id: string;
  programId: string;
  programName: string;
  name: string;
  description: string;
  locationId: string;
  locationName: string;
  // NULL when the class has no owning team, i.e. it is admin-only.
  teamId: string | null;
  teamName: string | null;
  leadUserId: string | null;
  leadUserName: string | null;
  schedule: ClassScheduleDay[];
  capacity: number;
  memberCount: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  isActive: boolean;
  // Whether the class is running today: still flagged active AND today falls
  // inside its dates. Distinct from isActive - a class that has not started yet
  // is active but not running.
  isRunning: boolean;
  createdAt: string; // ISO - used for "date added" sorting
};

export type ClassesPageData = {
  classes: ClassResponseDTO[];
  programOptions: SelectOption[];
  locationOptions: SelectOption[];
  // The teams the CALLER may give a class to - every active team for an admin,
  // only their own for a manager. Resolved server-side from the session.
  teamOptions: SelectOption[];
  leadOptions: SelectOption[];
  // Only an admin may create a class that belongs to no team. The form uses
  // this to offer "No team"; the service enforces it regardless.
  canCreateWithoutTeam: boolean;
};

// -------------------------------------------------------------------
// Class membership (the roster of a class, as users)
// -------------------------------------------------------------------
export type ClassMemberDTO = {
  userId: string;
  name: string;
  email: string;
};

// An account the "add people" picker may offer.
export type AssignableMemberDTO = {
  id: string;
  name: string;
  email: string;
};

// Everything the membership dialog needs for one class.
export type ClassMembershipData = {
  classId: string;
  className: string;
  capacity: number;
  // The owning team's name, when there is one - it is where the pool of people
  // below comes from, so the dialog says so.
  teamName: string | null;
  members: ClassMemberDTO[];
  assignable: AssignableMemberDTO[];
};

// -------------------------------------------------------------------
// A class's existing session, as loaded into the edit dialog.
// -------------------------------------------------------------------
export type ClassSessionEditDTO = {
  id: string;
  sessionDate: string;
  sessionStart: string;
  sessionEnd: string;
  // True when the session has recorded attendance (attended / absent) - used to
  // warn before a regeneration would discard it.
  hasMarkedAttendance: boolean;
};

// Result of updating a class - how many sessions the class has afterwards.
export type UpdateClassResult = {
  id: string | undefined;
  sessionCount: number;
};

// -------------------------------------------------------------------
// Schemas
// -------------------------------------------------------------------
const timeString = z.string().regex(/^\d{2}:\d{2}$/, "Enter a valid time");
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");

// Ids are always re-checked server-side; the length bound only keeps obvious
// rubbish out of the query.
const classIdSchema = z.string().min(TABLE_ID_LENGTH);
const userIdSchema = z.string().min(TABLE_ID_LENGTH);

const scheduleDaySchema = z
  .object({ day: z.enum(DAY_VALUES), startTime: timeString, endTime: timeString })
  .refine((d) => d.endTime > d.startTime, { message: "End time must be after the start time", path: ["endTime"] });

const sessionInputSchema = z
  .object({ sessionDate: dateString, sessionStart: timeString, sessionEnd: timeString })
  .refine((d) => d.sessionEnd > d.sessionStart, {
    message: "End time must be after the start time",
    path: ["sessionEnd"],
  });

// An edited session in the class edit dialog: like a session input, but with an
// optional id - rows with one are existing sessions (updated in place), id-less
// rows are new sessions to create.
const editSessionSchema = z
  .object({
    id: z.string().min(1).optional(),
    sessionDate: dateString,
    sessionStart: timeString,
    sessionEnd: timeString,
  })
  .refine((d) => d.sessionEnd > d.sessionStart, {
    message: "End time must be after the start time",
    path: ["sessionEnd"],
  });

const TOO_MANY_SESSIONS = "Too many sessions - shorten the date range or pick fewer days";

const classBaseShape = {
  programId: z.string().min(1, "Program is required"),
  locationId: z.string().min(1, "Location is required"),
  // Both nullable: a class need not belong to a team, and need not have a lead.
  // Neither is proof of anything - the service checks the caller's own scope
  // against the team, and re-checks the lead is an active staff account.
  teamId: z.string().min(1).nullable(),
  leadUserId: z.string().min(1).nullable(),
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(2000),
  schedule: z.array(scheduleDaySchema).min(1, "Pick at least one day"),
  capacity: z.number().int().min(1).max(500),
  startDate: dateString,
  endDate: dateString,
  isActive: z.boolean(),
};

// Dates are 'YYYY-MM-DD', so this compares lexicographically - matching the
// classes_dates_ordered CHECK constraint, which is the real guarantee.
const hasValidDateOrder = (data: { startDate: string; endDate: string }) => data.endDate >= data.startDate;

const dateOrderIssue = {
  message: "End date must be on or after the start date",
  path: ["endDate"],
};

export const CreateClassSchema = z
  .object({
    ...classBaseShape,
    sessions: z.array(sessionInputSchema).min(1, "At least one session is required").max(400, TOO_MANY_SESSIONS),
  })
  .refine(hasValidDateOrder, dateOrderIssue);

export type CreateClassRequestDTO = z.infer<typeof CreateClassSchema>;

export const UpdateClassSchema = z
  .object({
    id: classIdSchema,
    ...classBaseShape,
    // The full session list from the edit dialog. Rows with an id are existing
    // sessions (updated); id-less rows are new; existing sessions absent from
    // the list are deleted.
    sessions: z.array(editSessionSchema).min(1, "At least one session is required").max(400, TOO_MANY_SESSIONS),
  })
  .refine(hasValidDateOrder, dateOrderIssue);

export type UpdateClassRequestDTO = z.infer<typeof UpdateClassSchema>;

// -------------------------------------------------------------------
// Read schemas. A class id from the client is a lookup key, never a grant: the
// service resolves the class and checks the caller against its owning team.
// -------------------------------------------------------------------
export const GetClassSessionsSchema = z.object({ classId: classIdSchema });

export type GetClassSessionsRequestDTO = z.infer<typeof GetClassSessionsSchema>;

export const GetClassMembershipSchema = z.object({ classId: classIdSchema });

export type GetClassMembershipRequestDTO = z.infer<typeof GetClassMembershipSchema>;

// -------------------------------------------------------------------
// Membership schemas
// -------------------------------------------------------------------
export const AddClassMembersSchema = z.object({
  classId: classIdSchema,
  userIds: z.array(userIdSchema).min(1, "Select at least one person").max(200),
});

export type AddClassMembersRequestDTO = z.infer<typeof AddClassMembersSchema>;

export const RemoveClassMemberSchema = z.object({
  classId: classIdSchema,
  userId: userIdSchema,
});

export type RemoveClassMemberRequestDTO = z.infer<typeof RemoveClassMemberSchema>;
