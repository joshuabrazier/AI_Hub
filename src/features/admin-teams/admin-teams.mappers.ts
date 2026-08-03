import type { Team, User } from "@/lib/data/kysely-database-types";
import type { TeamMemberWithUser } from "@/lib/data/repositories/team-members.repository";

import type { AssignableUserDTO, TeamMemberResponseDTO, TeamResponseDTO } from "./admin-teams.types";

// -------------------------------------------------------------------
// Map DB Team to Team Response DTO
//
// The member count is passed in rather than read here: it comes from a single
// grouped count across every team, and teams with no members are absent from
// that result, so a missing entry means zero.
// -------------------------------------------------------------------
export function mapDBTeamToTeamResponseDTO(team: Team, memberCount = 0): TeamResponseDTO {
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    isActive: team.isActive,
    memberCount,
  };
}

// -------------------------------------------------------------------
// Map a DB team membership (joined with its user) to the member DTO.
// -------------------------------------------------------------------
export function mapDBTeamMemberToTeamMemberResponseDTO(member: TeamMemberWithUser): TeamMemberResponseDTO {
  return {
    membershipId: member.membershipId,
    teamId: member.teamId,
    userId: member.userId,
    teamRole: member.teamRole,
    displayName: member.preferredName?.trim() || member.name,
    fullName: member.name,
    email: member.email,
    isActive: member.isActive,
  };
}

// -------------------------------------------------------------------
// Map a DB User to the shape the "add member" picker offers.
// -------------------------------------------------------------------
export function mapDBUserToAssignableUserDTO(user: User): AssignableUserDTO {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}
