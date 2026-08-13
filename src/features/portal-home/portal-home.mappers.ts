import type { UserTeamMembership } from "@/lib/data/repositories/team-members.repository";

import type { PortalTeamDTO } from "./portal-home.types";

// -------------------------------------------------------------------
// Map one of the member's team memberships to the portal DTO.
// -------------------------------------------------------------------
export function mapDBTeamMembershipToPortalTeamDTO(membership: UserTeamMembership): PortalTeamDTO {
  return {
    teamId: membership.teamId,
    teamName: membership.teamName,
    teamRole: membership.teamRole,
    isActive: membership.teamIsActive,
  };
}
