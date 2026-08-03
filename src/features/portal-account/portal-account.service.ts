import "server-only";

import { revalidatePath } from "next/cache";

import { diffFields } from "@/lib/audit/audit-diff";
import { recordAuditEvent } from "@/lib/audit/audit-log.service";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "@/lib/audit/audit-log.types";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES, type UpdateUser } from "@/lib/data/kysely-database-types";
import { getActiveNotificationTypesRepo } from "@/lib/data/repositories/notification-types.repository";
import { getUserByUserIdRepo, updateUserByIdRepo } from "@/lib/data/repositories/users.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import { mapDBUserToPortalAccountResponseDTO } from "./portal-account.mappers";
import { PortalAccountResponseDTO, UpdatePortalAccountRequestDTO } from "./portal-account.types";

// -------------------------------------------------------------------
// Member portal account service
//
// Both entry points open with requireUserRole([MEMBER]) and then read the
// acting user's id from what that returned. The session id is the ONLY user id
// that reaches a repository in this file: there is no argument carrying one and
// no branch that could substitute one, which is what makes editing somebody
// else's profile unrepresentable rather than merely rejected.
//
// The guard lives here rather than only in the actions. The portal layout and
// the actions check the same thing, but a service that relies on its caller is
// only as safe as the least careful caller it ever acquires.
// -------------------------------------------------------------------

// An empty optional profile field is stored as NULL, not as "". Both mean
// "not set", and keeping one representation means a later "is it set" check
// cannot disagree with itself.
function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// -------------------------------------------------------------------
// The signed-in member's own account, plus the notification types they can
// choose between.
// -------------------------------------------------------------------
export async function getPortalAccountService(): Promise<PortalAccountResponseDTO> {
  try {
    const sessionUser = await requireUserRole([USER_ROLES.MEMBER]);

    const [user, notificationTypes] = await Promise.all([
      getUserByUserIdRepo(sessionUser.id),
      getActiveNotificationTypesRepo(),
    ]);

    // A live session whose user row is gone means the account was deleted
    // mid-session. There is nothing to show and nothing to edit.
    if (!user) {
      throw new DisplayErrorMessage("We could not load your account. Please sign in again.");
    }

    return mapDBUserToPortalAccountResponseDTO(user, notificationTypes);
  } catch (error) {
    throw handleError("getPortalAccountService", error);
  }
}

// -------------------------------------------------------------------
// Save the signed-in member's own details.
//
// Name, preferred name, phone and notification preferences are the whole of
// what a member may change about themselves. Role and isActive are
// server-assigned and are never part of the patch built here, so no request
// shape can reach them.
// -------------------------------------------------------------------
export async function updatePortalAccountService(requestDTO: UpdatePortalAccountRequestDTO): Promise<void> {
  try {
    const sessionUser = await requireUserRole([USER_ROLES.MEMBER]);

    const [before, notificationTypes] = await Promise.all([
      getUserByUserIdRepo(sessionUser.id),
      getActiveNotificationTypesRepo(),
    ]);

    if (!before) {
      throw new DisplayErrorMessage("We could not load your account. Please sign in again.");
    }

    // Start from what is already stored and overwrite only the keys of types
    // that are currently active.
    //
    // Two reasons, both deliberate. The submitted record is client input, and
    // an unbounded one would let a member write arbitrary JSON into their own
    // row. And a preference saved against a type an admin has since retired is
    // kept rather than dropped, so reactivating that type does not silently
    // opt everybody back into something they had turned off.
    const existingPreferences = before.notificationPreferences ?? {};
    const notificationPreferences: Record<string, boolean> = { ...existingPreferences };

    for (const notificationType of notificationTypes) {
      const submitted = requestDTO.notificationPreferences[notificationType.key];
      if (submitted !== undefined) {
        notificationPreferences[notificationType.key] = submitted;
      }
    }

    const name = requestDTO.name.trim();
    const preferredName = emptyToNull(requestDTO.preferredName);
    const phoneNumber = emptyToNull(requestDTO.phoneNumber);

    const updateUser: UpdateUser = {
      name,
      preferredName,
      phoneNumber,
      // notification_preferences is JSONB, so the column is written as a JSON
      // string. It goes in this one patch rather than through a second write
      // so that a saved profile can never end up with unsaved preferences.
      notificationPreferences: JSON.stringify(notificationPreferences),
    };

    await updateUserByIdRepo(sessionUser.id, updateUser);

    const fieldChanges = diffFields([
      { field: "name", label: "Name", from: before.name, to: name },
      { field: "preferredName", label: "Preferred name", from: before.preferredName, to: preferredName },
      { field: "phoneNumber", label: "Phone", from: before.phoneNumber, to: phoneNumber },
    ]);

    // Preferences are recorded as "which types moved", never as the whole
    // record: the trail should say what changed, not carry a copy of the row.
    const changedPreferenceKeys = notificationTypes
      .map((notificationType) => notificationType.key)
      .filter((key) => (existingPreferences[key] ?? true) !== (notificationPreferences[key] ?? true));

    if (fieldChanges.length > 0 || changedPreferenceKeys.length > 0) {
      await recordAuditEvent({
        action: AUDIT_ACTIONS.USER_UPDATED,
        entityType: AUDIT_ENTITY_TYPES.USER,
        entityId: sessionUser.id,
        // The person this was done to is also the person who did it - a member
        // editing themselves - and the trail should say so on both counts.
        subjectUserId: sessionUser.id,
        summary: `${before.name} updated their own account details`,
        changes: { fields: fieldChanges, notificationPreferences: changedPreferenceKeys },
      });
    }

    revalidatePath(ROUTES.PORTAL_ACCOUNT);
  } catch (error) {
    throw handleError("updatePortalAccountService", error);
  }
}
