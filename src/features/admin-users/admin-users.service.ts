import "server-only";

import { addDays } from "date-fns";
import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { diffFields } from "@/lib/audit/audit-diff";
import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import { INVITE_EXPIRY_DAYS } from "@/lib/constants";
import {
  INVITATION_STATUS,
  NewUserInvitation,
  TEAM_ROLE_LABELS,
  UpdateUser,
  UpdateUserInvitation,
  USER_ROLES,
  USER_ROLE_LABELS,
  UserRole,
} from "@/lib/data/kysely-database-types";
import { getTeamMembersForTeamsRepo } from "@/lib/data/repositories/team-members.repository";
import { getActiveTeamsRepo, getAllTeamsRepo, getTeamByIdRepo } from "@/lib/data/repositories/teams.repository";
import {
  addUserInvitationRepo,
  getPendingMemberUserInvitationsRepo,
  getPendingStaffUserInvitationsRepo,
  getUserInvitationByTokenRepo,
  updateUserInvitationRepo,
} from "@/lib/data/repositories/user-invitations.repository";
import { deleteSessionsByUserIdRepo } from "@/lib/data/repositories/sessions.repository";
import { clearSessionTwoFactorForUserRepo } from "@/lib/data/repositories/session-two-factor.repository";
import {
  deleteTwoFactorForUserRepo,
  getUserIdsWithTwoFactorRepo,
  hasTwoFactorRepo,
} from "@/lib/data/repositories/two-factor.repository";
import {
  getMemberUsersRepo,
  getStaffUsersRepo,
  getUserByEmailRepo,
  getUserByUserIdRepo,
  updateUserByIdRepo,
} from "@/lib/data/repositories/users.repository";
import { generateInvitationLink } from "@/lib/email/generate-user-invitation-link";
import { sendAdminUserInvitationEmail } from "@/lib/email/send-email";
import { DisplayErrorMessage, UserWithEmailAlreadyExistsDisplayError } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import {
  groupTeamsByUserId,
  mapDBInvitationToAdminUserResponseDTO,
  mapDBTeamToInvitableTeamDTO,
  mapDBUserToAdminUserResponseDTO,
} from "./admin-users.mappers";
import {
  ADMIN_USER_DISPLAY_STATUS,
  AddAdminUserInvitationRequestDTO,
  AdminUserDisplayStatusType,
  AdminUserResponseDTO,
  CancelAdminUserInvitationRequestDTO,
  InvitableTeamDTO,
  ResetUserTwoFactorRequestDTO,
  UpdateAdminUserRequestDTO,
} from "./admin-users.types";

// -------------------------------------------------------------------
// Admin Users
//
// Every entry point in this file opens with requireUserRole([ADMIN]).
//
// The guard lives HERE rather than only in the action because a service is
// reachable from anywhere on the server - another feature's page, a job, a
// future route handler - and only the guard it carries itself travels with it.
// The action guards too; neither is load-bearing alone.
//
// Managing accounts is not team-scoped: an admin is unrestricted, and there is
// deliberately no manager-facing version of this screen. Changing somebody's
// platform role or team membership is an authorization change, so it stays
// with the admin.
// -------------------------------------------------------------------

// Pending first would bury the people who actually have accounts, so the list
// leads with active users and sinks the ones who cannot sign in.
const STATUS_ORDER: Record<AdminUserDisplayStatusType, number> = {
  [ADMIN_USER_DISPLAY_STATUS.Active]: 1,
  [ADMIN_USER_DISPLAY_STATUS.Pending]: 2,
  [ADMIN_USER_DISPLAY_STATUS.Inactive]: 3,
};

function roleLabel(role: UserRole | null | undefined): string | null {
  return role ? (USER_ROLE_LABELS[role] ?? role) : null;
}

// -------------------------------------------------------------------
// Everyone with an account, plus everyone with a pending invitation.
//
// Users are read as staff + members rather than "all rows" because the
// repository exposes exactly those two role-scoped queries, and the union is
// every role in USER_ROLES. Adding a fourth role would need a repository
// change, which is the right place to notice it.
// -------------------------------------------------------------------
export async function getAdminUsersService(): Promise<AdminUserResponseDTO[]> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const [staffUsers, memberUsers, staffInvitations, memberInvitations, teams] = await Promise.all([
      getStaffUsersRepo(),
      getMemberUsersRepo(),
      getPendingStaffUserInvitationsRepo(),
      getPendingMemberUserInvitationsRepo(),
      getAllTeamsRepo(),
    ]);

    // One membership query for every team, then grouped in memory - the
    // alternative is a query per user, which grows with the account list.
    const memberships = await getTeamMembersForTeamsRepo(teams.map((team) => team.id));
    const teamsByUserId = groupTeamsByUserId(memberships, teams);
    const teamNameById = new Map(teams.map((team) => [team.id, team.name]));

    // One query for everyone with a second factor, for the same reason: a
    // per-row lookup would be a query per person on a screen that lists them
    // all. Only ids come back - never a secret or a backup code.
    const twoFactorUserIds = await getUserIdsWithTwoFactorRepo();

    const userRows = [...staffUsers, ...memberUsers].map((user) =>
      mapDBUserToAdminUserResponseDTO(
        user,
        teamsByUserId.get(user.id) ?? [],
        twoFactorUserIds.has(user.id),
      ),
    );

    const invitationRows = [...staffInvitations, ...memberInvitations].map((invitation) =>
      mapDBInvitationToAdminUserResponseDTO(invitation, teamNameById),
    );

    return [...userRows, ...invitationRows].sort(
      (a, b) => STATUS_ORDER[a.displayStatus] - STATUS_ORDER[b.displayStatus] || a.name.localeCompare(b.name),
    );
  } catch (error) {
    throw handleError("getAdminUsersService", error);
  }
}

// -------------------------------------------------------------------
// Clear somebody's app-level second factor, so they can enrol again.
//
// THE CASE THIS EXISTS FOR: a person deletes their authenticator app,
// loses the phone, or never saved the backup codes. They cannot verify, so
// they cannot reach any part of the app, and by design there is no
// self-service way out - one would be a way around the factor.
//
// WHAT IT GRANTS AN ADMIN, stated plainly: nothing they did not already
// have. A reset does not sign anybody in - the account still needs a
// Microsoft sign-in, which this app cannot perform - and an admin already
// holds impersonation, which reaches the same data directly. So the risk
// is not privilege escalation, it is deniability, and the answer is the
// same one impersonation uses: the act is recorded naming both parties.
//
// THREE WRITES, AND THE ORDER MATTERS.
//   1. the secret goes, so the old authenticator stops working,
//   2. the flag goes, so the gate stops treating them as enrolled, and
//   3. every session verification they hold is cleared.
//
// Step 3 is the one that is easy to leave out and the one that matters
// most. Without it, a session that had already verified stays verified -
// so if the reset is being done because a phone was stolen, the thief's
// still-signed-in session keeps its access on the strength of the factor
// that was just revoked.
//
// Sessions are deliberately NOT deleted. The person is usually sitting on
// the verify screen when they ask for this; signing them out would make
// them start at Microsoft again for no gain, and clearing the verification
// already forces them back through enrolment.
// -------------------------------------------------------------------
export async function resetUserTwoFactorService(
  requestDTO: ResetUserTwoFactorRequestDTO,
): Promise<void> {
  try {
    const actingUser = await requireUserRole([USER_ROLES.ADMIN]);

    const subject = await getUserByUserIdRepo(requestDTO.id);

    // Answering the same way for "no such account" and "nothing to reset"
    // keeps a guessed id from confirming an account exists.
    if (!subject) {
      throw new DisplayErrorMessage("That account could not be found.");
    }

    if (!(await hasTwoFactorRepo(subject.id))) {
      throw new DisplayErrorMessage(
        `${subject.name} does not have two-factor authentication set up, so there is nothing to reset.`,
      );
    }

    await deleteTwoFactorForUserRepo(subject.id);

    await updateUserByIdRepo(subject.id, { twoFactorEnabled: false, updatedAt: new Date() });

    await clearSessionTwoFactorForUserRepo(subject.id);

    // Both parties named, for the reason above. No secret, no backup code
    // and no count of either goes in the trail - only that it happened.
    await recordAuditEvent({
      action: AUDIT_ACTIONS.AUTH_TWO_FACTOR_RESET,
      entityType: AUDIT_ENTITY_TYPES.USER,
      entityId: subject.id,
      subjectUserId: subject.id,
      summary: `${actingUser.name ?? actingUser.email} reset two-factor authentication for ${subject.name}`,
    });

    revalidatePath(ROUTES.ADMIN_USERS);
  } catch (error) {
    throw handleError("resetUserTwoFactorService", error);
  }
}

// -------------------------------------------------------------------
// The teams an invitation can place somebody into. Active only: a retired
// team must not gain new members through the back door of an invite.
// -------------------------------------------------------------------
export async function getInvitableTeamsService(): Promise<InvitableTeamDTO[]> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const teams = await getActiveTeamsRepo();

    return teams.map(mapDBTeamToInvitableTeamDTO);
  } catch (error) {
    throw handleError("getInvitableTeamsService", error);
  }
}

// -------------------------------------------------------------------
// Update a user's platform role and/or active status.
//
// Both are server-assigned values: they arrive from an admin-guarded action,
// never from the account being changed.
// -------------------------------------------------------------------
export async function updateAdminUserService(requestDTO: UpdateAdminUserRequestDTO): Promise<string | undefined> {
  try {
    const actingUser = await requireUserRole([USER_ROLES.ADMIN]);

    // Nothing to do - return before writing anything or logging a no-op.
    if (requestDTO.userRole === undefined && requestDTO.isActive === undefined) {
      return undefined;
    }

    // An admin cannot demote or deactivate themselves. Either one takes effect
    // immediately and removes the access needed to undo it, so the last admin
    // could lock the whole product out with one click. Changing somebody
    // else's account is unaffected.
    if (requestDTO.id === actingUser.id) {
      if (requestDTO.userRole !== undefined && requestDTO.userRole !== USER_ROLES.ADMIN) {
        throw new DisplayErrorMessage("You cannot change your own role. Ask another admin to do it.");
      }
      if (requestDTO.isActive === false) {
        throw new DisplayErrorMessage("You cannot deactivate your own account.");
      }
    }

    // Snapshot the current role/status first so the audit trail shows
    // before -> after. Best-effort: a failure to read the old values must not
    // block the change itself, so the trail just records the new ones.
    const before = await getUserByUserIdRepo(requestDTO.id).catch(() => null);

    const updateUser: UpdateUser = {
      ...(requestDTO.isActive !== undefined && { isActive: requestDTO.isActive }),
      ...(requestDTO.userRole !== undefined && { role: requestDTO.userRole }),
      updatedAt: new Date(),
    };

    // Explicitly false, not falsy. `undefined` here means "active status is not
    // being changed", and treating that as a deactivation would sign the person
    // out every time an admin edited only their role.
    if (requestDTO.isActive === false) {
      await deleteSessionsByUserIdRepo(requestDTO.id);
    }

    const user = await updateUserByIdRepo(requestDTO.id, updateUser);

    const fieldChanges = diffFields([
      ...(requestDTO.userRole !== undefined
        ? [{ field: "role", label: "Role", from: roleLabel(before?.role), to: roleLabel(requestDTO.userRole) }]
        : []),
      ...(requestDTO.isActive !== undefined
        ? [{ field: "isActive", label: "Active", from: before?.isActive ?? null, to: requestDTO.isActive }]
        : []),
    ]);

    // A role change is an authorization change, so it gets its own action
    // rather than being folded into a generic "updated" - the activity viewer
    // and its filters treat the two differently.
    const action =
      requestDTO.userRole !== undefined
        ? AUDIT_ACTIONS.USER_ROLE_CHANGED
        : AUDIT_ACTIONS.USER_STATUS_CHANGED;

    await recordAuditEvent({
      action,
      entityType: AUDIT_ENTITY_TYPES.USER,
      entityId: requestDTO.id,
      subjectUserId: requestDTO.id,
      summary: `Updated ${user?.name ?? requestDTO.id}`,
      changes: { fields: fieldChanges },
    });

    revalidatePath(ROUTES.ADMIN_USERS);

    return user?.id;
  } catch (error) {
    throw handleError("updateAdminUserService", error);
  }
}

// -------------------------------------------------------------------
// Cancel a pending invitation (revoke it). Nothing is deleted, so the record
// that somebody was invited and then revoked survives.
// -------------------------------------------------------------------
export async function cancelAdminInvitationService(
  requestDTO: CancelAdminUserInvitationRequestDTO,
): Promise<string | undefined> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const invitation = await getUserInvitationByTokenRepo(requestDTO.id);

    if (!invitation) {
      throw new DisplayErrorMessage("That invitation no longer exists.");
    }

    // Only a pending invitation can be revoked. Revoking a COMPLETED one would
    // do nothing to the account it already created while making the trail read
    // as though access had been withdrawn.
    if (invitation.status !== INVITATION_STATUS.PENDING) {
      throw new DisplayErrorMessage("That invitation has already been used or cancelled.");
    }

    const updateUserInvitation: UpdateUserInvitation = {
      status: INVITATION_STATUS.REVOKED,
      updatedAt: new Date(),
    };

    const userInvitation = await updateUserInvitationRepo(requestDTO.id, updateUserInvitation);

    await recordAuditEvent({
      action: AUDIT_ACTIONS.USER_INVITATION_CANCELLED,
      entityType: AUDIT_ENTITY_TYPES.USER,
      entityId: userInvitation.id,
      teamId: userInvitation.teamId,
      summary: `Cancelled the invitation for ${userInvitation.email}`,
    });

    revalidatePath(ROUTES.ADMIN_USERS);

    return userInvitation.id;
  } catch (error) {
    throw handleError("cancelAdminInvitationService", error);
  }
}

// -------------------------------------------------------------------
// Invite somebody, optionally placing them into a team on acceptance.
//
// The inviter is the SESSION user, passed in by the action - never a field on
// the form, or the trail would record whoever the client claimed to be.
// -------------------------------------------------------------------
export async function addAdminUserInvitationService(
  requestDTO: AddAdminUserInvitationRequestDTO,
  sessionUserId: string,
): Promise<string> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    // An existing account cannot be re-invited: accepting would try to sign up
    // an email that is already taken, which fails after the person has clicked
    // the link. Fail here, where the admin can see it.
    const existingUser = await getUserByEmailRepo(requestDTO.email);

    if (existingUser) {
      throw new UserWithEmailAlreadyExistsDisplayError();
    }

    // A team id from the form is a claim, not a fact. Resolve it and confirm
    // the team is real and still active before storing it - the invitation is
    // what later grants membership, so an unchecked id here becomes access
    // later.
    let teamId: string | null = null;
    let teamName: string | null = null;

    if (requestDTO.teamId) {
      const team = await getTeamByIdRepo(requestDTO.teamId);

      if (!team || !team.isActive) {
        throw new DisplayErrorMessage("That team is no longer available. Choose another.");
      }

      teamId = team.id;
      teamName = team.name;
    }

    // teamRole without a teamId is rejected by a CHECK constraint, so drop it
    // rather than sending a row the database will refuse.
    const teamRole = teamId ? (requestDTO.teamRole ?? null) : null;

    const currentDate = new Date();
    const expiresAt = addDays(currentDate, INVITE_EXPIRY_DAYS);

    const newUserInvitation: NewUserInvitation = {
      id: generateId(),
      name: requestDTO.name,
      email: requestDTO.email,
      role: requestDTO.userRole,
      status: INVITATION_STATUS.PENDING,
      expiresAt,
      inviterId: sessionUserId,
      teamId,
      teamRole,
      createdAt: currentDate,
      updatedAt: currentDate,
    };

    const userInvitation = await addUserInvitationRepo(newUserInvitation);

    const userInvitationLink = await generateInvitationLink();

    await sendAdminUserInvitationEmail({
      toAddress: requestDTO.email,
      subject: "You have been invited",
      inviteUrl: userInvitationLink,
      recipientName: requestDTO.name,
      role: USER_ROLE_LABELS[requestDTO.userRole],
      expiryDays: INVITE_EXPIRY_DAYS,
    });

    await recordAuditEvent({
      action: AUDIT_ACTIONS.USER_INVITED,
      entityType: AUDIT_ENTITY_TYPES.USER,
      entityId: userInvitation.id,
      teamId,
      summary: teamName
        ? `Invited ${requestDTO.email} as ${USER_ROLE_LABELS[requestDTO.userRole]}, joining ${teamName}`
        : `Invited ${requestDTO.email} as ${USER_ROLE_LABELS[requestDTO.userRole]}`,
      changes: {
        fields: diffFields([
          { field: "role", label: "Role", from: null, to: USER_ROLE_LABELS[requestDTO.userRole] },
          { field: "team", label: "Team", from: null, to: teamName },
          {
            field: "teamRole",
            label: "Role in team",
            from: null,
            to: teamRole ? TEAM_ROLE_LABELS[teamRole] : null,
          },
        ]),
      },
    });

    revalidatePath(ROUTES.ADMIN_USERS);

    return userInvitation.id;
  } catch (error) {
    throw handleError("addAdminUserInvitationService", error);
  }
}
