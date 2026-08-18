import "server-only";

import { generateId } from "better-auth";

import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import {
  INVITATION_STATUS,
  TEAM_ROLES,
  USER_ROLES,
  type NewTeamMember,
} from "@/lib/data/kysely-database-types";
import { addTeamMemberRepo } from "@/lib/data/repositories/team-members.repository";
import {
  getLatestInvitationByEmailRepo,
  updateUserInvitationRepo,
} from "@/lib/data/repositories/user-invitations.repository";
import { updateUserByIdRepo } from "@/lib/data/repositories/users.repository";

// -------------------------------------------------------------------
// Apply a pending invitation to an account that has just been created.
//
// WHAT AN INVITATION MEANS NOW. It is no longer a gate - anybody in the
// tenant on an allowed domain can sign in and get an account. An invitation
// is how an admin says IN ADVANCE what that person should land as: a role
// above member, and a team. Without one, they land as a member in no team
// and an admin sets both afterwards.
//
// Keeping invitations for this rather than deleting them means "invite Sam
// as manager of the Delivery team" still works, and the person never sees an
// invitation step - they just sign in with Microsoft and are already in the
// right place.
//
// Matched on the address the identity provider asserted, never on a token in
// a link. Somebody cannot pick up a colleague's invitation by opening their
// email, because the match is against the address Entra verified.
// -------------------------------------------------------------------
export async function applyInvitationOnFirstSignIn(userId: string, email: string): Promise<void> {
  const invitation = await getLatestInvitationByEmailRepo(email.trim().toLowerCase());

  // No invitation is the normal case, not an error.
  if (!invitation) return;

  if (invitation.expiresAt.getTime() <= Date.now()) return;

  // The role first. A member invitation needs no write - that is already the
  // default a new account is created with.
  if (invitation.role !== USER_ROLES.MEMBER) {
    await updateUserByIdRepo(userId, { role: invitation.role, updatedAt: new Date() });
  }

  if (invitation.teamId) {
    const now = new Date();

    const newTeamMember: NewTeamMember = {
      id: generateId(),
      teamId: invitation.teamId,
      userId,
      // A missing team role means an ordinary member of the team. Defaulting
      // to 'member' rather than to the platform role keeps a new manager from
      // silently gaining management of a team the invitation did not name
      // them manager of.
      teamRole: invitation.teamRole ?? TEAM_ROLES.MEMBER,
      createdAt: now,
      updatedAt: now,
    };

    await addTeamMemberRepo(newTeamMember);

    // Membership is an authorization change, so it is recorded like any
    // other. The actor is stated rather than resolved from a session: this
    // runs inside account creation, before there is one.
    await recordAuditEvent({
      action: AUDIT_ACTIONS.TEAM_MEMBER_ADDED,
      entityType: AUDIT_ENTITY_TYPES.TEAM_MEMBER,
      entityId: newTeamMember.id,
      teamId: invitation.teamId,
      subjectUserId: userId,
      summary: "Joined a team from a pending invitation on first sign-in",
      actor: { id: userId, role: invitation.role, name: invitation.name },
    });
  }

  // Marked last, so a failure above leaves the invitation pending and the
  // whole thing retryable rather than silently half-applied.
  await updateUserInvitationRepo(invitation.id, {
    status: INVITATION_STATUS.COMPLETED,
    updatedAt: new Date(),
  });
}
