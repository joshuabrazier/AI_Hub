import "server-only";

import { database } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import {
  NewNotificationTemplate,
  NotificationTemplate,
  UpdateNotificationTemplate,
} from "../kysely-database-types";

// -------------------------------------------------------------------
// List notification templates, alphabetically by name.
// -------------------------------------------------------------------
export async function getNotificationTemplatesRepo(): Promise<NotificationTemplate[]> {
  try {
    return await database.selectFrom("notificationTemplates").selectAll().orderBy("name", "asc").execute();
  } catch (error) {
    throw handleError("getNotificationTemplatesRepo", error);
  }
}

// -------------------------------------------------------------------
// Get one template by id (used to resolve system templates by their fixed
// id, and to check the is_system flag before deleting). Undefined if absent.
// -------------------------------------------------------------------
export async function getNotificationTemplateByIdRepo(id: string): Promise<NotificationTemplate | undefined> {
  try {
    return await database.selectFrom("notificationTemplates").selectAll().where("id", "=", id).executeTakeFirst();
  } catch (error) {
    throw handleError("getNotificationTemplateByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// Insert a template and return the created row.
// -------------------------------------------------------------------
export async function addNotificationTemplateRepo(template: NewNotificationTemplate): Promise<NotificationTemplate> {
  try {
    return await database
      .insertInto("notificationTemplates")
      .values(template)
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addNotificationTemplateRepo", error);
  }
}

// -------------------------------------------------------------------
// Update a template and return the updated row.
// -------------------------------------------------------------------
export async function updateNotificationTemplateRepo(
  id: string,
  template: UpdateNotificationTemplate,
): Promise<NotificationTemplate> {
  try {
    return await database
      .updateTable("notificationTemplates")
      // Nothing stamps updated_at in the database, so the repository does it.
      .set({ ...template, updatedAt: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("updateNotificationTemplateRepo", error);
  }
}

// -------------------------------------------------------------------
// Delete a template by id. System templates back a built-in feature and are
// protected: the is_system guard here is defence-in-depth behind the
// service-level check.
//
// Returns how many rows went, so a refusal is distinguishable from a
// success. Returning void made a blocked delete of a system template look
// exactly like a completed one, and the UI would drop a row that is still
// in the table. 0 means nothing was deleted - either no such id, or the
// is_system guard refused it.
// -------------------------------------------------------------------
export async function deleteNotificationTemplateRepo(id: string): Promise<number> {
  try {
    const result = await database
      .deleteFrom("notificationTemplates")
      .where("id", "=", id)
      .where("isSystem", "=", false)
      .executeTakeFirst();

    return Number(result?.numDeletedRows ?? 0);
  } catch (error) {
    throw handleError("deleteNotificationTemplateRepo", error);
  }
}
