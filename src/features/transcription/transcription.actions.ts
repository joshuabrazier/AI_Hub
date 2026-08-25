"use server";

import { requireUser } from "@/lib/auth/session-auth-server";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  createTranscriptionService,
  deleteTranscriptionService,
  getTranscriptTextService,
  refreshTranscriptionService,
  renameTranscriptionService,
  retryTranscriptionSummaryService,
  startTranscriptionService,
} from "./transcription.service";
import {
  CreateTranscriptionRequestDTO,
  CreateTranscriptionSchema,
  RenameTranscriptionRequestDTO,
  RenameTranscriptionSchema,
  TranscriptionDetailDTO,
  TranscriptionIdRequestDTO,
  TranscriptionIdSchema,
  TranscriptionUploadTicketDTO,
} from "./transcription.types";

// -------------------------------------------------------------------
// Transcription actions
//
// ALL of them, including the one that hands out an upload URL - which is
// worth saying because AI chat had to make two of its equivalents route
// handlers instead. Neither reason applies here: nothing streams, and the
// media never passes through the app at all, so nothing here is anywhere
// near the server-action body limit. The whole point of the upload URL is
// that a 500 MB recording goes browser-to-storage and never touches this
// process.
//
// Each action validates its input and hands off to the service. The
// requireUser here is the outer gate only - the service repeats it, and the
// service is what actually resolves the row against the session user.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Claim a place for a recording and get somewhere to put it.
//
// The browser then PUTs the file to the returned URL and calls
// startTranscriptionAction. Two steps rather than one because the upload
// is the slow part and it does not belong in a server action.
// -------------------------------------------------------------------
export async function createTranscriptionAction(
  requestDTO: CreateTranscriptionRequestDTO,
): Promise<ServerApiResponse<TranscriptionUploadTicketDTO>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(CreateTranscriptionSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const ticket = await createTranscriptionService(validatedRequest.data);

    return { success: true, data: ticket } satisfies ServerApiResponse<TranscriptionUploadTicketDTO>;
  } catch (error) {
    return handleServerApiError("createTranscriptionAction", error);
  }
}

// -------------------------------------------------------------------
// The upload finished: hand the file to the transcription service.
// Also the retry path for a job that failed - see the service.
// -------------------------------------------------------------------
export async function startTranscriptionAction(
  requestDTO: TranscriptionIdRequestDTO,
): Promise<ServerApiResponse<TranscriptionDetailDTO>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(TranscriptionIdSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const transcription = await startTranscriptionService(validatedRequest.data);

    return { success: true, data: transcription } satisfies ServerApiResponse<TranscriptionDetailDTO>;
  } catch (error) {
    return handleServerApiError("startTranscriptionAction", error);
  }
}

// -------------------------------------------------------------------
// Where a running job has got to. Polled by the page while one is in
// flight; the service advances the row as a side effect of being asked.
// -------------------------------------------------------------------
export async function refreshTranscriptionAction(
  requestDTO: TranscriptionIdRequestDTO,
): Promise<ServerApiResponse<TranscriptionDetailDTO>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(TranscriptionIdSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const transcription = await refreshTranscriptionService(validatedRequest.data);

    return { success: true, data: transcription } satisfies ServerApiResponse<TranscriptionDetailDTO>;
  } catch (error) {
    return handleServerApiError("refreshTranscriptionAction", error);
  }
}

// -------------------------------------------------------------------
// Try the summary again, for a transcript that arrived without one.
// -------------------------------------------------------------------
export async function retryTranscriptionSummaryAction(
  requestDTO: TranscriptionIdRequestDTO,
): Promise<ServerApiResponse<TranscriptionDetailDTO>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(TranscriptionIdSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const transcription = await retryTranscriptionSummaryService(validatedRequest.data);

    return { success: true, data: transcription } satisfies ServerApiResponse<TranscriptionDetailDTO>;
  } catch (error) {
    return handleServerApiError("retryTranscriptionSummaryAction", error);
  }
}

// -------------------------------------------------------------------
// Rename.
// -------------------------------------------------------------------
export async function renameTranscriptionAction(
  requestDTO: RenameTranscriptionRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(RenameTranscriptionSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await renameTranscriptionService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("renameTranscriptionAction", error);
  }
}

// -------------------------------------------------------------------
// Delete a transcription, its transcript and any recording still held.
// -------------------------------------------------------------------
export async function deleteTranscriptionAction(
  requestDTO: TranscriptionIdRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(TranscriptionIdSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await deleteTranscriptionService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("deleteTranscriptionAction", error);
  }
}

// -------------------------------------------------------------------
// The transcript as a plain-text file.
//
// An action rather than a route handler because it returns the text and
// lets the browser save it, which keeps the transcript inside the same
// session-checked path as everything else. A download route would be a
// second entry point to the same private content for no gain - the text is
// already in the page.
// -------------------------------------------------------------------
export async function downloadTranscriptAction(
  requestDTO: TranscriptionIdRequestDTO,
): Promise<ServerApiResponse<{ fileName: string; text: string }>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(TranscriptionIdSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const file = await getTranscriptTextService(validatedRequest.data);

    return { success: true, data: file } satisfies ServerApiResponse<{ fileName: string; text: string }>;
  } catch (error) {
    return handleServerApiError("downloadTranscriptAction", error);
  }
}
