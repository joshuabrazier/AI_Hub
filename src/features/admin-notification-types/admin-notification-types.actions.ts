"use server";

import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { ServerApiResponse } from "@/lib/types";
import { validateRequest } from "@/lib/server-requests";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { handleServerApiError } from "@/lib/handle-errors";

import {
  CreateNotificationTypeRequestDTO,
  createNotificationTypeSchema,
  NotificationTypeResponseDTO,
  UpdateNotificationTypeRequestDTO,
  updateNotificationTypeSchema,
} from "./admin-notification-types.types";
import {
  createNotificationTypeService,
  getAllNotificationTypesService,
  updateNotificationTypeService,
} from "./admin-notification-types.service";

export async function getAllNotificationTypesAction(): Promise<ServerApiResponse<NotificationTypeResponseDTO[]>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const notificationTypes = await getAllNotificationTypesService();

    return { success: true, data: notificationTypes } satisfies ServerApiResponse<NotificationTypeResponseDTO[]>;
  } catch (error) {
    return handleServerApiError("getAllNotificationTypesAction", error);
  }
}

export async function createNotificationTypeAction(
  requestDTO: CreateNotificationTypeRequestDTO,
): Promise<ServerApiResponse<string>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(createNotificationTypeSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const id = await createNotificationTypeService(validatedRequest.data);

    return { success: true, data: id } satisfies ServerApiResponse<string>;
  } catch (error) {
    return handleServerApiError("createNotificationTypeAction", error);
  }
}

export async function updateNotificationTypeAction(
  requestDTO: UpdateNotificationTypeRequestDTO,
): Promise<ServerApiResponse<string | undefined>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(updateNotificationTypeSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const id = await updateNotificationTypeService(validatedRequest.data);

    return { success: true, data: id } satisfies ServerApiResponse<string | undefined>;
  } catch (error) {
    return handleServerApiError("updateNotificationTypeAction", error);
  }
}
