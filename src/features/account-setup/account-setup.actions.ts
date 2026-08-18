"use server";

import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import { completeAccountSetupService } from "./account-setup.service";
import { CompleteAccountSetupRequestDTO, CompleteAccountSetupSchema } from "./account-setup.types";

// -------------------------------------------------------------------
// Finish first-run setup. The service resolves the account from the session
// and repeats its own guard; this validates the shape.
// -------------------------------------------------------------------
export async function completeAccountSetupAction(
  requestDTO: CompleteAccountSetupRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    const validatedRequest = await validateRequest(CompleteAccountSetupSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await completeAccountSetupService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("completeAccountSetupAction", error);
  }
}
