"use server";

import { requireUser } from "@/lib/auth/session-auth-server";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  createAiChatSubjectService,
  deleteAiChatSubjectService,
  renameAiChatSubjectService,
} from "./ai-chat.service";
import {
  DeleteAiChatSubjectRequestDTO,
  DeleteAiChatSubjectSchema,
  RenameAiChatSubjectRequestDTO,
  RenameAiChatSubjectSchema,
} from "./ai-chat.types";

// -------------------------------------------------------------------
// AI chat actions
//
// Everything EXCEPT sending a message. A send streams its reply, and a
// server action cannot return a stream, so that one path is a Route Handler
// (src/app/api/ai-chat/stream/route.ts) instead.
//
// Each action validates its input and hands off to the service. The
// requireUser here is the outer gate only - the service repeats it, because
// an action is not the only thing that calls these services.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Start a conversation. Returns its id so the caller can open it.
// -------------------------------------------------------------------
export async function createAiChatSubjectAction(): Promise<ServerApiResponse<string>> {
  try {
    await requireUser();

    const subjectId = await createAiChatSubjectService();

    return { success: true, data: subjectId } satisfies ServerApiResponse<string>;
  } catch (error) {
    return handleServerApiError("createAiChatSubjectAction", error);
  }
}

// -------------------------------------------------------------------
// Rename a conversation.
// -------------------------------------------------------------------
export async function renameAiChatSubjectAction(
  requestDTO: RenameAiChatSubjectRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(RenameAiChatSubjectSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await renameAiChatSubjectService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("renameAiChatSubjectAction", error);
  }
}

// -------------------------------------------------------------------
// Delete a conversation and its transcript.
// -------------------------------------------------------------------
export async function deleteAiChatSubjectAction(
  requestDTO: DeleteAiChatSubjectRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(DeleteAiChatSubjectSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await deleteAiChatSubjectService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("deleteAiChatSubjectAction", error);
  }
}
