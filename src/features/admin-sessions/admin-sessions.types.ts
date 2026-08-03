import { TABLE_ID_LENGTH } from "@/lib/constants";
import { SESSION_STATUS, SessionStatus } from "@/lib/data/kysely-database-types";
import z from "zod";

export type SelectOption = { value: string; label: string };

export const SESSION_STATUS_VALUES = [
  SESSION_STATUS.SCHEDULED,
  SESSION_STATUS.COMPLETED,
  SESSION_STATUS.CANCELLED,
] as const;

// -------------------------------------------------------------------
// DTO consumed by the UI
//
// `teamId` / `teamName` are the owning team of the session's CLASS - null for
// an admin-only class. They are what a manager's view is scoped to.
// -------------------------------------------------------------------
export type SessionResponseDTO = {
  id: string;
  classId: string;
  className: string;
  programName: string;
  teamId: string | null;
  teamName: string | null;
  sessionDate: string; // YYYY-MM-DD
  sessionStart: string; // HH:MM
  sessionEnd: string; // HH:MM
  status: SessionStatus;
  notes: string | null;
  // Whether the session's class is still active. Sessions of an inactive class
  // are shown as inactive, and hidden from the upcoming schedule.
  classIsActive: boolean;
};

export type SessionsPageData = {
  sessions: SessionResponseDTO[];
  classOptions: SelectOption[];
};

// -------------------------------------------------------------------
// Create / Update schemas + DTOs
// -------------------------------------------------------------------
const sessionTimingShape = {
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"),
  sessionStart: z.string().regex(/^\d{2}:\d{2}$/, "Enter a valid time"),
  sessionEnd: z.string().regex(/^\d{2}:\d{2}$/, "Enter a valid time"),
  status: z.enum(SESSION_STATUS_VALUES),
  notes: z.string().trim().max(1000),
};

const hasValidTimeOrder = (data: { sessionStart: string; sessionEnd: string }) =>
  data.sessionEnd > data.sessionStart;

const timeOrderIssue = {
  message: "End time must be after the start time",
  path: ["sessionEnd"],
};

// The class id decides who may create the session, so it is a lookup key the
// service checks the caller against - never proof of access.
export const CreateClassSessionSchema = z
  .object({ classId: z.string().min(TABLE_ID_LENGTH), ...sessionTimingShape })
  .refine(hasValidTimeOrder, timeOrderIssue);

export type CreateClassSessionRequestDTO = z.infer<typeof CreateClassSessionSchema>;

// -------------------------------------------------------------------
// Update carries NO class id: a session belongs to the class that created it,
// for the whole of its life. Moving one would leave the old class's people on
// its roster and the new class's people off it, so the class is fixed once the
// session exists.
// -------------------------------------------------------------------
export const UpdateClassSessionSchema = z
  .object({ id: z.string().min(TABLE_ID_LENGTH), ...sessionTimingShape })
  .refine(hasValidTimeOrder, timeOrderIssue);

export type UpdateClassSessionRequestDTO = z.infer<typeof UpdateClassSessionSchema>;
