import "server-only";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { getUserUpcomingSessionRowsRepo } from "@/lib/data/repositories/class-sessions.repository";
import {
  getNotificationsByUserRepo,
  getUnreadNotificationCountRepo,
} from "@/lib/data/repositories/notifications.repository";
import { getTeamMembershipsForUserRepo } from "@/lib/data/repositories/team-members.repository";
import { handleError } from "@/lib/handle-errors";
import { todayInAppZone } from "@/lib/timezone";

import {
  mapDBMemberSessionToPortalSessionDTO,
  mapDBNotificationToPortalNotificationDTO,
  mapDBTeamMembershipToPortalTeamDTO,
} from "./portal-home.mappers";
import { PortalHomeDTO } from "./portal-home.types";

// How much of each list the home page shows. The full lists have their own
// pages; these bounds keep the landing page a summary and the queries small.
const MAX_UPCOMING_SESSIONS = 5;
const MAX_NOTIFICATIONS = 5;

// -------------------------------------------------------------------
// Member portal home service
//
// The signed-in member is resolved from the SESSION and is the only user id
// that reaches a repository here. That is what makes the portal IDOR-safe by
// construction rather than by checking: there is no id in the URL, no id in
// the arguments, and nothing to compare.
//
// requireUserRole is the guard, and it lives here rather than only in the page
// that calls this - the portal layout checks the same thing, but a service
// that relies on its caller is only as safe as the least careful one it ever
// acquires.
// -------------------------------------------------------------------
export async function getPortalHomeService(): Promise<PortalHomeDTO> {
  try {
    const user = await requireUserRole([USER_ROLES.MEMBER]);

    // The app's calendar day in its own time zone. The server runs in UTC, so
    // deriving "today" from the server clock would put the boundary on the
    // wrong day for most of the evening.
    const todayIso = todayInAppZone();

    const [sessionRows, memberships, notifications, unreadNotificationCount] = await Promise.all([
      getUserUpcomingSessionRowsRepo(user.id, todayIso, MAX_UPCOMING_SESSIONS),
      getTeamMembershipsForUserRepo(user.id),
      getNotificationsByUserRepo(user.id, { limit: MAX_NOTIFICATIONS }),
      getUnreadNotificationCountRepo(user.id),
    ]);

    const firstName = user.name?.trim().split(" ")[0] || null;

    return {
      firstName,
      todayIso,
      nextSessions: sessionRows.map(mapDBMemberSessionToPortalSessionDTO),
      teams: memberships.map(mapDBTeamMembershipToPortalTeamDTO),
      notifications: notifications.map(mapDBNotificationToPortalNotificationDTO),
      unreadNotificationCount,
    };
  } catch (error) {
    throw handleError("getPortalHomeService", error);
  }
}
