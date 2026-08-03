"use server";

import { ServerApiResponse } from "@/lib/types";
import { validateRequest } from "@/lib/server-requests";
import {
  AcceptInviteAndSignUpRequestDTO,
  AcceptInviteAndSignUpSchema,
  ValidateInviteRequestDTO,
  ValidateInviteResponseDTO,
  ValidateInviteSchema,
} from "./accept-invite.types";
import { handleServerApiError } from "@/lib/handle-errors";
import { acceptInviteAndSignUpService, validateInviteService } from "./accept-invite.service";

// -------------------------------------------------------------------
// Validate Invite
// -------------------------------------------------------------------
export async function validateInviteAction(
  requestDTO: ValidateInviteRequestDTO,
): Promise<ServerApiResponse<ValidateInviteResponseDTO>> {
  try {
    const validatedRequest = await validateRequest(ValidateInviteSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    // The VALIDATED data, not the raw request - passing the raw object through
    // would make the schema decorative, since Zod's guarantees only apply to
    // what it returns.
    const validateInviteResponse = await validateInviteService(validatedRequest.data);

    return {
      success: true,
      data: validateInviteResponse,
    } satisfies ServerApiResponse<ValidateInviteResponseDTO>;
  } catch (error) {
    return handleServerApiError("validateInviteAction", error);
  }
}

// -------------------------------------------------------------------
// Accept Invite and Sign Up
// -------------------------------------------------------------------
export async function acceptInviteAndSignUpAction(
  requestDTO: AcceptInviteAndSignUpRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    const validatedRequest = await validateRequest(AcceptInviteAndSignUpSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await acceptInviteAndSignUpService(validatedRequest.data);

    return {
      success: true,
      data: null,
    } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("acceptInviteAndSignUpAction", error);
  }
}
