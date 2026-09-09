import "server-only";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import {
  getPendingMemberUserInvitationsRepo,
  getPendingStaffUserInvitationsRepo,
} from "@/lib/data/repositories/user-invitations.repository";
import { getActiveStaffUsersRepo, getMemberUsersRepo } from "@/lib/data/repositories/users.repository";
import { handleError } from "@/lib/handle-errors";

import { AdminDashboardDTO } from "./admin-dashboard.types";

// How much of each list the dashboard shows. The full lists have their own
// pages; this bound keeps the landing page a summary.

// -------------------------------------------------------------------
// Admin dashboard service
//
// The guard lives HERE, not only in the page or the layout that renders it. A
// service that trusts its caller is only as safe as the least careful caller
// it ever acquires; the previous version took an `isAdmin` boolean argument
// and decided what to return from it, which meant any caller could ask for the
// admin view simply by passing true. The role now comes from the session and
// nothing else.
//
// Admins are unrestricted, so there is no team filter below - that is the
// decision the role check makes, not an omission. The team-scoped version of
// this overview is the manager's, which resolves its scope from the session
// instead of widening this one.
// -------------------------------------------------------------------
export async function getAdminDashboardService(): Promise<AdminDashboardDTO> {
  try {
    const user = await requireUserRole([USER_ROLES.ADMIN]);

    const [members, staff, staffInvitations, memberInvitations] = await Promise.all([
      getMemberUsersRepo(),
      getActiveStaffUsersRepo(),
      getPendingStaffUserInvitationsRepo(),
      getPendingMemberUserInvitationsRepo(),
    ]);

    return {
      firstName: user.name?.trim().split(" ")[0] || null,
      stats: {
        // A de-identified account is excluded as well as a deactivated one:
        // its personal data is gone, so it is a retained row rather than a
        // person still using the product.
        activeMembers: members.filter((member) => member.isActive && member.deidentifiedAt === null).length,
        activeStaff: staff.length,
        pendingInvitations: staffInvitations.length + memberInvitations.length,
      },
    };
  } catch (error) {
    throw handleError("getAdminDashboardService", error);
  }
}
