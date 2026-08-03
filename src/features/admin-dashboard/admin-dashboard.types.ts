import type { SessionStatus } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Admin dashboard DTOs
//
// The dashboard is read-only, so there are no request schemas here - nothing
// on this page takes an argument. Every figure below is counted server-side
// from the whole database: the page is admin-only, and an admin's scope is
// every team. A team-scoped overview is the manager's /manage area, which
// resolves its own scope from the session rather than reusing these.
// -------------------------------------------------------------------

// The headline counts across the top of the page.
export type DashboardStatsDTO = {
  sessionsToday: number;
  // Classes actually running today: flagged active AND today falls inside
  // their start/end dates. A class that has been created for next month is
  // active but is not running, so counting `isActive` alone read high.
  activeClasses: number;
  activeTeams: number;
  activeMembers: number;
};

// One of today's sessions. `sessionDate` comes from a DATE column and stays a
// 'YYYY-MM-DD' string; `sessionStart` / `sessionEnd` come from TIME columns
// ('HH:MM:SS'). They are formatted at the point of display and never parsed
// into a Date, which is what keeps them free of the server's time zone.
export type DashboardSessionDTO = {
  id: string;
  sessionDate: string;
  sessionStart: string;
  sessionEnd: string;
  status: SessionStatus;
  className: string;
  programName: string;
  locationName: string;
  // NULL when nobody is running the session yet.
  leadUserName: string | null;
  capacity: number;
  // Places currently taken. Cancelled places are excluded, because cancelling
  // is what frees a place - so this is what to compare against `capacity`.
  attendeeCount: number;
  // How many people dropped out, so a half-empty session reads as "people
  // cancelled" rather than "nobody joined".
  cancelledCount: number;
};

// One team on the side column, with how many people are in it.
export type DashboardTeamDTO = {
  id: string;
  name: string;
  memberCount: number;
};

// A message that has been sent. Titles only: the stored body is rich text and
// is rendered (sanitised) on the notifications page, so none of it reaches
// this one.
export type DashboardBroadcastDTO = {
  id: string;
  title: string;
  // Who it went to. Broadcasts store a display label; when one is missing the
  // audience type's own label stands in, so this is never blank.
  audienceLabel: string;
  createdAt: Date;
};

export type AdminDashboardDTO = {
  // What to greet the admin by, taken from the session. Null when their
  // account has no usable name.
  firstName: string | null;
  // Today's calendar date in the app's time zone, so the page can label a
  // date by string comparison instead of reading the server clock.
  todayIso: string;
  stats: DashboardStatsDTO;
  todaySessions: DashboardSessionDTO[];
  // Everything scheduled in the current week, so an empty day can still say
  // how busy the rest of the week is.
  weekSessionCount: number;
  // Capped for display; `stats.activeTeams` is the true total.
  teams: DashboardTeamDTO[];
  broadcasts: DashboardBroadcastDTO[];
};
