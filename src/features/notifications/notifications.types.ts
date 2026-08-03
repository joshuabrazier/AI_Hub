import z from "zod";

import { TABLE_ID_LENGTH } from "@/lib/constants";
import { NOTIFICATION_AUDIENCE_TYPES, type NotificationAudienceType } from "@/lib/data/kysely-database-types";

// Ids are always re-checked server-side; the length bound only keeps obvious
// rubbish out of the query.
const idSchema = z.string().min(TABLE_ID_LENGTH);

// Bounds on how wide one send can be addressed. These cap the work the server
// does per request; they are NOT an authorization control - which teams,
// classes and people a sender may reach is decided in the service from their
// session, never from the size of the list they submitted.
const MAX_TEAMS_PER_SEND = 50;
const MAX_CLASSES_PER_SEND = 50;
const MAX_USERS_PER_SEND = 1000;

// -------------------------------------------------------------------
// Audience
//
// A discriminated union rather than one object with four optional arrays: the
// audience type and the ids that go with it always travel together, so a
// "teams" send cannot arrive carrying a list of user ids for the service to
// mistake for its target.
//
// Every id here is a REQUEST, not a grant. The service re-resolves the sender's
// scope from the session and drops anything outside it.
// -------------------------------------------------------------------
export const NotificationAudienceSchema = z.discriminatedUnion("audienceType", [
  z.object({
    audienceType: z.literal(NOTIFICATION_AUDIENCE_TYPES.EVERYONE),
  }),
  z.object({
    audienceType: z.literal(NOTIFICATION_AUDIENCE_TYPES.TEAMS),
    teamIds: z.array(idSchema).min(1, "Please choose at least one team").max(MAX_TEAMS_PER_SEND),
  }),
  z.object({
    audienceType: z.literal(NOTIFICATION_AUDIENCE_TYPES.USERS),
    userIds: z.array(idSchema).min(1, "Please choose at least one person").max(MAX_USERS_PER_SEND),
  }),
  z.object({
    audienceType: z.literal(NOTIFICATION_AUDIENCE_TYPES.CLASSES),
    classIds: z.array(idSchema).min(1, "Please choose at least one class").max(MAX_CLASSES_PER_SEND),
  }),
]);

export type NotificationAudienceDTO = z.infer<typeof NotificationAudienceSchema>;

// -------------------------------------------------------------------
// Send a notification (staff -> server)
// -------------------------------------------------------------------
export const SendNotificationSchema = z.object({
  type: z.string().trim().min(1, "Please choose a type").max(120),
  title: z.string().trim().min(1, "Please enter a title").max(150),
  // Rich-text HTML from the editor; sanitised server-side before storing.
  body: z.string().trim().max(20000).optional(),
  audience: NotificationAudienceSchema,
});

export type SendNotificationRequestDTO = z.infer<typeof SendNotificationSchema>;

// -------------------------------------------------------------------
// Templates
//
// Reusable content only. The audience is always chosen at send time, so it is
// deliberately absent here - a template that carried an audience would let a
// manager save a target once and keep sending to it after losing the team.
// -------------------------------------------------------------------
const templateBaseShape = {
  name: z.string().trim().min(1, "Please enter a template name").max(100),
  type: z.string().trim().min(1, "Please choose a type").max(120),
  title: z.string().trim().min(1, "Please enter a title").max(150),
  body: z.string().trim().max(20000).optional(),
};

export const CreateNotificationTemplateSchema = z.object(templateBaseShape);

export type CreateNotificationTemplateRequestDTO = z.infer<typeof CreateNotificationTemplateSchema>;

export const UpdateNotificationTemplateSchema = z.object({ id: idSchema, ...templateBaseShape });

export type UpdateNotificationTemplateRequestDTO = z.infer<typeof UpdateNotificationTemplateSchema>;

export const DeleteNotificationTemplateSchema = z.object({ id: idSchema });

export type DeleteNotificationTemplateRequestDTO = z.infer<typeof DeleteNotificationTemplateSchema>;

// -------------------------------------------------------------------
// Mark as read
//
// No user id: the recipient is the session user, and the repository scopes the
// update to them. There is nothing here to point at somebody else's inbox.
// -------------------------------------------------------------------
export const MarkNotificationsReadSchema = z.object({
  notificationIds: z.array(idSchema).min(1).max(200),
});

export type MarkNotificationsReadRequestDTO = z.infer<typeof MarkNotificationsReadSchema>;

// -------------------------------------------------------------------
// One notification in a recipient's inbox.
//
// `isUnread` is derived from readAt being NULL. The timestamp itself is never
// shown - what a reader wants to know is "is this new", not when they opened it.
// -------------------------------------------------------------------
export type NotificationDTO = {
  id: string;
  type: string;
  typeLabel: string;
  title: string;
  body: string | null;
  createdAt: Date;
  isUnread: boolean;
};

export type NotificationInboxDTO = {
  notifications: NotificationDTO[];
  unreadCount: number;
};

// -------------------------------------------------------------------
// Template shown in the pickers.
// -------------------------------------------------------------------
export type NotificationTemplateDTO = {
  id: string;
  name: string;
  type: string;
  // Display label for `type`, resolved from the notification types list.
  typeLabel: string;
  title: string;
  body: string | null;
  // A built-in template (fixed id) that backs a feature and cannot be deleted.
  isSystem: boolean;
};

// -------------------------------------------------------------------
// Options the sender picks from.
//
// Every list here is already narrowed to what the signed-in sender may address.
// The picker showing something is not what makes it allowed - the service
// re-checks each id at send time - but the two are built from the same scope so
// they never disagree.
// -------------------------------------------------------------------
export type AudienceOptionDTO = {
  id: string;
  name: string;
  subtitle: string | null;
};

export type NotificationAudienceOptionsDTO = {
  // "Everyone" addresses every active member account, which is a platform-wide
  // action. False for a manager, whose reach stops at the teams they hold.
  canAddressEveryone: boolean;
  teams: AudienceOptionDTO[];
  users: AudienceOptionDTO[];
  classes: AudienceOptionDTO[];
};

// -------------------------------------------------------------------
// One message a staff member has sent, with who received it and who has
// opened it.
// -------------------------------------------------------------------
export type SentNotificationRecipientDTO = {
  userId: string;
  name: string;
  isRead: boolean;
};

export type SentNotificationDTO = {
  id: string;
  type: string;
  typeLabel: string;
  audienceType: NotificationAudienceType;
  audienceLabel: string | null;
  title: string;
  body: string | null;
  createdAt: Date;
  recipients: SentNotificationRecipientDTO[];
  readCount: number;
};

// -------------------------------------------------------------------
// Everything the staff notifications screen renders in one pass.
// -------------------------------------------------------------------
export type StaffNotificationsDTO = {
  sent: SentNotificationDTO[];
  audience: NotificationAudienceOptionsDTO;
  templates: NotificationTemplateDTO[];
  notificationTypes: { key: string; name: string }[];
  // True for an admin. Managers see only their own sent messages, because a
  // broadcast carries no team and sender is the only scope it has.
  isUnrestricted: boolean;
};
