import "server-only";

import { database } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import {
  NewNotificationTypeRecord,
  NotificationTypeRecord,
  UpdateNotificationTypeRecord,
} from "../kysely-database-types";

// -------------------------------------------------------------------
// Get all notification types (any status), ordered for display. History
// keeps its label this way: a deactivated type is hidden from the pickers
// but still resolvable for notifications already sent under it.
//
// orderBy is not unique and defaults to 1, so ties are the norm rather than
// the exception; name breaks them, otherwise the admin table reshuffles
// between renders.
// -------------------------------------------------------------------
export async function getAllNotificationTypesRepo(): Promise<NotificationTypeRecord[]> {
  try {
    return await database.selectFrom("notificationTypes").selectAll().orderBy("orderBy").orderBy("name").execute();
  } catch (error) {
    throw handleError("getAllNotificationTypesRepo", error);
  }
}

// -------------------------------------------------------------------
// Get active notification types only (what the send/template dropdowns and
// the per-user notification preferences show).
// -------------------------------------------------------------------
export async function getActiveNotificationTypesRepo(): Promise<NotificationTypeRecord[]> {
  try {
    return await database
      .selectFrom("notificationTypes")
      .where("isActive", "=", true)
      .selectAll()
      .orderBy("orderBy")
      .orderBy("name")
      .execute();
  } catch (error) {
    throw handleError("getActiveNotificationTypesRepo", error);
  }
}

// -------------------------------------------------------------------
// Look one up by key. `key` is UNIQUE and is the value stored on
// notifications, broadcasts, templates and user preferences, so the caller
// checks here before creating a type rather than letting the insert fail on
// a constraint violation. Undefined if the key is free.
// -------------------------------------------------------------------
export async function getNotificationTypeByKeyRepo(key: string): Promise<NotificationTypeRecord | undefined> {
  try {
    return await database.selectFrom("notificationTypes").selectAll().where("key", "=", key).executeTakeFirst();
  } catch (error) {
    throw handleError("getNotificationTypeByKeyRepo", error);
  }
}

// -------------------------------------------------------------------
// Update a notification type (label / description / order / active). The
// key is never updated - stored rows reference it.
// -------------------------------------------------------------------
export async function updateNotificationTypeRepo(
  id: string,
  update: UpdateNotificationTypeRecord,
): Promise<NotificationTypeRecord | undefined> {
  try {
    return await database
      .updateTable("notificationTypes")
      // Nothing stamps updated_at in the database, so the repository does it.
      .set({ ...update, updatedAt: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateNotificationTypeRepo", error);
  }
}

// -------------------------------------------------------------------
// Create a notification type.
// -------------------------------------------------------------------
export async function createNotificationTypeRepo(
  newNotificationType: NewNotificationTypeRecord,
): Promise<NotificationTypeRecord> {
  try {
    return await database
      .insertInto("notificationTypes")
      .values(newNotificationType)
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("createNotificationTypeRepo", error);
  }
}
