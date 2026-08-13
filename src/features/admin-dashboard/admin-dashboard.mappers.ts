import type { Team } from "@/lib/data/kysely-database-types";

import type { DashboardTeamDTO } from "./admin-dashboard.types";

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
