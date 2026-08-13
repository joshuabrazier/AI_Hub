"use server";

import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import { getAiChatRequestLogDetailService } from "./admin-ai-chat-log.service";
import {
  GetAiChatRequestLogDetailSchema,
  type AiChatRequestLogDetailDTO,
  type GetAiChatRequestLogDetailRequestDTO,
} from "./admin-ai-chat-log.types";

// -------------------------------------------------------------------
// AI chat log actions
//
// Only the detail fetch is an action - the list is rendered by the page from
// its own service call, because the filter and page live in the URL.
//
// The role check here is the outer gate only; the service repeats it, and the
// service is also where the audit entry is written. Fetching a payload has a
// side effect on purpose: reading somebody's conversation should leave a
// trace whether it happened through this action or any future caller.
// -------------------------------------------------------------------
export async function getAiChatRequestLogDetailAction(
  requestDTO: GetAiChatRequestLogDetailRequestDTO,
): Promise<ServerApiResponse<AiChatRequestLogDetailDTO>> {
  try {
    await requireUserRole([USER_ROLES.ADMIN]);

    const validatedRequest = await validateRequest(GetAiChatRequestLogDetailSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const detail = await getAiChatRequestLogDetailService(validatedRequest.data);

    return { success: true, data: detail } satisfies ServerApiResponse<AiChatRequestLogDetailDTO>;
  } catch (error) {
    return handleServerApiError("getAiChatRequestLogDetailAction", error);
  }
}
