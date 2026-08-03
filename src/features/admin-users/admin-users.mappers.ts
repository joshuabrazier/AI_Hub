import type { Team, User, UserInvitation } from "@/lib/data/kysely-database-types";
import type { TeamMemberWithUser } from "@/lib/data/repositories/team-members.repository";

import {
  ADMIN_USER_DISPLAY_STATUS,
  USER_OR_INVITATION,
  type AdminUserResponseDTO,
  type AdminUserTeamDTO,
  type InvitableTeamDTO,
} from "./admin-users.types";

// -------------------------------------------------------------------
// Group every membership row by user id, so the list can show a person's
// teams without one query per person.
//
// Membership is many-to-many, so the value is an ARRAY. Collapsing it to a
// single team here would silently pick whichever row the join happened to
// return last for anyone in more than one team.
// -------------------------------------------------------------------
export function groupTeamsByUserId(
  memberships: TeamMemberWithUser[],
  teams: Team[],
): Map<string, AdminUserTeamDTO[]> {
  const teamNameById = new Map(teams.map((team) => [team.id, team.name]));
  const byUserId = new Map<string, AdminUserTeamDTO[]>();

  for (const membership of memberships) {
    const entry: AdminUserTeamDTO = {
      teamId: membership.teamId,
      // A membership whose team is missing from the list is not dropped: the
      // person really is in that team, and hiding it would understate their
      // access. Label it instead.
      teamName: teamNameById.get(membership.teamId) ?? "(unknown team)",
      teamRole: membership.teamRole,
    };

    const existing = byUserId.get(membership.userId);
    if (existing) existing.push(entry);
    else byUserId.set(membership.userId, [entry]);
  }

  return byUserId;
}

// -------------------------------------------------------------------
// Map a user account to a row.
// -------------------------------------------------------------------
export function mapDBUserToAdminUserResponseDTO(user: User, teams: AdminUserTeamDTO[]): AdminUserResponseDTO {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    userRole: user.role,
    userOrInvitation: USER_OR_INVITATION.User,
    displayStatus: user.isActive ? ADMIN_USER_DISPLAY_STATUS.Active : ADMIN_USER_DISPLAY_STATUS.Inactive,
    teams,
    teamNames: teams.map((team) => team.teamName).join(", "),
  };
}

// -------------------------------------------------------------------
// Map a pending invitation to a row.
//
// The row's id is the INVITATION id, not a user id - there is no user yet.
// The table keys the cancel action off userOrInvitation for that reason.
// -------------------------------------------------------------------
export function mapDBInvitationToAdminUserResponseDTO(
  invitation: UserInvitation,
  teamNameById: Map<string, string>,
): AdminUserResponseDTO {
  const teams: AdminUserTeamDTO[] =
    invitation.teamId && invitation.teamRole
      ? [
          {
            teamId: invitation.teamId,
            teamName: teamNameById.get(invitation.teamId) ?? "(unknown team)",
            teamRole: invitation.teamRole,
          },
        ]
      : [];

  return {
    id: invitation.id,
    name: invitation.name,
    email: invitation.email,
    userRole: invitation.role,
    userOrInvitation: USER_OR_INVITATION.Invitation,
    displayStatus: ADMIN_USER_DISPLAY_STATUS.Pending,
    teams,
    teamNames: teams.map((team) => team.teamName).join(", "),
  };
}

// -------------------------------------------------------------------
// Map a team to the invite dialog's picker option.
// -------------------------------------------------------------------
export function mapDBTeamToInvitableTeamDTO(team: Team): InvitableTeamDTO {
  return { id: team.id, name: team.name };
}
