"use server";

import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  createNotificationTemplateService,
  deleteNotificationTemplateService,
  markAllNotificationsReadService,
  markNotificationsReadService,
  sendNotificationService,
  updateNotificationTemplateService,
} from "./notifications.service";
import {
  CreateNotificationTemplateRequestDTO,
  CreateNotificationTemplateSchema,
  DeleteNotificationTemplateRequestDTO,
  DeleteNotificationTemplateSchema,
  MarkNotificationsReadRequestDTO,
  MarkNotificationsReadSchema,
  NotificationTemplateDTO,
  SendNotificationRequestDTO,
  SendNotificationSchema,
  UpdateNotificationTemplateRequestDTO,
  UpdateNotificationTemplateSchema,
} from "./notifications.types";

// -------------------------------------------------------------------
// Notification actions
//
// Each one validates its input with Zod and hands off to a service. There is no
// authorization decision in this file: the audience a sender may reach depends
// on their team scope, which the service resolves from the session. An action
// that pre-approved anything here would be a second answer to the same question.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Send a notification. The service resolves the recipients, applies the
// sender's scope and honours every opt-out.
// -------------------------------------------------------------------
export async function sendNotificationAction(
  requestDTO: SendNotificationRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    const validatedRequest = await validateRequest(SendNotificationSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await sendNotificationService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("sendNotificationAction", error);
  }
}

// -------------------------------------------------------------------
// Mark specific notifications as read (the recipient is the session user).
// -------------------------------------------------------------------
export async function markNotificationsReadAction(
  requestDTO: MarkNotificationsReadRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    const validatedRequest = await validateRequest(MarkNotificationsReadSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await markNotificationsReadService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("markNotificationsReadAction", error);
  }
}

// -------------------------------------------------------------------
// Mark every unread notification as read.
// -------------------------------------------------------------------
export async function markAllNotificationsReadAction(): Promise<ServerApiResponse<null>> {
  try {
    await markAllNotificationsReadService();

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("markAllNotificationsReadAction", error);
  }
}

// -------------------------------------------------------------------
// Create a reusable template (admin only; enforced in the service).
// -------------------------------------------------------------------
export async function createNotificationTemplateAction(
  requestDTO: CreateNotificationTemplateRequestDTO,
): Promise<ServerApiResponse<NotificationTemplateDTO>> {
  try {
    const validatedRequest = await validateRequest(CreateNotificationTemplateSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const template = await createNotificationTemplateService(validatedRequest.data);

    return { success: true, data: template } satisfies ServerApiResponse<NotificationTemplateDTO>;
  } catch (error) {
    return handleServerApiError("createNotificationTemplateAction", error);
  }
}

// -------------------------------------------------------------------
// Update a reusable template (admin only; enforced in the service).
// -------------------------------------------------------------------
export async function updateNotificationTemplateAction(
  requestDTO: UpdateNotificationTemplateRequestDTO,
): Promise<ServerApiResponse<NotificationTemplateDTO>> {
  try {
    const validatedRequest = await validateRequest(UpdateNotificationTemplateSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const template = await updateNotificationTemplateService(validatedRequest.data);

    return { success: true, data: template } satisfies ServerApiResponse<NotificationTemplateDTO>;
  } catch (error) {
    return handleServerApiError("updateNotificationTemplateAction", error);
  }
}

// -------------------------------------------------------------------
// Delete a reusable template (admin only; enforced in the service).
// -------------------------------------------------------------------
export async function deleteNotificationTemplateAction(
  requestDTO: DeleteNotificationTemplateRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    const validatedRequest = await validateRequest(DeleteNotificationTemplateSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await deleteNotificationTemplateService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("deleteNotificationTemplateAction", error);
  }
}
