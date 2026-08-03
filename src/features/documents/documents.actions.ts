"use server";

import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import { signDocumentService } from "./documents.service";
import { SignDocumentRequestDTO, SignDocumentSchema } from "./documents.types";

// -------------------------------------------------------------------
// Sign a document.
//
// The signer is the session user, resolved in the service - there is no user id
// in this request to check, by design. The document key is validated for shape
// here and resolved to an active document row there.
// -------------------------------------------------------------------
export async function signDocumentAction(
  requestDTO: SignDocumentRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    const validatedRequest = await validateRequest(SignDocumentSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await signDocumentService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("signDocumentAction", error);
  }
}
