import "server-only";

import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";

import {
  requireManagementScope,
  requireUser,
  requireUserRole,
  type TeamScope,
} from "@/lib/auth/session-auth-server";
import { database } from "@/lib/data/kysely-database-client";
import {
  DEFAULT_NOTIFICATION_TYPE_KEYS,
  NOTIFICATION_AUDIENCE_TYPES,
  NewNotification,
  USER_ROLES,
  type NotificationAudienceType,
} from "@/lib/data/kysely-database-types";
import {
  addNotificationBroadcastRepo,
  getBroadcastRecipientNamesRepo,
  getNotificationBroadcastsRepo,
  type NotificationBroadcastFilter,
} from "@/lib/data/repositories/notification-broadcasts.repository";
import {
  addNotificationTemplateRepo,
  deleteNotificationTemplateRepo,
  getNotificationTemplateByIdRepo,
  getNotificationTemplatesRepo,
  updateNotificationTemplateRepo,
} from "@/lib/data/repositories/notification-templates.repository";
import {
  getActiveNotificationTypesRepo,
  getAllNotificationTypesRepo,
} from "@/lib/data/repositories/notification-types.repository";
import {
  addNotificationsRepo,
  getEveryoneAudienceRecipientsRepo,
  getNotificationsByUserRepo,
  getRecipientUsersByIdsRepo,
  getRecipientUsersByTeamIdsRepo,
  getSelectableRecipientUsersRepo,
  getUnreadNotificationCountRepo,
  markAllNotificationsReadRepo,
  markNotificationsReadRepo,
  type NotificationRecipient,
} from "@/lib/data/repositories/notifications.repository";
import {
  getActiveTeamsRepo,
  getTeamsByIdsRepo,
} from "@/lib/data/repositories/teams.repository";
import {
  getTeamMembersForTeamsRepo,
  getUserIdsForTeamsRepo,
} from "@/lib/data/repositories/team-members.repository";
// Preferences live on the users table, so the users repository owns this one.
import { getNotificationPreferencesByUserIdsRepo } from "@/lib/data/repositories/users.repository";
import { sendNotificationEmail } from "@/lib/email/send-email";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { sanitizeRichText } from "@/lib/sanitize-rich-text";

import {
  mapDBBroadcastToSentNotificationDTO,
  mapDBNotificationToNotificationDTO,
  mapDBRecipientToAudienceOptionDTO,
  mapDBTeamMemberToAudienceOptionDTO,
  mapDBTeamToAudienceOptionDTO,
  mapDBTemplateToNotificationTemplateDTO,
} from "./notifications.mappers";
import {
  AudienceOptionDTO,
  CreateNotificationTemplateRequestDTO,
  DeleteNotificationTemplateRequestDTO,
  MarkNotificationsReadRequestDTO,
  NotificationAudienceDTO,
  NotificationAudienceOptionsDTO,
  NotificationInboxDTO,
  NotificationTemplateDTO,
  SendNotificationRequestDTO,
  SentNotificationDTO,
  StaffNotificationsDTO,
  UpdateNotificationTemplateRequestDTO,
} from "./notifications.types";

// -------------------------------------------------------------------
// Notifications service
//
// There is ONE path that sends a notification: sendNotificationService. The
// previous design had three, and two of them resolved their own recipients and
// skipped the per-type opt-out, so muting a notification type worked from one
// screen and not from the others. Anything that needs to notify somebody goes
// through the function below, and it always:
//
//   1. resolves the sender's scope from the SESSION,
//   2. resolves recipients through the repository audience queries (which are
//      already deduped and already exclude inactive / de-identified accounts),
//   3. drops everyone who opted out of the type being sent,
//   4. writes the broadcast and its per-recipient copies in one transaction.
//
// A manager may only address the teams an admin assigned them. That is enforced
// HERE, against the scope, not by whatever the picker happened to offer.
// -------------------------------------------------------------------

// How much of an inbox one request reads. An inbox has no natural ceiling, and
// the page shows the recent ones; the repository pages on the same bound.
const MAX_INBOX_NOTIFICATIONS = 200;

// Fallback categories for the pickers when the admin-managed notification_types
// table is empty (a fresh database), so a send is never impossible.
const FALLBACK_NOTIFICATION_TYPES = [
  { key: DEFAULT_NOTIFICATION_TYPE_KEYS.GENERAL, name: "General" },
  { key: DEFAULT_NOTIFICATION_TYPE_KEYS.ACCOUNT, name: "Account" },
];

// -------------------------------------------------------------------
// Type labels
//
// Uses ALL types, including deactivated ones, so a notification sent under a
// category that has since been retired still renders with its name rather than
// its raw key. An unknown key falls back to itself so nothing renders blank.
// -------------------------------------------------------------------
async function getTypeLabelMap(): Promise<Map<string, string>> {
  const types = await getAllNotificationTypesRepo();
  return new Map(types.map((type) => [type.key, type.name]));
}

function labelForType(key: string, labels: Map<string, string>): string {
  return labels.get(key) ?? key;
}

// The categories a sender may choose from, admin-managed with a built-in
// fallback.
async function getSelectableTypes(): Promise<{ key: string; name: string }[]> {
  const activeTypes = await getActiveNotificationTypesRepo();

  return activeTypes.length > 0
    ? activeTypes.map((type) => ({ key: type.key, name: type.name }))
    : FALLBACK_NOTIFICATION_TYPES;
}

// -------------------------------------------------------------------
// Placeholder substitution
//
// A message may contain a {{name}} token, replaced per recipient with the name
// they asked to be called by. The body is HTML, so the name is escaped there;
// the title is plain text (a text node, and the email subject) and is not.
// -------------------------------------------------------------------
const NAME_PLACEHOLDER = /\{\{\s*name\s*\}\}/gi;

function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName.trim();
}

function fillRecipientName(text: string, recipient: NotificationRecipient, asHtml: boolean): string {
  const greeting = recipient.preferredName?.trim() || firstNameOf(recipient.name);
  const value = asHtml
    ? greeting.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    : greeting;

  return text.replace(NAME_PLACEHOLDER, value);
}

// -------------------------------------------------------------------
// Inbox
//
// Keyed entirely by the session user id. Role decides nothing here - staff
// receive notifications too, when a message is addressed to them individually -
// so requireUser is the whole check, and there is no id in the request to
// compare it against.
// -------------------------------------------------------------------
export async function getMyNotificationsService(): Promise<NotificationInboxDTO> {
  try {
    const user = await requireUser();

    const [notifications, unreadCount, typeLabels] = await Promise.all([
      getNotificationsByUserRepo(user.id, { limit: MAX_INBOX_NOTIFICATIONS }),
      getUnreadNotificationCountRepo(user.id),
      getTypeLabelMap(),
    ]);

    return {
      notifications: notifications.map((notification) =>
        mapDBNotificationToNotificationDTO(
          notification,
          labelForType(notification.type, typeLabels),
          // Sanitised at write and again at read: the body is rendered with
          // dangerouslySetInnerHTML, so we never trust that a stored value
          // reached the database through the sanitising write path.
          notification.body ? sanitizeRichText(notification.body) : null,
        ),
      ),
      unreadCount,
    };
  } catch (error) {
    throw handleError("getMyNotificationsService", error);
  }
}

// -------------------------------------------------------------------
// Mark specific notifications as read.
//
// The ids come from the client, but they are not a grant: the repository scopes
// the update to the session user, so ids belonging to somebody else simply
// match no rows.
// -------------------------------------------------------------------
export async function markNotificationsReadService(
  requestDTO: MarkNotificationsReadRequestDTO,
): Promise<void> {
  try {
    const user = await requireUser();

    await markNotificationsReadRepo(user.id, requestDTO.notificationIds);

    // Only the home page is revalidated. This fires once per message opened, and
    // revalidating the inbox itself would refetch the page the reader is looking
    // at on every click - for a change it is already showing, since the list
    // tracks read state locally. The unread count on the home page is the part
    // that would otherwise go stale.
    revalidatePath(ROUTES.PORTAL);
  } catch (error) {
    throw handleError("markNotificationsReadService", error);
  }
}

// -------------------------------------------------------------------
// Mark every unread notification as read.
// -------------------------------------------------------------------
export async function markAllNotificationsReadService(): Promise<void> {
  try {
    const user = await requireUser();

    await markAllNotificationsReadRepo(user.id);

    revalidatePath(ROUTES.PORTAL_NOTIFICATIONS);
    revalidatePath(ROUTES.PORTAL);
  } catch (error) {
    throw handleError("markAllNotificationsReadService", error);
  }
}

// -------------------------------------------------------------------
// Audience options
//
// Built from the caller's scope, so a manager is never offered a team or a
// person outside the teams they hold. This is a convenience, not a control:
// sendNotificationService re-derives the same scope and re-checks every id it
// is handed.
// -------------------------------------------------------------------
async function getAudienceOptions(scope: TeamScope): Promise<NotificationAudienceOptionsDTO> {
  if (scope.isUnrestricted) {
    const [teams, users] = await Promise.all([getActiveTeamsRepo(), getSelectableRecipientUsersRepo()]);

    return {
      canAddressEveryone: true,
      teams: teams.map(mapDBTeamToAudienceOptionDTO),
      users: users.map(mapDBRecipientToAudienceOptionDTO),
    };
  }

  // An empty scope must offer nothing rather than everything. Each repository
  // short-circuits an empty id list, so there is no path where "no teams"
  // becomes an unfiltered read.
  const [teams, members] = await Promise.all([
    getTeamsByIdsRepo(scope.teamIds),
    getTeamMembersForTeamsRepo(scope.teamIds),
  ]);

  // A person in two of the manager's teams has a membership row per team, so
  // the people picker is deduped on user id before it is offered.
  const usersById = new Map<string, AudienceOptionDTO>();
  for (const member of members) {
    if (!usersById.has(member.userId)) {
      usersById.set(member.userId, mapDBTeamMemberToAudienceOptionDTO(member));
    }
  }

  return {
    // "Everyone" reaches every member account on the platform, including people
    // in no team at all. That is not a manager's to send.
    canAddressEveryone: false,
    teams: teams.filter((team) => team.isActive).map(mapDBTeamToAudienceOptionDTO),
    users: [...usersById.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// -------------------------------------------------------------------
// Recipient resolution
//
// The one place an audience becomes a list of people. Every branch goes through
// a repository audience query, which returns only accounts that can actually be
// written to and which dedupes across teams.
//
// Anything the sender asked for that is outside their scope is dropped here,
// silently and before the query - so a tampered id list can never widen a send,
// and an out-of-scope id cannot even confirm that the team exists.
// -------------------------------------------------------------------
type ResolvedAudience = {
  recipients: NotificationRecipient[];
  audienceType: NotificationAudienceType;
  audienceLabel: string;
};

// Keeps a summary readable when a send is addressed very widely.
function summariseNames(names: string[], noun: string): string {
  if (names.length === 0) return "No recipients";
  if (names.length <= 3) return names.join(", ");
  return `${names.length} ${noun}`;
}

async function resolveAudience(
  scope: TeamScope,
  audience: NotificationAudienceDTO,
): Promise<ResolvedAudience> {
  switch (audience.audienceType) {
    case NOTIFICATION_AUDIENCE_TYPES.EVERYONE: {
      // Platform-wide, so admin only. A manager reaching this has tampered with
      // the request: the picker never offers it to them.
      if (!scope.isUnrestricted) {
        throw new DisplayErrorMessage("You can only send to the teams you manage.");
      }

      return {
        recipients: await getEveryoneAudienceRecipientsRepo(),
        audienceType: NOTIFICATION_AUDIENCE_TYPES.EVERYONE,
        audienceLabel: "Everyone",
      };
    }

    case NOTIFICATION_AUDIENCE_TYPES.TEAMS: {
      const allowedTeamIds = scope.isUnrestricted
        ? audience.teamIds
        : audience.teamIds.filter((teamId) => scope.teamIds.includes(teamId));

      if (allowedTeamIds.length === 0) {
        throw new DisplayErrorMessage("You can only send to the teams you manage.");
      }

      // Resolving the names also proves the teams exist: an id that matches no
      // row contributes no name and no recipients.
      const [teams, recipients] = await Promise.all([
        getTeamsByIdsRepo(allowedTeamIds),
        getRecipientUsersByTeamIdsRepo(allowedTeamIds),
      ]);

      return {
        recipients,
        audienceType: NOTIFICATION_AUDIENCE_TYPES.TEAMS,
        audienceLabel: summariseNames(
          teams.map((team) => team.name),
          "teams",
        ),
      };
    }

    case NOTIFICATION_AUDIENCE_TYPES.USERS: {
      let requestedUserIds = audience.userIds;

      if (!scope.isUnrestricted) {
        // A manager's reach is the people in their teams. Resolving that set
        // from the session and intersecting is what stops an arbitrary user id
        // being addressed by pasting it into the request.
        const reachableUserIds = new Set(await getUserIdsForTeamsRepo(scope.teamIds));
        requestedUserIds = requestedUserIds.filter((userId) => reachableUserIds.has(userId));
      }

      if (requestedUserIds.length === 0) {
        throw new DisplayErrorMessage("You can only send to people in the teams you manage.");
      }

      // The repository re-validates the ids against real, active, identifiable
      // accounts, so ids that are not those simply do not come back.
      const recipients = await getRecipientUsersByIdsRepo(requestedUserIds);

      return {
        recipients,
        audienceType: NOTIFICATION_AUDIENCE_TYPES.USERS,
        audienceLabel: summariseNames(
          recipients.map((recipient) => recipient.name),
          "recipients",
        ),
      };
    }
  }
}

// -------------------------------------------------------------------
// Send a notification.
//
// The ONLY write path for notifications. Opt-outs are honoured here, once, so
// no caller can skip them.
// -------------------------------------------------------------------
export async function sendNotificationService(requestDTO: SendNotificationRequestDTO): Promise<void> {
  try {
    // Members get redirected by this; admins come back unrestricted, managers
    // with exactly the teams an admin assigned them.
    const scope = await requireManagementScope();

    // The category is stored on the broadcast and on every recipient's copy,
    // and it is what a recipient's opt-out is keyed on. An unknown value would
    // store a category nobody can mute, so it is checked against the list the
    // pickers offer rather than taken on trust.
    const selectableTypes = await getSelectableTypes();
    if (!selectableTypes.some((type) => type.key === requestDTO.type)) {
      throw new DisplayErrorMessage("That notification type is no longer available.");
    }

    const { recipients: addressed, audienceType, audienceLabel } = await resolveAudience(
      scope,
      requestDTO.audience,
    );

    // Honour each recipient's per-type preference. Opting out of a type removes
    // them from the send entirely: no email, no inbox copy, and they do not
    // appear in the sent history. An absent key means opted in, so somebody who
    // has never touched their preferences still receives everything.
    const preferencesByUserId = await getNotificationPreferencesByUserIdsRepo(
      addressed.map((recipient) => recipient.id),
    );

    const recipients = addressed.filter(
      (recipient) => preferencesByUserId.get(recipient.id)?.[requestDTO.type] !== false,
    );

    if (recipients.length === 0) {
      throw new DisplayErrorMessage(
        addressed.length === 0
          ? "That audience has nobody in it, so nothing was sent."
          : "Everybody in that audience has turned this type of notification off, so nothing was sent.",
      );
    }

    const now = new Date();
    const rawBody = requestDTO.body?.trim();
    const body = rawBody ? sanitizeRichText(rawBody) : null;
    const broadcastId = generateId();

    const notifications: NewNotification[] = recipients.map((recipient) => ({
      id: generateId(),
      userId: recipient.id,
      broadcastId,
      type: requestDTO.type,
      title: fillRecipientName(requestDTO.title, recipient, false),
      body: body ? fillRecipientName(body, recipient, true) : null,
      createdAt: now,
    }));

    // One transaction: a broadcast with no recipient rows would show in the
    // sent history as a message that reached nobody, and recipient rows with no
    // broadcast would be unattributable.
    await database.transaction().execute(async (trx) => {
      await addNotificationBroadcastRepo(
        {
          id: broadcastId,
          createdBy: scope.user.id,
          type: requestDTO.type,
          audienceType,
          audienceLabel,
          title: requestDTO.title,
          body,
          createdAt: now,
        },
        trx,
      );

      await addNotificationsRepo(notifications, trx);
    });

    // Best-effort email to the same people (opt-outs are already out). The
    // in-app copies are committed, so a mail failure must not fail the request:
    // send them all, then log how many failed without naming anybody.
    const results = await Promise.allSettled(
      recipients.map((recipient) =>
        sendNotificationEmail({
          toAddress: recipient.email,
          title: fillRecipientName(requestDTO.title, recipient, false),
          bodyHtml: body ? fillRecipientName(body, recipient, true) : null,
        }),
      ),
    );

    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed > 0) {
      console.error(
        `sendNotificationService: ${failed} of ${recipients.length} notification emails failed to send`,
      );
    }

    revalidatePath(ROUTES.ADMIN_NOTIFICATIONS);
    revalidatePath(ROUTES.MANAGE_NOTIFICATIONS);
    revalidatePath(ROUTES.PORTAL_NOTIFICATIONS);
    revalidatePath(ROUTES.PORTAL);
  } catch (error) {
    throw handleError("sendNotificationService", error);
  }
}

// -------------------------------------------------------------------
// Sent history
//
// A broadcast carries no team, so the only scope it has is who sent it. A
// manager sees their own messages; an admin sees every message. The same filter
// goes to BOTH queries - scoping only the list would leak the recipients of
// another sender's message to anyone who guessed its id.
// -------------------------------------------------------------------
async function getSentNotifications(scope: TeamScope): Promise<SentNotificationDTO[]> {
  const filter: NotificationBroadcastFilter = scope.isUnrestricted ? {} : { createdBy: scope.user.id };

  const broadcasts = await getNotificationBroadcastsRepo(filter);

  const [recipientRows, typeLabels] = await Promise.all([
    getBroadcastRecipientNamesRepo(
      broadcasts.map((broadcast) => broadcast.id),
      filter,
    ),
    getTypeLabelMap(),
  ]);

  const rowsByBroadcastId = new Map<string, typeof recipientRows>();
  for (const row of recipientRows) {
    if (!row.broadcastId) continue;
    const existing = rowsByBroadcastId.get(row.broadcastId);
    if (existing) existing.push(row);
    else rowsByBroadcastId.set(row.broadcastId, [row]);
  }

  return broadcasts.map((broadcast) =>
    mapDBBroadcastToSentNotificationDTO(
      broadcast,
      labelForType(broadcast.type, typeLabels),
      // Re-sanitised at read for the same reason as the inbox: it is rendered
      // with dangerouslySetInnerHTML.
      broadcast.body ? sanitizeRichText(broadcast.body) : null,
      rowsByBroadcastId.get(broadcast.id) ?? [],
    ),
  );
}

// -------------------------------------------------------------------
// Everything the staff notifications screen needs, in one guarded call.
//
// Shared by /admin/notifications and /manage/notifications. One service for
// both, because the difference between them is a scope and not a feature -
// duplicating it per area is how two screens drift into two authorization
// answers.
// -------------------------------------------------------------------
export async function getStaffNotificationsService(): Promise<StaffNotificationsDTO> {
  try {
    const scope = await requireManagementScope();

    const [sent, audience, templates, notificationTypes] = await Promise.all([
      getSentNotifications(scope),
      getAudienceOptions(scope),
      getNotificationTemplates(),
      getSelectableTypes(),
    ]);

    return { sent, audience, templates, notificationTypes, isUnrestricted: scope.isUnrestricted };
  } catch (error) {
    throw handleError("getStaffNotificationsService", error);
  }
}

// -------------------------------------------------------------------
// Templates
//
// Reading them is part of the staff screen, so it follows that screen's guard.
// WRITING them is admin-only: a template is platform-wide content with no team
// behind it, so a manager editing one would be reaching outside their teams.
// -------------------------------------------------------------------
async function getNotificationTemplates(): Promise<NotificationTemplateDTO[]> {
  const [templates, typeLabels] = await Promise.all([getNotificationTemplatesRepo(), getTypeLabelMap()]);

  return templates.map((template) =>
    mapDBTemplateToNotificationTemplateDTO(
      template,
      labelForType(template.type, typeLabels),
      template.body ? sanitizeRichText(template.body) : null,
    ),
  );
}

export async function createNotificationTemplateService(
  requestDTO: CreateNotificationTemplateRequestDTO,
): Promise<NotificationTemplateDTO> {
  try {
    const admin = await requireUserRole([USER_ROLES.ADMIN]);

    const now = new Date();
    const rawBody = requestDTO.body?.trim();
    const body = rawBody ? sanitizeRichText(rawBody) : null;

    const template = await addNotificationTemplateRepo({
      id: generateId(),
      createdBy: admin.id,
      name: requestDTO.name,
      type: requestDTO.type,
      title: requestDTO.title,
      body,
      // Admin-created templates are never system templates: those have fixed
      // ids and back a built-in feature.
      isSystem: false,
      createdAt: now,
      updatedAt: now,
    });

    const typeLabels = await getTypeLabelMap();

    revalidatePath(ROUTES.ADMIN_NOTIFICATIONS);
    revalidatePath(ROUTES.MANAGE_NOTIFICATIONS);

    return mapDBTemplateToNotificationTemplateDTO(
      template,
      labelForType(template.type, typeLabels),
      template.body,
    );
  } catch (error) {
    throw handleError("createNotificationTemplateService", error);
  }
}

export async function updateNotificationTemplateService(
  requestDTO: UpdateNotificationTemplateRequestDTO,
): Promise<NotificationTemplateDTO> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const rawBody = requestDTO.body?.trim();
    const body = rawBody ? sanitizeRichText(rawBody) : null;

    const template = await updateNotificationTemplateRepo(requestDTO.id, {
      name: requestDTO.name,
      type: requestDTO.type,
      title: requestDTO.title,
      body,
      updatedAt: new Date(),
    });

    const typeLabels = await getTypeLabelMap();

    revalidatePath(ROUTES.ADMIN_NOTIFICATIONS);
    revalidatePath(ROUTES.MANAGE_NOTIFICATIONS);

    return mapDBTemplateToNotificationTemplateDTO(
      template,
      labelForType(template.type, typeLabels),
      template.body,
    );
  } catch (error) {
    throw handleError("updateNotificationTemplateService", error);
  }
}

export async function deleteNotificationTemplateService(
  requestDTO: DeleteNotificationTemplateRequestDTO,
): Promise<void> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    // System templates back a built-in feature and must not be deleted. The
    // repository refuses them too; this check is what turns that refusal into a
    // message rather than a silent no-op.
    const template = await getNotificationTemplateByIdRepo(requestDTO.id);

    if (!template) {
      throw new DisplayErrorMessage("That template no longer exists.");
    }

    if (template.isSystem) {
      throw new DisplayErrorMessage("This is a system template and cannot be deleted.");
    }

    const deleted = await deleteNotificationTemplateRepo(requestDTO.id);

    // Zero rows means the repository's own is_system guard refused it, so the
    // template is still there and the caller must not be told otherwise.
    if (deleted === 0) {
      throw new DisplayErrorMessage("That template could not be deleted.");
    }

    revalidatePath(ROUTES.ADMIN_NOTIFICATIONS);
    revalidatePath(ROUTES.MANAGE_NOTIFICATIONS);
  } catch (error) {
    throw handleError("deleteNotificationTemplateService", error);
  }
}
