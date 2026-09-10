import "server-only";

import { revalidatePath } from "next/cache";

import { diffFields } from "@/lib/audit/audit-diff";
import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import { requireUser } from "@/lib/auth/session-auth-server";
import { type UpdateUser } from "@/lib/data/kysely-database-types";
import { getUserByUserIdRepo, updateUserByIdRepo } from "@/lib/data/repositories/users.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import { mapDBUserToPortalAccountResponseDTO } from "./portal-account.mappers";
import { PortalAccountResponseDTO, UpdatePortalAccountRequestDTO } from "./portal-account.types";

// -------------------------------------------------------------------
// The signed-in person's own account
//
// EVERY ROLE, and it used to be members only. requireUserRole([MEMBER]) meant
// an administrator or a manager had no account page AT ALL - not a missing
// link, a missing page: the one screen where somebody sets what they would
// rather be called was reachable by exactly one of the three audiences, and
// the other two had no route to it from anywhere in the app.
//
// requireUser is the RIGHT guard rather than a widened one. Nothing on this
// screen is scoped by role: it reads and writes the caller's own row, resolved
// from the session, and a role is not a scope. The MEMBER check was never
// protecting the data - it was describing which area the page happened to be
// mounted in, which is a routing fact and not an authorization one.
//
// The session id is the ONLY user id that reaches a repository in this file:
// there is no argument carrying one and no branch that could substitute one,
// which is what makes editing somebody else's profile unrepresentable rather
// than merely rejected. That is what makes this safe for any role, and it was
// already true before the guard changed.
//
// The guard lives here rather than only in the actions. Each area layout and
// the actions check as well, but a service that relies on its caller is only
// as safe as the least careful caller it ever acquires.
// -------------------------------------------------------------------

// An empty optional profile field is stored as NULL, not as "". Both mean
// "not set", and keeping one representation means a later "is it set" check
// cannot disagree with itself.
function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// -------------------------------------------------------------------
// The signed-in member's own account.
// -------------------------------------------------------------------
export async function getPortalAccountService(): Promise<PortalAccountResponseDTO> {
  try {
    const sessionUser = await requireUser();

    const user = await getUserByUserIdRepo(sessionUser.id);

    // A live session whose user row is gone means the account was deleted
    // mid-session. There is nothing to show and nothing to edit.
    if (!user) {
      throw new DisplayErrorMessage("We could not load your account. Please sign in again.");
    }

    return mapDBUserToPortalAccountResponseDTO(user);
  } catch (error) {
    throw handleError("getPortalAccountService", error);
  }
}

// -------------------------------------------------------------------
// Save the signed-in member's own details.
//
// Name, preferred name and phone are the whole of what a member may change
// about themselves. Role and isActive are server-assigned and are never part
// of the patch built here, so no request shape can reach them.
// -------------------------------------------------------------------
export async function updatePortalAccountService(requestDTO: UpdatePortalAccountRequestDTO): Promise<void> {
  try {
    const sessionUser = await requireUser();

    const before = await getUserByUserIdRepo(sessionUser.id);

    if (!before) {
      throw new DisplayErrorMessage("We could not load your account. Please sign in again.");
    }

    const name = requestDTO.name.trim();
    const preferredName = emptyToNull(requestDTO.preferredName);
    const phoneNumber = emptyToNull(requestDTO.phoneNumber);

    const updateUser: UpdateUser = {
      name,
      preferredName,
      phoneNumber,
    };

    await updateUserByIdRepo(sessionUser.id, updateUser);

    const fieldChanges = diffFields([
      { field: "name", label: "Name", from: before.name, to: name },
      { field: "preferredName", label: "Preferred name", from: before.preferredName, to: preferredName },
      { field: "phoneNumber", label: "Phone", from: before.phoneNumber, to: phoneNumber },
    ]);

    if (fieldChanges.length > 0) {
      await recordAuditEvent({
        action: AUDIT_ACTIONS.USER_UPDATED,
        entityType: AUDIT_ENTITY_TYPES.USER,
        entityId: sessionUser.id,
        // The person this was done to is also the person who did it - a member
        // editing themselves - and the trail should say so on both counts.
        subjectUserId: sessionUser.id,
        summary: `${before.name} updated their own account details`,
        changes: { fields: fieldChanges },
      });
    }

    // ALL THREE MOUNTS. The page renders at /admin/account, /manage/account
    // and /portal/account from one feature page, so revalidating only the
    // portal path left an admin looking at their old preferred name until
    // something else happened to invalidate the route.
    revalidatePath(ROUTES.ADMIN_ACCOUNT);
    revalidatePath(ROUTES.MANAGE_ACCOUNT);
    revalidatePath(ROUTES.PORTAL_ACCOUNT);
  } catch (error) {
    throw handleError("updatePortalAccountService", error);
  }
}
