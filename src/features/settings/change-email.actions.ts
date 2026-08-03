"use server";

import { headers } from "next/headers";

import { auth } from "@/lib/auth/auth";
import { requireUser } from "@/lib/auth/session-auth-server";
import { MESSAGES } from "@/lib/constants";
import { sendEmailChangeNotification } from "@/lib/email/send-email";
import { handleServerApiError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import { ChangeEmailRequestDTO, changeEmailRequestSchema } from "./change-email.types";

// -------------------------------------------------------------------
// Change Email
// Re-authenticates with the current password before sending the
// verification link to the new address, and notifies the old address.
// This stops a stolen/shared session from silently taking over the
// account by changing its email.
// -------------------------------------------------------------------
export async function changeEmailAction(request: ChangeEmailRequestDTO): Promise<ServerApiResponse<null>> {
  try {
    const user = await requireUser();

    const validatedRequest = await validateRequest(changeEmailRequestSchema, request);
    if (!validatedRequest.success) return validatedRequest.response;

    const requestHeaders = await headers();

    // Require the current password before allowing an email change
    try {
      await auth.api.verifyPassword({
        body: { password: validatedRequest.data.currentPassword },
        headers: requestHeaders,
      });
    } catch {
      return {
        success: false,
        formError: MESSAGES.CURRENT_PASSWORD_INCORRECT,
      } satisfies ServerApiResponse<null>;
    }

    // Send the verification link to the new address (the change applies when
    // clicked). Sessions are revoked once it's confirmed (see auth.ts
    // afterEmailVerification), so send the user back to sign in with a
    // confirmation that their email was changed.
    await auth.api.changeEmail({
      body: {
        newEmail: validatedRequest.data.newEmail,
        callbackURL: ROUTES.PUBLIC_AUTH_SIGN_IN_EMAIL_CHANGED,
      },
      headers: requestHeaders,
    });

    // Notify the old address so the change can't happen silently
    await sendEmailChangeNotification({
      toAddress: user.email,
      newEmail: validatedRequest.data.newEmail,
    });

    return {
      success: true,
      data: null,
    } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("changeEmailAction", error);
  }
}
