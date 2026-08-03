import "server-only";

import { requireManagementScope, requireTeamManagement } from "@/lib/auth/session-auth-server";
import { getTeamMembersForTeamsRepo, getTeamMembersRepo } from "@/lib/data/repositories/team-members.repository";
import { getAllTeamsRepo, getTeamByIdRepo, getTeamsByIdsRepo } from "@/lib/data/repositories/teams.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";

import {
  mapDBTeamMemberToManagedTeamMemberDTO,
  mapDBTeamToManagedTeamDTO,
} from "./manage-teams.mappers";
import { ManageOverviewDTO, ManagedTeamDTO, ManagedTeamDetailDTO } from "./manage-teams.types";

// -------------------------------------------------------------------
// Manager teams service
//
// The scope rules this file exists to hold:
//
//   1. The caller's teams come from requireManagementScope(), which resolves
//      them from the SESSION user id. Nothing here reads a team id from a URL
//      and treats it as evidence.
//   2. isUnrestricted means admin - no team filter. Everyone else is filtered
//      by scope.teamIds.
//   3. An EMPTY scope returns NOTHING. A manager who has been assigned no
//      teams sees no teams; the repositories all short-circuit an empty id
//      list rather than dropping the filter, so there is no path where "no
//      teams" widens into "every team".
//
// A single team is only ever reached through requireTeamManagement(teamId),
// which answers NOT FOUND when the id is outside the caller's scope - the same
// answer an id that does not exist gets, so nothing is confirmed either way.
// -------------------------------------------------------------------

// The teams the caller may manage, with their membership rows. Shared by the
// overview and the list so both apply the scope the same way, once.
async function getScopedTeams(): Promise<{ teams: ManagedTeamDTO[]; isUnrestricted: boolean }> {
  const scope = await requireManagementScope();

  // Admins are unrestricted, so their "managed teams" is every team. Everyone
  // else gets exactly the teams an admin assigned them - and an empty list in
  // means an empty list out, never an unfiltered read.
  const teams = scope.isUnrestricted ? await getAllTeamsRepo() : await getTeamsByIdsRepo(scope.teamIds);

  const members = await getTeamMembersForTeamsRepo(teams.map((team) => team.id));

  // One pass to group the membership rows by team, so the counts come from the
  // rows already inside the caller's scope.
  const membersByTeamId = new Map<string, typeof members>();
  for (const member of members) {
    const existing = membersByTeamId.get(member.teamId);
    if (existing) {
      existing.push(member);
    } else {
      membersByTeamId.set(member.teamId, [member]);
    }
  }

  return {
    teams: teams.map((team) => mapDBTeamToManagedTeamDTO(team, membersByTeamId.get(team.id) ?? [])),
    isUnrestricted: scope.isUnrestricted,
  };
}

// -------------------------------------------------------------------
// The manager landing view: their teams and the headline totals.
// -------------------------------------------------------------------
export async function getManageOverviewService(): Promise<ManageOverviewDTO> {
  try {
    const { teams, isUnrestricted } = await getScopedTeams();

    return {
      teams,
      totalMembers: teams.reduce((total, team) => total + team.memberCount, 0),
      isUnrestricted,
    };
  } catch (error) {
    throw handleError("getManageOverviewService", error);
  }
}

// -------------------------------------------------------------------
// Every team the caller manages.
// -------------------------------------------------------------------
export async function getManagedTeamsService(): Promise<ManagedTeamDTO[]> {
  try {
    const { teams } = await getScopedTeams();
    return teams;
  } catch (error) {
    throw handleError("getManagedTeamsService", error);
  }
}

// -------------------------------------------------------------------
// One team the caller manages, with its membership.
//
// requireTeamManagement is the whole authorization decision, and it runs
// BEFORE the team is read: a manager who asks for a team id outside their
// scope gets NOT FOUND and never reaches the query. "Forbidden" would confirm
// that the team exists; not found is what a made-up id gets too, so a guessed
// id learns nothing.
// -------------------------------------------------------------------
export async function getManagedTeamDetailService(teamId: string): Promise<ManagedTeamDetailDTO> {
  try {
    await requireTeamManagement(teamId);

    const team = await getTeamByIdRepo(teamId);

    if (!team) {
      throw new DisplayErrorMessage("That team no longer exists.");
    }

    const members = await getTeamMembersRepo(team.id);

    return {
      team: mapDBTeamToManagedTeamDTO(team, members),
      members: members.map(mapDBTeamMemberToManagedTeamMemberDTO),
    };
  } catch (error) {
    throw handleError("getManagedTeamDetailService", error);
  }
}
