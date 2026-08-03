import type { AttendanceStatus, SessionStatus, TeamRole } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Member portal home DTOs
//
// Everything here belongs to the SIGNED-IN member. There is no id anywhere in
// this shape, and no page under /portal takes one: the session is the
// identity, so there is nothing to tamper with.
// -------------------------------------------------------------------

// One of the member's upcoming sessions. `sessionDate` is a DATE column, so it
// is a 'YYYY-MM-DD' string and is compared lexicographically - never converted
// to a Date. `sessionStart` / `sessionEnd` are TIME columns ('HH:MM:SS').
export type PortalSessionDTO = {
  id: string;
  sessionDate: string;
  sessionStart: string;
  sessionEnd: string;
  status: SessionStatus;
  className: string;
  programName: string;
  locationName: string;
  // The member's own status for this session.
  attendanceStatus: AttendanceStatus;
};

// A team the member belongs to. `teamRole` is their role INSIDE the team.
export type PortalTeamDTO = {
  teamId: string;
  teamName: string;
  teamRole: TeamRole;
  isActive: boolean;
};

// A notification addressed to this member. The body is deliberately absent:
// the home page shows titles only, so no stored HTML reaches this page.
export type PortalNotificationDTO = {
  id: string;
  title: string;
  type: string;
  createdAt: Date;
  isUnread: boolean;
};

export type PortalHomeDTO = {
  // What to greet them by, from the session. Null when their account has no
  // usable name.
  firstName: string | null;
  // Today's calendar date in the app's time zone, so the page can label a
  // session "Today" or "Tomorrow" by string comparison.
  todayIso: string;
  nextSessions: PortalSessionDTO[];
  teams: PortalTeamDTO[];
  notifications: PortalNotificationDTO[];
  unreadNotificationCount: number;
};
