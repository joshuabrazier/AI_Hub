import type {
  Notification,
  NotificationBroadcast,
  NotificationTemplate,
} from "@/lib/data/kysely-database-types";
import type { BroadcastRecipientRow } from "@/lib/data/repositories/notification-broadcasts.repository";
import type { TeamMemberWithUser } from "@/lib/data/repositories/team-members.repository";
import type { NotificationRecipient } from "@/lib/data/repositories/notifications.repository";
import type { Team } from "@/lib/data/kysely-database-types";

import type {
  AudienceOptionDTO,
  NotificationDTO,
  NotificationTemplateDTO,
  SentNotificationDTO,
  SentNotificationRecipientDTO,
} from "./notifications.types";

// -------------------------------------------------------------------
// Mappers are pure: no database, no sanitising, no session.
//
// Rich-text bodies arrive here ALREADY sanitised. Sanitising needs
// `sanitizeRichText`, which is server-only, and pulling it in here would make
// every mapper server-only too. The service does it and passes the result in -
// which also makes it visible at the call site that the body was cleaned.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// One notification in a recipient's inbox. `readAt` is NULL until they open
// it, and that is the whole definition of unread.
// -------------------------------------------------------------------
export function mapDBNotificationToNotificationDTO(
  notification: Notification,
  typeLabel: string,
  safeBody: string | null,
): NotificationDTO {
  return {
    id: notification.id,
    type: notification.type,
    typeLabel,
    title: notification.title,
    body: safeBody,
    createdAt: notification.createdAt,
    isUnread: notification.readAt === null,
  };
}

// -------------------------------------------------------------------
// One sent message, with its recipients.
// -------------------------------------------------------------------
export function mapDBBroadcastToSentNotificationDTO(
  broadcast: NotificationBroadcast,
  typeLabel: string,
  safeBody: string | null,
  recipientRows: BroadcastRecipientRow[],
): SentNotificationDTO {
  const recipients: SentNotificationRecipientDTO[] = recipientRows.map((row) => ({
    userId: row.userId,
    name: row.name,
    isRead: row.readAt !== null,
  }));

  return {
    id: broadcast.id,
    type: broadcast.type,
    typeLabel,
    audienceType: broadcast.audienceType,
    audienceLabel: broadcast.audienceLabel,
    title: broadcast.title,
    body: safeBody,
    createdAt: broadcast.createdAt,
    recipients,
    readCount: recipients.filter((recipient) => recipient.isRead).length,
  };
}

// -------------------------------------------------------------------
// One template in the pickers.
// -------------------------------------------------------------------
export function mapDBTemplateToNotificationTemplateDTO(
  template: NotificationTemplate,
  typeLabel: string,
  safeBody: string | null,
): NotificationTemplateDTO {
  return {
    id: template.id,
    name: template.name,
    type: template.type,
    typeLabel,
    title: template.title,
    body: safeBody,
    isSystem: template.isSystem,
  };
}

// -------------------------------------------------------------------
// Audience options.
//
// A retired team is never offered: `subtitle` carries the description rather
// than a status, because the lists these build are already filtered to what the
// sender may address.
// -------------------------------------------------------------------
export function mapDBTeamToAudienceOptionDTO(team: Team): AudienceOptionDTO {
  return {
    id: team.id,
    name: team.name,
    subtitle: team.description.trim() || null,
  };
}

// A person the "specific people" picker may offer, from the recipient pool the
// repository already narrowed to writable accounts.
export function mapDBRecipientToAudienceOptionDTO(recipient: NotificationRecipient): AudienceOptionDTO {
  return {
    id: recipient.id,
    name: recipient.name,
    subtitle: recipient.email,
  };
}

// The same option built from a team membership row - what a manager's people
// picker is filled from, since their reach is the members of their teams.
export function mapDBTeamMemberToAudienceOptionDTO(member: TeamMemberWithUser): AudienceOptionDTO {
  return {
    id: member.userId,
    name: member.name,
    subtitle: member.email,
  };
}

// A class the sender may address. The subtitle names the owning team so two
// classes with the same name are still tellable apart.
export function mapClassToAudienceOptionDTO(
  classId: string,
  className: string,
  teamName: string | null,
): AudienceOptionDTO {
  return {
    id: classId,
    name: className,
    subtitle: teamName,
  };
}
