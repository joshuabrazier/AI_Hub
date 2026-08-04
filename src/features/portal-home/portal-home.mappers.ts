import type { Notification } from "@/lib/data/kysely-database-types";
import type { UserTeamMembership } from "@/lib/data/repositories/team-members.repository";

import type { PortalNotificationDTO, PortalTeamDTO } from "./portal-home.types";

// -------------------------------------------------------------------
// Map one of the member's team memberships to the portal DTO.
// -------------------------------------------------------------------
export function mapDBTeamMembershipToPortalTeamDTO(membership: UserTeamMembership): PortalTeamDTO {
  return {
    teamId: membership.teamId,
    teamName: membership.teamName,
    teamRole: membership.teamRole,
    isActive: membership.teamIsActive,
  };
}

// -------------------------------------------------------------------
// Map a notification row to the portal DTO. `readAt` is NULL until the member
// reads it, which is what makes it unread - the timestamp itself is not shown.
// The body is dropped: the home page lists titles only.
// -------------------------------------------------------------------
export function mapDBNotificationToPortalNotificationDTO(notification: Notification): PortalNotificationDTO {
  return {
    id: notification.id,
    title: notification.title,
    type: notification.type,
    createdAt: notification.createdAt,
    isUnread: notification.readAt === null,
  };
}
