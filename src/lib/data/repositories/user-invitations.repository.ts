import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import {
  INVITATION_STATUS,
  NewUserInvitation,
  STAFF_ROLES,
  USER_ROLES,
  UpdateUserInvitation,
  UserInvitation,
} from "../kysely-database-types";

// -------------------------------------------------------------------
// An invitation says what ROLE the person lands with, and nothing else. It
// used to carry a team as well; teams are gone from the base, so acceptance
// applies a role and stops there.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Get an invitation by token. The token IS the invitation id, so an unknown
// or tampered token simply finds nothing - undefined here means "no such
// invitation", and the caller still has to check status and expiry.
// -------------------------------------------------------------------
export async function getUserInvitationByTokenRepo(
  inviteToken: string,
  db: DBClient = database,
): Promise<UserInvitation | undefined> {
  try {
    return await db.selectFrom("userInvitations").selectAll().where("id", "=", inviteToken).executeTakeFirst();
  } catch (error) {
    throw handleError("getUserInvitationByTokenRepo", error);
  }
}

// -------------------------------------------------------------------
// The most recent PENDING invitation for an email. Only pending rows count:
// an email can have several invitations, and a revoked or expired one is
// newer than the still-valid one it superseded. Matching on email alone
// would let the revoked row win on created_at and apply its role.
//
// Even so, an email lookup is a fallback, not the authority. The link the
// user actually clicked identifies exactly one invitation, so the role
// must come from the token row (getUserInvitationByTokenRepo) - that is the
// only row that can be shown to be the one accepted. Two concurrent pending
// invitations to the same address are indistinguishable by email.
// -------------------------------------------------------------------
export async function getLatestInvitationByEmailRepo(
  email: string,
  db: DBClient = database,
): Promise<UserInvitation | undefined> {
  try {
    return await db
      .selectFrom("userInvitations")
      .selectAll()
      .where("email", "=", email)
      .where("status", "=", INVITATION_STATUS.PENDING)
      .orderBy("createdAt", "desc")
      .limit(1)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getLatestInvitationByEmailRepo", error);
  }
}

// -------------------------------------------------------------------
// Pending invitations for staff accounts (admins and managers), newest first.
// -------------------------------------------------------------------
export async function getPendingStaffUserInvitationsRepo(db: DBClient = database): Promise<UserInvitation[]> {
  try {
    return await db
      .selectFrom("userInvitations")
      .selectAll()
      .where("role", "in", [...STAFF_ROLES])
      .where("status", "=", INVITATION_STATUS.PENDING)
      .orderBy("createdAt", "desc")
      .execute();
  } catch (error) {
    throw handleError("getPendingStaffUserInvitationsRepo", error);
  }
}

// -------------------------------------------------------------------
// Pending invitations for member accounts, newest first.
// -------------------------------------------------------------------
export async function getPendingMemberUserInvitationsRepo(db: DBClient = database): Promise<UserInvitation[]> {
  try {
    return await db
      .selectFrom("userInvitations")
      .selectAll()
      .where("role", "=", USER_ROLES.MEMBER)
      .where("status", "=", INVITATION_STATUS.PENDING)
      .orderBy("createdAt", "desc")
      .execute();
  } catch (error) {
    throw handleError("getPendingMemberUserInvitationsRepo", error);
  }
}

// -------------------------------------------------------------------
// Add an invitation. `role` is the platform role and is server-assigned;
export async function addUserInvitationRepo(
  newUserInvitation: NewUserInvitation,
  db: DBClient = database,
): Promise<UserInvitation> {
  try {
    return await db.insertInto("userInvitations").values(newUserInvitation).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addUserInvitationRepo", error);
  }
}

// -------------------------------------------------------------------
// Update an invitation - marking it completed, expired or revoked. Throws if
// the id does not exist, because every caller is acting on an invitation it
// has already read.
// -------------------------------------------------------------------
export async function updateUserInvitationRepo(
  id: string,
  updateUserInvitation: UpdateUserInvitation,
  db: DBClient = database,
): Promise<UserInvitation> {
  try {
    // Updateable<UserInvitations> allows id and createdAt, so a patch that
    // carried either would rewrite the identity of the row the WHERE matched.
    // The id here IS the invite token, so letting it move would hand out a
    // token of the caller's choosing. Drop both before the spread.
    const patch: UpdateUserInvitation = { ...updateUserInvitation };
    delete patch.id;
    delete patch.createdAt;

    return await db
      .updateTable("userInvitations")
      // Nothing stamps updated_at in the database, so the repository does it.
      .set({ ...patch, updatedAt: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("updateUserInvitationRepo", error);
  }
}
