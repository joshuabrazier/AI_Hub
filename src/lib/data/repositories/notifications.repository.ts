import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { NewNotification, Notification, USER_ROLES } from "../kysely-database-types";

// -------------------------------------------------------------------
// Get a user's notifications, newest first. `readAt` comes back with each
// row so the list can show which are still unread.
//
// The userId predicate is the authorization check, not a filter: ids are
// opaque but guessable, so callers pass the SESSION user id.
//
// Paged, and ordered by id after createdAt: every recipient copy of one
// broadcast is inserted in a single transaction and so shares a timestamp
// to the microsecond. Without the tiebreaker those rows come back in an
// arbitrary order and a row can repeat or vanish between pages. An
// inbox also has no natural ceiling, so the whole history is never read
// in one go.
// -------------------------------------------------------------------
export type NotificationPage = {
  limit?: number;
  offset?: number;
};

export async function getNotificationsByUserRepo(
  userId: string,
  page: NotificationPage = {},
): Promise<Notification[]> {
  try {
    return await database
      .selectFrom("notifications")
      .selectAll()
      .where("userId", "=", userId)
      .orderBy("createdAt", "desc")
      .orderBy("id", "desc")
      .limit(page.limit ?? 100)
      .offset(page.offset ?? 0)
      .execute();
  } catch (error) {
    throw handleError("getNotificationsByUserRepo", error);
  }
}

// -------------------------------------------------------------------
// How many unread notifications a user has (the nav badge). The nav asks
// this on every navigation, so the predicates are written to match
// idx_notifications_unread - the partial index on notifications(user_id)
// WHERE read_at IS NULL. Filtering on read_at IS NULL rather than
// comparing a timestamp is what keeps it on that index.
// -------------------------------------------------------------------
export async function getUnreadNotificationCountRepo(userId: string): Promise<number> {
  try {
    const row = await database
      .selectFrom("notifications")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("userId", "=", userId)
      .where("readAt", "is", null)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  } catch (error) {
    throw handleError("getUnreadNotificationCountRepo", error);
  }
}

// -------------------------------------------------------------------
// Mark the given notifications as read for one user.
//
// The userId predicate is the authorization check, not a filter: ids are
// opaque but guessable, and without it anyone could mark another person's
// notifications read. Callers pass the SESSION user id. Already-read rows
// are skipped so a re-read never rewrites the original read time.
// -------------------------------------------------------------------
export async function markNotificationsReadRepo(
  userId: string,
  notificationIds: string[],
  db: DBClient = database,
): Promise<void> {
  try {
    if (notificationIds.length === 0) return;
    await db
      .updateTable("notifications")
      .set({ readAt: new Date() })
      .where("userId", "=", userId)
      .where("id", "in", notificationIds)
      .where("readAt", "is", null)
      .execute();
  } catch (error) {
    throw handleError("markNotificationsReadRepo", error);
  }
}

// -------------------------------------------------------------------
// Mark every unread notification for one user as read ("mark all as
// read"). Scoped to the one user for the same reason as above.
// -------------------------------------------------------------------
export async function markAllNotificationsReadRepo(userId: string, db: DBClient = database): Promise<void> {
  try {
    await db
      .updateTable("notifications")
      .set({ readAt: new Date() })
      .where("userId", "=", userId)
      .where("readAt", "is", null)
      .execute();
  } catch (error) {
    throw handleError("markAllNotificationsReadRepo", error);
  }
}

// -------------------------------------------------------------------
// Insert the per-recipient copies of a broadcast. Takes a DBClient so the
// broadcast row and its recipient rows can be written in one transaction.
// -------------------------------------------------------------------
export async function addNotificationsRepo(
  newNotifications: NewNotification[],
  db: DBClient = database,
): Promise<void> {
  try {
    if (newNotifications.length === 0) return;
    await db.insertInto("notifications").values(newNotifications).execute();
  } catch (error) {
    throw handleError("addNotificationsRepo", error);
  }
}

// Notification preferences live on the users table, so
// getNotificationPreferencesByUserIdsRepo belongs to users.repository and is
// imported from there. A second copy here would drift from it.

// -------------------------------------------------------------------
// Recipient resolution
//
// One function per audience type (everyone / teams / users), plus one for the
// pool the individual-person picker offers. The picker is
// deliberately not the same query as the "everyone" audience: they answer
// different questions and applying one to the other is what made staff
// unaddressable.
//
// Every one of them returns only accounts that can actually be written to:
// active, and not de-identified - a de-identified account's personal data
// is gone, so mailing it is both pointless and a retention breach.
//
// Roles come from USER_ROLES, never a string literal: a role written inline
// is invisible to tsc, so a rename would silently return no recipients and
// notification emails would just stop going out.
// -------------------------------------------------------------------
export type NotificationRecipient = {
  id: string;
  name: string;
  preferredName: string | null;
  email: string;
};

// -------------------------------------------------------------------
// The "everyone" audience: every active member account. "Everyone" means
// the end users, not the staff running the product - staff are addressed
// individually rather than swept into a broadcast to members.
// -------------------------------------------------------------------
export async function getEveryoneAudienceRecipientsRepo(): Promise<NotificationRecipient[]> {
  try {
    return await database
      .selectFrom("users")
      .select(["id", "name", "preferredName", "email"])
      .where("role", "=", USER_ROLES.MEMBER)
      .where("isActive", "=", true)
      .where("deidentifiedAt", "is", null)
      .orderBy("name")
      .execute();
  } catch (error) {
    throw handleError("getEveryoneAudienceRecipientsRepo", error);
  }
}

// -------------------------------------------------------------------
// The pool the individual-person picker is filled from: any account that
// can be written to, whatever its role.
//
// Deliberately NOT role-filtered, and separate from the "everyone" audience
// above for that reason. This has to offer exactly what
// getRecipientUsersByIdsRepo will accept back, and that validator applies no
// role filter either. Narrowing this to members would make staff
// unaddressable while the accept list still allowed them - a picker and an
// accept list that disagree is how a recipient silently goes missing.
// -------------------------------------------------------------------
export async function getSelectableRecipientUsersRepo(): Promise<NotificationRecipient[]> {
  try {
    return await database
      .selectFrom("users")
      .select(["id", "name", "preferredName", "email"])
      .where("isActive", "=", true)
      .where("deidentifiedAt", "is", null)
      .orderBy("name")
      .execute();
  } catch (error) {
    throw handleError("getSelectableRecipientUsersRepo", error);
  }
}

// -------------------------------------------------------------------
// The "users" audience: resolve an explicit list of user ids. This is what
// re-validates a submitted recipient list server-side - ids that are not
// real, active, identifiable accounts simply do not come back, so a
// tampered list can never widen the send.
// -------------------------------------------------------------------
export async function getRecipientUsersByIdsRepo(userIds: string[]): Promise<NotificationRecipient[]> {
  try {
    if (userIds.length === 0) return [];

    return await database
      .selectFrom("users")
      .select(["id", "name", "preferredName", "email"])
      .where("id", "in", userIds)
      .where("isActive", "=", true)
      .where("deidentifiedAt", "is", null)
      .orderBy("name")
      .execute();
  } catch (error) {
    throw handleError("getRecipientUsersByIdsRepo", error);
  }
}

// -------------------------------------------------------------------
// The "teams" audience: everyone in the given teams, via team_members.
//
// Membership is many-to-many, so the join produces one row per (team,
// person). DISTINCT collapses those here, exactly as getUserIdsForTeamsRepo
// does: a person in two of the addressed teams must get one in-app copy and
// one email, not two. Dedup belongs in the query and not in a caller's
// hands - a single call site that forgot would send the message twice.
//
// That is also why no teamId is returned: a person can be in more than one
// of the addressed teams, so there is no one team to tag them with. The
// audience label is built from the teams the sender chose, not from here.
//
// No role filter: the audience is the team's membership, and a manager who
// is genuinely in the team should get the message too.
// -------------------------------------------------------------------
export async function getRecipientUsersByTeamIdsRepo(teamIds: string[]): Promise<NotificationRecipient[]> {
  try {
    if (teamIds.length === 0) return [];

    return await database
      .selectFrom("teamMembers as tm")
      .innerJoin("users as u", "u.id", "tm.userId")
      .select(["u.id as id", "u.name as name", "u.preferredName as preferredName", "u.email as email"])
      .distinct()
      .where("tm.teamId", "in", teamIds)
      .where("u.isActive", "=", true)
      .where("u.deidentifiedAt", "is", null)
      .orderBy("u.name")
      .execute();
  } catch (error) {
    throw handleError("getRecipientUsersByTeamIdsRepo", error);
  }
}

