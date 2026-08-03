import type { Notification } from "@/lib/data/kysely-database-types";
import type { MemberSessionRow } from "@/lib/data/repositories/class-sessions.repository";
import type { UserTeamMembership } from "@/lib/data/repositories/team-members.repository";

import type { PortalNotificationDTO, PortalSessionDTO, PortalTeamDTO } from "./portal-home.types";

// -------------------------------------------------------------------
// Map one of the member's own session rows to the portal DTO.
//
// The date and time fields are carried through as the strings the DATE and
// TIME columns produced. Formatting happens at the point of display; parsing
// them into Date here would reintroduce the timezone shift the string columns
// exist to avoid.
// -------------------------------------------------------------------
export function mapDBMemberSessionToPortalSessionDTO(row: MemberSessionRow): PortalSessionDTO {
  return {
    id: row.id,
    sessionDate: row.sessionDate,
    sessionStart: row.sessionStart,
    sessionEnd: row.sessionEnd,
    status: row.status,
    className: row.className,
    programName: row.programName,
    locationName: row.locationName,
    attendanceStatus: row.attendanceStatus,
  };
}

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
