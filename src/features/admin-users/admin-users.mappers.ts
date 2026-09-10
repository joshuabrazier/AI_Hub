import type { User, UserInvitation } from "@/lib/data/kysely-database-types";

import {
  ADMIN_USER_DISPLAY_STATUS,
  USER_OR_INVITATION,
  type AdminUserResponseDTO,
} from "./admin-users.types";

// -------------------------------------------------------------------
// Map a user account to a row.
// -------------------------------------------------------------------
export function mapDBUserToAdminUserResponseDTO(
  user: User,
  // Passed in rather than read here, because the caller loads every id with a
  // second factor in one query - a repository call per row would be one query
  // per person on a screen that already lists all of them.
  hasTwoFactor = false,
): AdminUserResponseDTO {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    userRole: user.role,
    userOrInvitation: USER_OR_INVITATION.User,
    displayStatus: user.isActive ? ADMIN_USER_DISPLAY_STATUS.Active : ADMIN_USER_DISPLAY_STATUS.Inactive,
    hasTwoFactor,
  };
}

// -------------------------------------------------------------------
// Map a pending invitation to a row.
//
// The row's id is the INVITATION id, not a user id - there is no user yet.
// The table keys the cancel action off userOrInvitation for that reason.
// -------------------------------------------------------------------
export function mapDBInvitationToAdminUserResponseDTO(invitation: UserInvitation): AdminUserResponseDTO {
  return {
    id: invitation.id,
    name: invitation.name,
    email: invitation.email,
    userRole: invitation.role,
    userOrInvitation: USER_OR_INVITATION.Invitation,
    displayStatus: ADMIN_USER_DISPLAY_STATUS.Pending,
    // An invitation has no account yet, so there is nothing to reset.
    hasTwoFactor: false,
  };
}
