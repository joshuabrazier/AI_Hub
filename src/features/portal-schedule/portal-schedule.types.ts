import z from "zod";

import type { AttendanceStatus, SessionStatus } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Member portal schedule DTOs
//
// Every session below is one the SIGNED-IN member holds a place in. The
// service resolves that member from the session, so no shape here names a
// user and no request can ask for anybody else's week.
// -------------------------------------------------------------------

// One session on the member's schedule.
//
// `sessionDate` comes from a DATE column, so it is a 'YYYY-MM-DD' string and is
// compared lexicographically - never converted to a Date. The times are
// narrowed to 'HH:MM' here because the seconds a TIME column carries are always
// zero and never shown.
export type PortalScheduleSessionDTO = {
  id: string;
  sessionDate: string;
  sessionStart: string;
  sessionEnd: string;
  // The status to display, which is not always the stored one: a session whose
  // date has passed reads as completed unless it was cancelled.
  status: SessionStatus;
  // Set when the session falls on a closure day. The session shows as
  // cancelled with this reason whatever its stored status says.
  closureReason: string | null;
  className: string;
  programName: string;
  locationName: string;
  locationAddress: string;
  capacity: number;
  // The whole session's roster size, so a member can see how full it is.
  // Cancelled places are excluded, so a freed place reads as available.
  attendeeCount: number;
  // This member's own status for this session.
  attendanceStatus: AttendanceStatus;
};

// One week of the member's schedule, keyed to its Monday.
export type PortalWeekResponseDTO = {
  weekStartIso: string;
  // Today in the app's time zone, so the calendar can mark today and dim past
  // days by string comparison rather than by trusting the browser's clock.
  todayIso: string;
  sessions: PortalScheduleSessionDTO[];
};

// -------------------------------------------------------------------
// Asking for a week.
//
// The only input is a date. It is not an authorization decision of any kind:
// it narrows which of the caller's OWN sessions come back, and the caller is
// resolved from the session either way.
// -------------------------------------------------------------------
export const GetPortalWeekSchema = z.object({
  weekStartIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"),
});

export type GetPortalWeekRequestDTO = z.infer<typeof GetPortalWeekSchema>;
