"use server";

import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  createDocumentService,
  deleteDocumentService,
  getAdminDocumentsService,
  getSignedDocumentService,
  updateDocumentService,
} from "./admin-documents.service";
import {
  AdminDocumentsDTO,
  CreateDocumentRequestDTO,
  CreateDocumentSchema,
  DeleteDocumentRequestDTO,
  DeleteDocumentSchema,
  SignedDocumentDetailDTO,
  UpdateDocumentRequestDTO,
  UpdateDocumentSchema,
  ViewSignatureRequestDTO,
  ViewSignatureSchema,
} from "./admin-documents.types";

// -------------------------------------------------------------------
// Staff document actions
//
// Each one validates its input and hands off to a service. The authorization
// decision is not repeated here: reading signing status is team-scoped and
// editing the document list is admin-only, and both of those are resolved from
// the session inside the service. A second answer in this file would be a
// second thing to keep in step.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// The documents, and who in the caller's scope has signed them.
// -------------------------------------------------------------------
export async function getAdminDocumentsAction(): Promise<ServerApiResponse<AdminDocumentsDTO>> {
  try {
    const data = await getAdminDocumentsService();

    return { success: true, data } satisfies ServerApiResponse<AdminDocumentsDTO>;
  } catch (error) {
    return handleServerApiError("getAdminDocumentsAction", error);
  }
}

// -------------------------------------------------------------------
// Open one stored signature. Fails rather than blanking if it cannot be
// decrypted - see the service.
// -------------------------------------------------------------------
export async function getSignedDocumentAction(
  requestDTO: ViewSignatureRequestDTO,
): Promise<ServerApiResponse<SignedDocumentDetailDTO>> {
  try {
    const validatedRequest = await validateRequest(ViewSignatureSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const data = await getSignedDocumentService(validatedRequest.data);

    return { success: true, data } satisfies ServerApiResponse<SignedDocumentDetailDTO>;
  } catch (error) {
    return handleServerApiError("getSignedDocumentAction", error);
  }
}

// -------------------------------------------------------------------
// Create a document (admin only; enforced in the service).
// -------------------------------------------------------------------
export async function createDocumentAction(
  requestDTO: CreateDocumentRequestDTO,
): Promise<ServerApiResponse<string>> {
  try {
    const validatedRequest = await validateRequest(CreateDocumentSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const documentId = await createDocumentService(validatedRequest.data);

    return { success: true, data: documentId } satisfies ServerApiResponse<string>;
  } catch (error) {
    return handleServerApiError("createDocumentAction", error);
  }
}

// -------------------------------------------------------------------
// Update a document (admin only; enforced in the service).
// -------------------------------------------------------------------
export async function updateDocumentAction(
  requestDTO: UpdateDocumentRequestDTO,
): Promise<ServerApiResponse<string | undefined>> {
  try {
    const validatedRequest = await validateRequest(UpdateDocumentSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const documentId = await updateDocumentService(validatedRequest.data);

    return { success: true, data: documentId } satisfies ServerApiResponse<string | undefined>;
  } catch (error) {
    return handleServerApiError("updateDocumentAction", error);
  }
}

// -------------------------------------------------------------------
// Delete a document (admin only; enforced in the service). Signatures survive.
// -------------------------------------------------------------------
export async function deleteDocumentAction(
  requestDTO: DeleteDocumentRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    const validatedRequest = await validateRequest(DeleteDocumentSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await deleteDocumentService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("deleteDocumentAction", error);
  }
}
