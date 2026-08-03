import "server-only";

import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";

import { requireUser, requireUserRole } from "@/lib/auth/session-auth-server";
import {
  NewNotificationTypeRecord,
  UpdateNotificationTypeRecord,
  USER_ROLES,
} from "@/lib/data/kysely-database-types";
import {
  createNotificationTypeRepo,
  getActiveNotificationTypesRepo,
  getAllNotificationTypesRepo,
  getNotificationTypeByKeyRepo,
  updateNotificationTypeRepo,
} from "@/lib/data/repositories/notification-types.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import { mapDBNotificationTypeToResponseDTO } from "./admin-notification-types.mappers";
import {
  CreateNotificationTypeRequestDTO,
  NotificationTypeResponseDTO,
  UpdateNotificationTypeRequestDTO,
} from "./admin-notification-types.types";

// -------------------------------------------------------------------
// Notification types - the admin-managed categories behind the send and
// template pickers, and behind each person's per-type email preferences.
//
// Managing the list is admin-only, so every entry point here guards. Reading
// the ACTIVE list is not: staff compose screens need it, and it is only a set
// of labels. That one is called out where it is defined.
// -------------------------------------------------------------------

// Derive a stable key from the label: lowercase, non-alphanumeric -> "_".
// Falls back to a generated id if the name has no usable characters. The key
// is stored on notifications, broadcasts, templates and user preferences, so
// once created it must never change.
function toKey(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || generateId();
}

// -------------------------------------------------------------------
// Every type, any status - the admin table. A deactivated type is kept so
// notifications already sent under it still resolve to a label.
// -------------------------------------------------------------------
export async function getAllNotificationTypesService(): Promise<NotificationTypeResponseDTO[]> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    return (await getAllNotificationTypesRepo()).map(mapDBNotificationTypeToResponseDTO);
  } catch (error) {
    throw handleError("getAllNotificationTypesService", error);
  }
}

// -------------------------------------------------------------------
// The active types, for the compose/template pickers and for a person's own
// per-type email preferences.
//
// Signed-in rather than admin-only, and deliberately so: a manager composing
// to their teams and a member choosing what to be emailed about both need the
// same list of categories. It is labels only - no team-scoped or personal data
// - so a session is the whole check. WHO a manager may address is enforced
// where the audience is resolved, not here.
// -------------------------------------------------------------------
export async function getActiveNotificationTypesService(): Promise<NotificationTypeResponseDTO[]> {
  try {
    await requireUser();

    return (await getActiveNotificationTypesRepo()).map(mapDBNotificationTypeToResponseDTO);
  } catch (error) {
    throw handleError("getActiveNotificationTypesService", error);
  }
}

// -------------------------------------------------------------------
// Create a type. The key is derived here, never accepted from the client.
// -------------------------------------------------------------------
export async function createNotificationTypeService(requestDTO: CreateNotificationTypeRequestDTO): Promise<string> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const key = toKey(requestDTO.name);

    // `key` is UNIQUE, and two labels can easily slug to the same key
    // ("On hold" and "on-hold"). Check first so the admin gets a field error
    // instead of a constraint violation surfaced as "something went wrong".
    const existing = await getNotificationTypeByKeyRepo(key);

    if (existing) {
      throw new DisplayErrorMessage(`A notification type with a similar name already exists (${existing.name}).`);
    }

    const now = new Date();

    const record: NewNotificationTypeRecord = {
      id: generateId(),
      key,
      name: requestDTO.name,
      description: requestDTO.description?.trim() || null,
      isActive: requestDTO.isActive,
      orderBy: requestDTO.orderBy,
      createdAt: now,
      updatedAt: now,
    };

    const created = await createNotificationTypeRepo(record);

    revalidatePath(ROUTES.ADMIN_CONFIGURATIONS);
    revalidatePath(ROUTES.ADMIN_NOTIFICATIONS);

    return created.id;
  } catch (error) {
    throw handleError("createNotificationTypeService", error);
  }
}

// -------------------------------------------------------------------
// Update a type's label, description, order or active flag.
//
// The KEY is deliberately not updatable: notifications, broadcasts, templates
// and user preferences all store it, and changing it would orphan every one
// of them with no error.
// -------------------------------------------------------------------
export async function updateNotificationTypeService(
  requestDTO: UpdateNotificationTypeRequestDTO,
): Promise<string | undefined> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const update: UpdateNotificationTypeRecord = {
      name: requestDTO.name,
      description: requestDTO.description === undefined ? undefined : requestDTO.description.trim() || null,
      isActive: requestDTO.isActive,
      orderBy: requestDTO.orderBy,
      updatedAt: new Date(),
    };

    const updated = await updateNotificationTypeRepo(requestDTO.id, update);

    revalidatePath(ROUTES.ADMIN_CONFIGURATIONS);
    revalidatePath(ROUTES.ADMIN_NOTIFICATIONS);

    return updated?.id;
  } catch (error) {
    throw handleError("updateNotificationTypeService", error);
  }
}
