import { NOTIFICATION_AUDIENCE_LABELS } from "@/lib/data/kysely-database-types";
import type { NotificationBroadcast, Team } from "@/lib/data/kysely-database-types";

import type { DashboardBroadcastDTO, DashboardTeamDTO } from "./admin-dashboard.types";

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
