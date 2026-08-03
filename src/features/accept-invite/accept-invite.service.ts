import "server-only";

import { generateId } from "better-auth";
import { headers } from "next/headers";

import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import { auth } from "@/lib/auth/auth";
import {
  INVITATION_STATUS,
  NewTeamMember,
  TEAM_ROLES,
  UpdateUser,
  UpdateUserInvitation,
  USER_ROLES,
  UserInvitation,
} from "@/lib/data/kysely-database-types";
import { addTeamMemberRepo } from "@/lib/data/repositories/team-members.repository";
import {
  getUserInvitationByTokenRepo,
  updateUserInvitationRepo,
} from "@/lib/data/repositories/user-invitations.repository";
import { updateUserByIdRepo } from "@/lib/data/repositories/users.repository";
import { InvitationCompletedRedirectError } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";

import { ExpiredInvitation, InvalidInvitation } from "./accept-invite.errors";
import {
  AcceptInviteAndSignUpRequestDTO,
  ValidateInviteRequestDTO,
  ValidateInviteResponseDTO,
} from "./accept-invite.types";

// -------------------------------------------------------------------
// Accepting an invitation.
//
// This is the ONLY path that creates an account, and the only one that can
// grant a role above 'member' or place somebody into a team. Everything it
// grants comes from the stored invitation row, never from the request: the
// caller supplies a token and a password, and nothing else it sends is
// allowed to influence what the new account can reach.
//
// There is no session yet, so there is no role guard here. The token IS the
// credential, which is why it is re-validated immediately before the account
// is created rather than only when the page was first loaded.
// -------------------------------------------------------------------

// Read and check an invitation, throwing the right display error for each way
// it can be unusable. Returns the row so callers can use its team placement.
async function requireUsableInvitation(inviteToken: string): Promise<UserInvitation> {
  // The token IS the invitation id, so an unknown or tampered token simply
  // finds nothing.
  const userInvitation = await getUserInvitationByTokenRepo(inviteToken);

  if (!userInvitation) {
    throw new InvalidInvitation();
  }

  if (userInvitation.status === INVITATION_STATUS.EXPIRED || userInvitation.status === INVITATION_STATUS.REVOKED) {
    throw new InvalidInvitation();
  }

  // Expiry is checked against the stored timestamp, not the status column: a
  // row can still say 'pending' long after it lapsed, because nothing sweeps
  // them. The timestamp is the fact; the status is a record of intent.
  if (userInvitation.expiresAt < new Date()) {
    throw new ExpiredInvitation();
  }

  // Already used: send them to sign in rather than implying the link is bad.
  if (userInvitation.status === INVITATION_STATUS.COMPLETED) {
    throw new InvitationCompletedRedirectError();
  }

  return userInvitation;
}

// -------------------------------------------------------------------
// Validate Invite
// What the accept-invite page shows before anyone types a password. It
// returns the name, email and role from the invitation and nothing else -
// no team, no inviter, no id - so a guessed token reveals as little as
// possible about the organisation.
// -------------------------------------------------------------------
export async function validateInviteService(requestDTO: ValidateInviteRequestDTO): Promise<ValidateInviteResponseDTO> {
  try {
    const userInvitation = await requireUsableInvitation(requestDTO.inviteToken);

    return {
      name: userInvitation.name,
      email: userInvitation.email,
      role: userInvitation.role,
    };
  } catch (error) {
    throw handleError("validateInviteService", error);
  }
}

// -------------------------------------------------------------------
// Accept Invite and Sign Up
// -------------------------------------------------------------------
export async function acceptInviteAndSignUpService(requestDTO: AcceptInviteAndSignUpRequestDTO): Promise<void> {
  try {
    // Re-validate at the moment of use. The page validated on load, but the
    // invitation can have been revoked or have expired since, and that gap is
    // exactly when an account must not be created.
    const userInvitation = await requireUsableInvitation(requestDTO.inviteToken);

    // Create the account.
    //
    // `role` is intentionally NOT passed: it is an input:false field, so Better
    // Auth ignores any body-supplied role and creates the user with the default
    // ('member'). The invited role is assigned by the trusted write below.
    const signUpResult = await auth.api.signUpEmail({
      body: {
        name: userInvitation.name,
        email: userInvitation.email,
        password: requestDTO.password,
      },
      // Instructs the backend API to inject the new session cookie straight
      // into the response headers, so the person lands signed in.
      headers: await headers(),
    });

    const newUserId = signUpResult.user.id;

    // Assign the invited role from the STORED invitation. A member invite
    // needs no write - the default is already 'member'.
    if (userInvitation.role !== USER_ROLES.MEMBER) {
      const updateUser: UpdateUser = {
        role: userInvitation.role,
        updatedAt: new Date(),
      };

      await updateUserByIdRepo(newUserId, updateUser);
    }

    // Team placement, if the invitation carried one. The team id comes off the
    // invitation row an admin created, so it has already been checked - it is
    // never read from the request.
    if (userInvitation.teamId) {
      const now = new Date();

      const newTeamMember: NewTeamMember = {
        id: generateId(),
        teamId: userInvitation.teamId,
        userId: newUserId,
        // A missing team role means an ordinary member of the team. Defaulting
        // to 'member' rather than to whatever the platform role is keeps a new
        // manager from silently gaining management of a team the invitation
        // did not name them manager of.
        teamRole: userInvitation.teamRole ?? TEAM_ROLES.MEMBER,
        createdAt: now,
        updatedAt: now,
      };

      await addTeamMemberRepo(newTeamMember);

      // Membership is an authorization change, so it is recorded as carefully
      // as the role change above.
      await recordAuditEvent({
        action: AUDIT_ACTIONS.TEAM_MEMBER_ADDED,
        entityType: AUDIT_ENTITY_TYPES.TEAM_MEMBER,
        entityId: newTeamMember.id,
        teamId: userInvitation.teamId,
        subjectUserId: newUserId,
        summary: "Joined a team by accepting an invitation",
        // The actor is the person accepting: they have a session by now, but
        // resolving it would depend on the cookie having been applied, so it
        // is stated from what we already know.
        actor: { id: newUserId, role: userInvitation.role, name: userInvitation.name },
      });
    }

    // Mark the invitation used. Last, so a failure anywhere above leaves the
    // link still valid to retry rather than burning it.
    const updateUserInvitation: UpdateUserInvitation = {
      status: INVITATION_STATUS.COMPLETED,
      updatedAt: new Date(),
    };

    await updateUserInvitationRepo(requestDTO.inviteToken, updateUserInvitation);

    await recordAuditEvent({
      action: AUDIT_ACTIONS.USER_CREATED,
      entityType: AUDIT_ENTITY_TYPES.USER,
      entityId: newUserId,
      teamId: userInvitation.teamId,
      subjectUserId: newUserId,
      summary: `Accepted an invitation and created an account (${userInvitation.role})`,
      actor: { id: newUserId, role: userInvitation.role, name: userInvitation.name },
    });
  } catch (error) {
    throw handleError("acceptInviteAndSignUpService", error);
  }
}
