"use server";

import { requireUser } from "@/lib/auth/session-auth-server";
import { handleServerApiError } from "@/lib/handle-errors";
import { registerBrowserPush, unregisterBrowserPush } from "@/lib/push/push-notifications";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  DisablePushRequestDTO,
  disablePushSchema,
  EnablePushRequestDTO,
  enablePushSchema,
} from "./push.types";

// -------------------------------------------------------------------
// Register this device for push notifications for the signed-in user.
// The user id comes from the session (never the client), so a device can only
// ever be tagged for its own account.
// -------------------------------------------------------------------
export async function enablePushAction(requestDTO: EnablePushRequestDTO): Promise<ServerApiResponse<null>> {
  try {
    const user = await requireUser();

    const validatedRequest = await validateRequest(enablePushSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await registerBrowserPush(validatedRequest.data.installationId, user.id, {
      endpoint: validatedRequest.data.endpoint,
      p256dh: validatedRequest.data.p256dh,
      auth: validatedRequest.data.auth,
    });

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("enablePushAction", error);
  }
}

// -------------------------------------------------------------------
// Unregister this device (client turned notifications off).
// -------------------------------------------------------------------
export async function disablePushAction(requestDTO: DisablePushRequestDTO): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(disablePushSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await unregisterBrowserPush(validatedRequest.data.installationId);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("disablePushAction", error);
  }
}
