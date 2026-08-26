"use server";

import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  beginTwoFactorEnrolmentService,
  verifyTwoFactorService,
} from "./two-factor.service";
import {
  VerifyTwoFactorSchema,
  type TwoFactorEnrolmentDTO,
  type VerifyTwoFactorRequestDTO,
} from "./two-factor.types";

// -------------------------------------------------------------------
// Two-factor actions.
//
// Neither takes a user id or a session id. Both services resolve the
// acting person from the session and repeat their own guard, so these
// validate the shape and nothing more.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Start enrolment and return the QR code, the typed key and the backup
// codes. Called from the enrol screen on mount.
//
// It takes no input at all, which is what keeps it safe to trigger: there
// is nothing in a request that could aim it at another account, and it
// refuses outright once the account is already verified.
// -------------------------------------------------------------------
export async function beginTwoFactorEnrolmentAction(): Promise<
  ServerApiResponse<TwoFactorEnrolmentDTO>
> {
  try {
    const enrolment = await beginTwoFactorEnrolmentService();

    return { success: true, data: enrolment } satisfies ServerApiResponse<TwoFactorEnrolmentDTO>;
  } catch (error) {
    return handleServerApiError("beginTwoFactorEnrolmentAction", error);
  }
}

// -------------------------------------------------------------------
// Check a code and let this session through.
//
// The rate limiting lives in the service, deliberately - an action is one
// entry point and the limiter has to hold for every caller of the service,
// not just this one.
// -------------------------------------------------------------------
export async function verifyTwoFactorAction(
  requestDTO: VerifyTwoFactorRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    const validatedRequest = await validateRequest(VerifyTwoFactorSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await verifyTwoFactorService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("verifyTwoFactorAction", error);
  }
}
