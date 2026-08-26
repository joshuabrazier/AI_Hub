"use server";

import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  beginTwoFactorEnrolmentService,
  verifyTwoFactorService,
} from "./two-factor.service";
import {
  BeginTwoFactorEnrolmentSchema,
  VerifyTwoFactorSchema,
  type BeginTwoFactorEnrolmentRequestDTO,
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
// The ONLY input is a password, and it can only ever re-authenticate the
// caller's own account: the acting person comes from the session inside the
// service, so there is nothing in a request that could aim this at somebody
// else. It refuses outright once the account is already verified.
//
// In a real environment the field is never sent, because a Microsoft account
// has no password to send. See the service.
// -------------------------------------------------------------------
export async function beginTwoFactorEnrolmentAction(
  requestDTO: BeginTwoFactorEnrolmentRequestDTO = {},
): Promise<ServerApiResponse<TwoFactorEnrolmentDTO>> {
  try {
    const validatedRequest = await validateRequest(BeginTwoFactorEnrolmentSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const enrolment = await beginTwoFactorEnrolmentService(validatedRequest.data);

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
