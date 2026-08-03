import type { ClosureDayDTO, WeekSessionDTO } from "@/features/admin-schedule/admin-schedule.types";

// -------------------------------------------------------------------
// Manager-facing schedule DTO
//
// The rows are the shared week grid's own WeekSessionDTO: the manager screen
// draws exactly what the admin screen draws, from one component, so the two
// cannot drift apart again.
//
// Read-only, and that is enforced by the DTO rather than by the markup. The
// editable fields (the session's class, its lead's id, its notes) live on
// ScheduleSessionDTO and never reach this screen, so there is nothing here for
// a manager's browser to send back.
// -------------------------------------------------------------------
export type ManagedScheduleWeekDTO = {
  weekStartIso: string; // Monday, YYYY-MM-DD
  // The app's calendar day, so the grid's "today" and "past" are decided in the
  // app's zone rather than the viewer's browser zone.
  todayIso: string; // YYYY-MM-DD
  sessions: WeekSessionDTO[];
  // Whole-day closures. Shown on the day's lane even when the day has no
  // sessions, so a manager can see why it is empty.
  closureDays: ClosureDayDTO[];
  // True only for an admin looking at the manager area. Used for copy, never
  // to widen a query.
  isUnrestricted: boolean;
};
