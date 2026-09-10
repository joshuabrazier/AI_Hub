import "server-only";


import {
  INVITATION_STATUS,
  USER_ROLES,
} from "@/lib/data/kysely-database-types";
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
// is how an admin says IN ADVANCE what ROLE that person should land with.
// Without one they land as a member, and an admin changes it afterwards.
//
// IT USED TO PRE-ASSIGN A TEAM AS WELL, and that half is gone with teams
// themselves. What is left is the half that still means something: "invite
// Sam as a manager" works, and the person never sees an invitation step -
// they sign in with Microsoft and are already the right role.
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

  // Marked last, so a failure above leaves the invitation pending and the
  // whole thing retryable rather than silently half-applied.
  await updateUserInvitationRepo(invitation.id, {
    status: INVITATION_STATUS.COMPLETED,
    updatedAt: new Date(),
  });
}
