import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { NewNotificationBroadcast, NotificationBroadcast } from "../kysely-database-types";

// -------------------------------------------------------------------
// Insert a broadcast (the parent record for a staff message). The
// per-recipient copies are inserted separately via addNotificationsRepo -
// pass the same DBClient to both so a partial send can't be committed.
// -------------------------------------------------------------------
export async function addNotificationBroadcastRepo(
  broadcast: NewNotificationBroadcast,
  db: DBClient = database,
): Promise<void> {
  try {
    await db.insertInto("notificationBroadcasts").values(broadcast).execute();
  } catch (error) {
    throw handleError("addNotificationBroadcastRepo", error);
  }
}

// -------------------------------------------------------------------
// List sent broadcasts, newest first (the staff "sent" history).
// -------------------------------------------------------------------
// The row shape is the generated Selectable, not a hand-written copy of the
// same eight columns: re-declaring them here is how a repository type comes
// to disagree with the table it reads.
export type NotificationBroadcastRow = NotificationBroadcast;

// Broadcasts carry no team column, so the only way to scope this list is by
// sender. A manager's sent history is their own messages: without a filter
// here the whole list would have to be trimmed in the service, and one
// missed call site would show them every admin's messages.
export type NotificationBroadcastFilter = {
  createdBy?: string;
  limit?: number;
  offset?: number;
};

// Ordering falls back to id: broadcasts sent in the same transaction share a
// created_at to the microsecond, so without the tiebreaker a row could
// repeat or vanish between one page and the next. Paged for the same reason
// the audit trail is - the history only grows.
export async function getNotificationBroadcastsRepo(
  filter: NotificationBroadcastFilter = {},
): Promise<NotificationBroadcastRow[]> {
  try {
    let query = database.selectFrom("notificationBroadcasts").selectAll();

    if (filter.createdBy) query = query.where("createdBy", "=", filter.createdBy);

    return await query
      .orderBy("createdAt", "desc")
      .orderBy("id", "desc")
      .limit(filter.limit ?? 100)
      .offset(filter.offset ?? 0)
      .execute();
  } catch (error) {
    throw handleError("getNotificationBroadcastsRepo", error);
  }
}

// -------------------------------------------------------------------
// Recipients for a set of broadcasts, from the per-recipient notification
// rows. Used by the staff "sent" view to show who each message went to and
// whether they have opened it. Returns one row per (broadcast x recipient),
// ordered by name.
// -------------------------------------------------------------------
export type BroadcastRecipientRow = {
  broadcastId: string | null;
  userId: string;
  name: string;
  readAt: Date | null;
};

// This takes the SAME createdBy scope as getNotificationBroadcastsRepo, and
// applies it against the parent broadcast rather than trusting the ids it
// was handed. The two are always called as a pair - list the broadcasts,
// then name their recipients - so scoping only the first half leaked the
// second: an id from another staff member's broadcast would have answered
// with who it went to and whether they had read it. Ids are opaque but
// guessable, so the join to notification_broadcasts is the authorization
// check, not a filter.
export async function getBroadcastRecipientNamesRepo(
  broadcastIds: string[],
  filter: NotificationBroadcastFilter = {},
): Promise<BroadcastRecipientRow[]> {
  try {
    if (broadcastIds.length === 0) return [];

    let query = database
      .selectFrom("notifications as n")
      .innerJoin("users as u", "u.id", "n.userId")
      // Safe as an inner join: `n.broadcastId in (...)` already excludes the
      // standalone notifications that have no broadcast behind them.
      .innerJoin("notificationBroadcasts as b", "b.id", "n.broadcastId")
      .select(["n.broadcastId", "n.userId", "u.name", "n.readAt"])
      .where("n.broadcastId", "in", broadcastIds);

    if (filter.createdBy) query = query.where("b.createdBy", "=", filter.createdBy);

    return await query.orderBy("u.name").execute();
  } catch (error) {
    throw handleError("getBroadcastRecipientNamesRepo", error);
  }
}
