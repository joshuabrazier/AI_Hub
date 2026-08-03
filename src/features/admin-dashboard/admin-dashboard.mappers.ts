import { NOTIFICATION_AUDIENCE_LABELS } from "@/lib/data/kysely-database-types";
import type { NotificationBroadcast, Team } from "@/lib/data/kysely-database-types";
import type { ScheduleSessionRow } from "@/lib/data/repositories/class-sessions.repository";

import type { DashboardBroadcastDTO, DashboardSessionDTO, DashboardTeamDTO } from "./admin-dashboard.types";

// -------------------------------------------------------------------
// Map one scheduled session to the dashboard DTO.
//
// The date and time fields are carried through as the strings their DATE and
// TIME columns produced. Parsing them into a Date here would reintroduce the
// timezone shift those string columns exist to avoid.
//
// `counts` is absent for a session nobody is on: getAttendanceCountsForSessions
// groups by session, so a session with no roster rows has no row to return. A
// miss is zero, not unknown.
// -------------------------------------------------------------------
export function mapDBScheduleSessionToDashboardSessionDTO(
  row: ScheduleSessionRow,
  counts?: { total: number; cancelled: number },
): DashboardSessionDTO {
  return {
    id: row.id,
    sessionDate: row.sessionDate,
    sessionStart: row.sessionStart,
    sessionEnd: row.sessionEnd,
    status: row.status,
    className: row.className,
    programName: row.programName,
    locationName: row.locationName,
    leadUserName: row.leadUserName,
    capacity: row.capacity,
    attendeeCount: counts?.total ?? 0,
    cancelledCount: counts?.cancelled ?? 0,
  };
}

// -------------------------------------------------------------------
// Map a team to the dashboard DTO. The member count is passed in rather than
// read here: membership lives in team_members, so it is counted in one query
// across every team instead of one query per team.
// -------------------------------------------------------------------
export function mapDBTeamToDashboardTeamDTO(team: Team, memberCount: number): DashboardTeamDTO {
  return {
    id: team.id,
    name: team.name,
    memberCount,
  };
}

// -------------------------------------------------------------------
// Map a sent broadcast to the dashboard DTO. `audienceLabel` is NULL for a
// broadcast addressed to everyone (there is no list of names to label it
// with), so the audience type's own label stands in. The body is dropped -
// the card lists titles only.
// -------------------------------------------------------------------
export function mapDBBroadcastToDashboardBroadcastDTO(broadcast: NotificationBroadcast): DashboardBroadcastDTO {
  return {
    id: broadcast.id,
    title: broadcast.title,
    audienceLabel: broadcast.audienceLabel ?? NOTIFICATION_AUDIENCE_LABELS[broadcast.audienceType],
    createdAt: broadcast.createdAt,
  };
}
