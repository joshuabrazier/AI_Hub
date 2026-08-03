import "server-only";

import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { diffFields } from "@/lib/audit/audit-diff";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import {
  NewTeam,
  NewTeamMember,
  TEAM_ROLE_LABELS,
  UpdateTeam,
  USER_ROLES,
  type User,
} from "@/lib/data/kysely-database-types";
import {
  addTeamMemberRepo,
  getTeamMemberCountsRepo,
  getTeamMembersRepo,
  removeTeamMemberRepo,
  updateTeamMemberRoleRepo,
} from "@/lib/data/repositories/team-members.repository";
import {
  createTeamRepo,
  getAllTeamsRepo,
  getTeamByIdRepo,
  updateTeamByIdRepo,
} from "@/lib/data/repositories/teams.repository";
import {
  getActiveStaffUsersRepo,
  getMemberUsersRepo,
  getUserByUserIdRepo,
} from "@/lib/data/repositories/users.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import {
  mapDBTeamMemberToTeamMemberResponseDTO,
  mapDBTeamToTeamResponseDTO,
  mapDBUserToAssignableUserDTO,
} from "./admin-teams.mappers";
import {
  AddTeamMemberRequestDTO,
  AssignableUserDTO,
  CreateTeamRequestDTO,
  RemoveTeamMemberRequestDTO,
  TeamDetailResponseDTO,
  TeamResponseDTO,
  UpdateTeamMemberRoleRequestDTO,
  UpdateTeamRequestDTO,
} from "./admin-teams.types";

// -------------------------------------------------------------------
// Admin teams service
//
// Every entry point below opens with requireUserRole([ADMIN]). The guard lives
// HERE rather than only in the action that calls it: a service that trusts its
// caller is only as safe as the least careful caller it ever acquires, and
// that is exactly how the previous cross-team leakage happened.
//
// Admins are unrestricted - their scope is every team - so there is no team
// filter in this file. That is a decision made by the role check above, not an
// omission: anything narrower belongs in the manager services, which resolve a
// scope from the session instead.
// -------------------------------------------------------------------

// A team id from the client is a lookup key, never a grant. The role guard
// above is what authorises the read; this only turns the id into a row.
async function requireTeam(teamId: string) {
  const team = await getTeamByIdRepo(teamId);

  if (!team) {
    throw new DisplayErrorMessage("That team no longer exists.");
  }

  return team;
}

// Accounts an admin may put into a team: active, and still identifiable. A
// de-identified account's personal data is gone, so adding it to a team would
// place an unreadable row in the app's security boundary.
function isAssignable(user: User): boolean {
  return user.isActive && user.deidentifiedAt === null;
}

// -------------------------------------------------------------------
// Get teams, each with its member count.
// -------------------------------------------------------------------
export async function getTeamsService(): Promise<TeamResponseDTO[]> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const [teams, memberCounts] = await Promise.all([getAllTeamsRepo(), getTeamMemberCountsRepo()]);

    // Teams with no members are absent from the counts, so a miss is zero.
    const countByTeamId = new Map(memberCounts.map((row) => [row.teamId, row.count]));

    return teams.map((team) => mapDBTeamToTeamResponseDTO(team, countByTeamId.get(team.id) ?? 0));
  } catch (error) {
    throw handleError("getTeamsService", error);
  }
}

// -------------------------------------------------------------------
// Get one team with its membership, plus the accounts still available to add.
// -------------------------------------------------------------------
export async function getTeamDetailService(teamId: string): Promise<TeamDetailResponseDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const team = await requireTeam(teamId);

    const [members, staffUsers, memberUsers] = await Promise.all([
      getTeamMembersRepo(team.id),
      getActiveStaffUsersRepo(),
      getMemberUsersRepo(),
    ]);

    // The picker offers every assignable account of any platform role, minus
    // whoever is already in this team - re-adding somebody is a no-op in the
    // repository, so offering them would be a dead option.
    const existingUserIds = new Set(members.map((member) => member.userId));

    const assignableUsers: AssignableUserDTO[] = [...staffUsers, ...memberUsers]
      .filter((user) => isAssignable(user) && !existingUserIds.has(user.id))
      .map(mapDBUserToAssignableUserDTO)
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      team: mapDBTeamToTeamResponseDTO(team, members.length),
      members: members.map(mapDBTeamMemberToTeamMemberResponseDTO),
      assignableUsers,
    };
  } catch (error) {
    throw handleError("getTeamDetailService", error);
  }
}

// -------------------------------------------------------------------
// Create a team. It starts empty; members are added afterwards.
// -------------------------------------------------------------------
export async function createTeamService(requestDTO: CreateTeamRequestDTO): Promise<string> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const now = new Date();

    const newTeam: NewTeam = {
      id: generateId(),
      name: requestDTO.name,
      description: requestDTO.description,
      isActive: requestDTO.isActive,
      createdAt: now,
      updatedAt: now,
    };

    const team = await createTeamRepo(newTeam);

    await recordAuditEvent({
      action: AUDIT_ACTIONS.TEAM_CREATED,
      entityType: AUDIT_ENTITY_TYPES.TEAM,
      entityId: team.id,
      teamId: team.id,
      summary: `Created team ${team.name}`,
    });

    revalidatePath(ROUTES.ADMIN_TEAMS);

    return team.id;
  } catch (error) {
    throw handleError("createTeamService", error);
  }
}

// -------------------------------------------------------------------
// Update a team. Retiring one is isActive = false, never a delete - deleting
// would cascade its memberships away and orphan the classes pointing at it.
// -------------------------------------------------------------------
export async function updateTeamService(requestDTO: UpdateTeamRequestDTO): Promise<string | undefined> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    // Snapshot first so the trail can show before -> after.
    const before = await requireTeam(requestDTO.id);

    const updateTeam: UpdateTeam = {
      name: requestDTO.name,
      description: requestDTO.description,
      isActive: requestDTO.isActive,
      updatedAt: new Date(),
    };

    const team = await updateTeamByIdRepo(requestDTO.id, updateTeam);

    const fieldChanges = diffFields([
      { field: "name", label: "Name", from: before.name, to: requestDTO.name },
      { field: "description", label: "Description", from: before.description, to: requestDTO.description },
      { field: "isActive", label: "Active", from: before.isActive, to: requestDTO.isActive },
    ]);

    if (fieldChanges.length > 0) {
      // Retiring or restoring a team is worth finding on its own, so it gets
      // its own action when that is the only thing that moved. A save that
      // also changed the name reads better as one "updated" entry carrying
      // every field than as two rows for the same click.
      const statusOnly = fieldChanges.length === 1 && fieldChanges[0].field === "isActive";

      await recordAuditEvent({
        action: statusOnly ? AUDIT_ACTIONS.TEAM_STATUS_CHANGED : AUDIT_ACTIONS.TEAM_UPDATED,
        entityType: AUDIT_ENTITY_TYPES.TEAM,
        entityId: requestDTO.id,
        teamId: requestDTO.id,
        summary: statusOnly
          ? `${requestDTO.isActive ? "Restored" : "Retired"} team ${requestDTO.name}`
          : `Updated team ${requestDTO.name}`,
        changes: { fields: fieldChanges },
      });
    }

    revalidatePath(ROUTES.ADMIN_TEAMS);

    return team?.id;
  } catch (error) {
    throw handleError("updateTeamService", error);
  }
}

// -------------------------------------------------------------------
// Add a user to a team.
//
// This is an AUTHORIZATION change, not a piece of admin housekeeping: team
// membership is what every team-scoped query filters on, and a team_role of
// 'manager' is how a manager is given a team at all. It is audited as
// carefully as a role change, and the audited event is what actually happened
// - a re-add of somebody already in the team writes nothing and records
// nothing.
// -------------------------------------------------------------------
export async function addTeamMemberService(requestDTO: AddTeamMemberRequestDTO): Promise<void> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const team = await requireTeam(requestDTO.teamId);

    // Re-check the account server-side. The picker only offers assignable
    // users, but the id arrives from the client, so what the picker showed is
    // not evidence of anything.
    const user = await getUserByUserIdRepo(requestDTO.userId);

    if (!user || !isAssignable(user)) {
      throw new DisplayErrorMessage("That account cannot be added to a team.");
    }

    const now = new Date();

    const newTeamMember: NewTeamMember = {
      id: generateId(),
      teamId: team.id,
      userId: user.id,
      teamRole: requestDTO.teamRole,
      createdAt: now,
      updatedAt: now,
    };

    const membership = await addTeamMemberRepo(newTeamMember);

    // Undefined means they were already in the team and the existing row was
    // left untouched. Nothing changed, so nothing is recorded.
    if (!membership) return;

    await recordAuditEvent({
      action: AUDIT_ACTIONS.TEAM_MEMBER_ADDED,
      entityType: AUDIT_ENTITY_TYPES.TEAM_MEMBER,
      entityId: membership.id,
      teamId: team.id,
      subjectUserId: user.id,
      summary: `Added ${user.name} to ${team.name} as ${TEAM_ROLE_LABELS[requestDTO.teamRole]}`,
      metadata: { teamRole: requestDTO.teamRole },
    });

    revalidatePath(ROUTES.ADMIN_TEAMS);
    // A membership change moves what the manager area shows that person.
    revalidatePath(ROUTES.MANAGE_TEAMS);
  } catch (error) {
    throw handleError("addTeamMemberService", error);
  }
}

// -------------------------------------------------------------------
// Change a user's role within one team. Promoting somebody to 'manager' hands
// them the team, so this is audited with the before and after role.
// -------------------------------------------------------------------
export async function updateTeamMemberRoleService(requestDTO: UpdateTeamMemberRoleRequestDTO): Promise<void> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const team = await requireTeam(requestDTO.teamId);

    const members = await getTeamMembersRepo(team.id);
    const before = members.find((member) => member.userId === requestDTO.userId);

    if (!before) {
      throw new DisplayErrorMessage("That person is not in this team.");
    }

    if (before.teamRole === requestDTO.teamRole) return;

    const membership = await updateTeamMemberRoleRepo(team.id, requestDTO.userId, requestDTO.teamRole);

    if (!membership) return;

    await recordAuditEvent({
      action: AUDIT_ACTIONS.TEAM_MEMBER_ROLE_CHANGED,
      entityType: AUDIT_ENTITY_TYPES.TEAM_MEMBER,
      entityId: membership.id,
      teamId: team.id,
      subjectUserId: requestDTO.userId,
      summary: `Changed ${before.name}'s role in ${team.name} to ${TEAM_ROLE_LABELS[requestDTO.teamRole]}`,
      changes: {
        fields: diffFields([
          {
            field: "teamRole",
            label: "Team role",
            from: TEAM_ROLE_LABELS[before.teamRole],
            to: TEAM_ROLE_LABELS[requestDTO.teamRole],
          },
        ]),
      },
    });

    revalidatePath(ROUTES.ADMIN_TEAMS);
    revalidatePath(ROUTES.MANAGE_TEAMS);
  } catch (error) {
    throw handleError("updateTeamMemberRoleService", error);
  }
}

// -------------------------------------------------------------------
// Remove a user from a team. Only the membership goes; the account and
// everything else they hold are untouched.
// -------------------------------------------------------------------
export async function removeTeamMemberService(requestDTO: RemoveTeamMemberRequestDTO): Promise<void> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const team = await requireTeam(requestDTO.teamId);

    // Read the row before deleting it: afterwards there is nothing left to
    // name in the trail.
    const members = await getTeamMembersRepo(team.id);
    const before = members.find((member) => member.userId === requestDTO.userId);

    if (!before) return;

    await removeTeamMemberRepo(team.id, requestDTO.userId);

    await recordAuditEvent({
      action: AUDIT_ACTIONS.TEAM_MEMBER_REMOVED,
      entityType: AUDIT_ENTITY_TYPES.TEAM_MEMBER,
      entityId: before.membershipId,
      teamId: team.id,
      subjectUserId: requestDTO.userId,
      summary: `Removed ${before.name} from ${team.name}`,
      metadata: { teamRole: before.teamRole },
    });

    revalidatePath(ROUTES.ADMIN_TEAMS);
    revalidatePath(ROUTES.MANAGE_TEAMS);
  } catch (error) {
    throw handleError("removeTeamMemberService", error);
  }
}
