import "server-only";

import { addDays, format, parseISO, startOfWeek } from "date-fns";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { getSessionsInRangeRepo } from "@/lib/data/repositories/class-sessions.repository";
import { getAllClassesRepo } from "@/lib/data/repositories/classes.repository";
import { getNotificationBroadcastsRepo } from "@/lib/data/repositories/notification-broadcasts.repository";
import { getAttendanceCountsForSessionsRepo } from "@/lib/data/repositories/session-attendees.repository";
import { getTeamMemberCountsRepo } from "@/lib/data/repositories/team-members.repository";
import { getActiveTeamsRepo } from "@/lib/data/repositories/teams.repository";
import { getMemberUsersRepo } from "@/lib/data/repositories/users.repository";
import { handleError } from "@/lib/handle-errors";
import { todayInAppZone } from "@/lib/timezone";

import {
  mapDBBroadcastToDashboardBroadcastDTO,
  mapDBScheduleSessionToDashboardSessionDTO,
  mapDBTeamToDashboardTeamDTO,
} from "./admin-dashboard.mappers";
import { AdminDashboardDTO } from "./admin-dashboard.types";

// How much of each list the dashboard shows. The full lists have their own
// pages; these bounds keep the landing page a summary.
const MAX_TEAMS_SHOWN = 6;
const MAX_BROADCASTS = 5;

// Normalise a date to that week's Monday ('YYYY-MM-DD'), the same week
// boundary the schedule uses. parseISO/format round-trips the string through a
// Date purely for the calendar arithmetic and hands back a 'YYYY-MM-DD'
// string, so no date column ever becomes a Date the app then compares.
function toMonday(dateIso: string): string {
  return format(startOfWeek(parseISO(dateIso), { weekStartsOn: 1 }), "yyyy-MM-dd");
}

// -------------------------------------------------------------------
// Admin dashboard service
//
// The guard lives HERE, not only in the page or the layout that renders it. A
// service that trusts its caller is only as safe as the least careful caller
// it ever acquires; the previous version took an `isAdmin` boolean argument
// and decided what to return from it, which meant any caller could ask for the
// admin view simply by passing true. The role now comes from the session and
// nothing else.
//
// Admins are unrestricted, so there is no team filter below - that is the
// decision the role check makes, not an omission. The team-scoped version of
// this overview is the manager's, which resolves its scope from the session
// instead of widening this one.
// -------------------------------------------------------------------
export async function getAdminDashboardService(): Promise<AdminDashboardDTO> {
  try {
    const user = await requireUserRole([USER_ROLES.ADMIN]);

    // The app's calendar day in its own time zone. The server runs in UTC, so
    // deriving "today" from the server clock would put the boundary on the
    // wrong day for most of the evening.
    const todayIso = todayInAppZone();
    const weekStartIso = toMonday(todayIso);
    const weekEndIso = format(addDays(parseISO(weekStartIso), 6), "yyyy-MM-dd");

    const [weekSessions, classes, teams, teamMemberCounts, members, broadcasts] = await Promise.all([
      // The whole week in one query: today's sessions are a slice of it, and
      // the week total is what an empty day has to say for itself.
      getSessionsInRangeRepo(weekStartIso, weekEndIso, todayIso),
      getAllClassesRepo(todayIso),
      getActiveTeamsRepo(),
      getTeamMemberCountsRepo(),
      getMemberUsersRepo(),
      // No `createdBy` filter, deliberately: an admin sees what the whole
      // organisation has sent. A manager's sent history is scoped to their own
      // messages, and that scoping belongs to the manager's own service.
      getNotificationBroadcastsRepo({ limit: MAX_BROADCASTS }),
    ]);

    // sessionDate is a DATE column, so both sides are 'YYYY-MM-DD' strings and
    // this is a string comparison. Neither becomes a Date.
    const todayRows = weekSessions.filter((row) => row.sessionDate === todayIso);

    // Sequential rather than part of the batch above: the counts are keyed by
    // the session ids the query just returned, so there is nothing to ask for
    // until it has. Only today's sessions are counted - the rest of the week
    // is a number, not a list.
    const attendanceCounts = await getAttendanceCountsForSessionsRepo(todayRows.map((row) => row.id));
    const countsBySessionId = new Map(attendanceCounts.map((row) => [row.classSessionId, row]));

    // Teams with no members are absent from the counts, so a miss is zero.
    const countByTeamId = new Map(teamMemberCounts.map((row) => [row.teamId, row.count]));

    const teamSummaries = teams
      .map((team) => mapDBTeamToDashboardTeamDTO(team, countByTeamId.get(team.id) ?? 0))
      // Biggest first, so the side column leads with where most people are.
      .sort((a, b) => b.memberCount - a.memberCount || a.name.localeCompare(b.name));

    return {
      firstName: user.name?.trim().split(" ")[0] || null,
      todayIso,
      stats: {
        sessionsToday: todayRows.length,
        // `isRunning` is "active AND today falls inside its start/end dates",
        // computed by the repository against the same app-zone day.
        activeClasses: classes.filter((entry) => entry.isRunning).length,
        activeTeams: teams.length,
        // A de-identified account is excluded as well as a deactivated one:
        // its personal data is gone, so it is a retained row rather than a
        // person still using the product.
        activeMembers: members.filter((member) => member.isActive && member.deidentifiedAt === null).length,
      },
      todaySessions: todayRows.map((row) =>
        mapDBScheduleSessionToDashboardSessionDTO(row, countsBySessionId.get(row.id)),
      ),
      weekSessionCount: weekSessions.length,
      teams: teamSummaries.slice(0, MAX_TEAMS_SHOWN),
      broadcasts: broadcasts.map(mapDBBroadcastToDashboardBroadcastDTO),
    };
  } catch (error) {
    throw handleError("getAdminDashboardService", error);
  }
}
