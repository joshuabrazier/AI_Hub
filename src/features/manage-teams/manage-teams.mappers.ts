import { TEAM_ROLES, type Team } from "@/lib/data/kysely-database-types";
import type { TeamMemberWithUser } from "@/lib/data/repositories/team-members.repository";

import type { ManagedTeamDTO, ManagedTeamMemberDTO } from "./manage-teams.types";

// -------------------------------------------------------------------
// Map a DB Team plus its membership rows to the manager's team DTO.
//
// The counts are derived from the rows that were already fetched for the
// caller's scope rather than from a fresh unscoped count, so a manager can
// never be shown a number that includes a team they do not hold.
// -------------------------------------------------------------------
export function mapDBTeamToManagedTeamDTO(team: Team, members: TeamMemberWithUser[]): ManagedTeamDTO {
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    isActive: team.isActive,
    memberCount: members.length,
    managerCount: members.filter((member) => member.teamRole === TEAM_ROLES.MANAGER).length,
  };
}

// -------------------------------------------------------------------
// Map a DB team membership (joined with its user) to the manager's member DTO.
// -------------------------------------------------------------------
export function mapDBTeamMemberToManagedTeamMemberDTO(member: TeamMemberWithUser): ManagedTeamMemberDTO {
  return {
    membershipId: member.membershipId,
    userId: member.userId,
    teamRole: member.teamRole,
    displayName: member.preferredName?.trim() || member.name,
    fullName: member.name,
    email: member.email,
    isActive: member.isActive,
  };
}
