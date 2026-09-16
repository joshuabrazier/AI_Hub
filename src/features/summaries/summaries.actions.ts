"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session-auth-server";
import { handleServerApiError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import { deleteSavedSummaryService, getSavedSummaryService } from "./summaries.service";
import {
  SummaryIdSchema,
  type SavedSummaryDetailDTO,
  type SummaryIdRequestDTO,
} from "./summaries.types";

// -------------------------------------------------------------------
// Opening and removing a saved summary.
//
// Both take an id from the browser and neither trusts it: the services
// resolve the row against the SESSION user, so an id belonging to somebody
// else is not found rather than refused. See the note in the service on why
// that distinction matters here specifically.
//
// Sending the summary is NOT here. It streams, and a server action cannot
// return a stream - it goes through the route handler at
// /api/summaries/stream, which does its own session check.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Fetched on demand rather than with the page.
//
// The list carries titles and nothing else, because the two heavy columns
// are the pasted material and the answer. Loading fifty of those to render
// a sidebar would be megabytes of somebody's documents crossing the wire so
// that they could read one of them.
// -------------------------------------------------------------------
export async function getSavedSummaryAction(
  requestDTO: SummaryIdRequestDTO,
): Promise<ServerApiResponse<SavedSummaryDetailDTO>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(SummaryIdSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const summary = await getSavedSummaryService(validatedRequest.data);

    return { success: true, data: summary } satisfies ServerApiResponse<SavedSummaryDetailDTO>;
  } catch (error) {
    return handleServerApiError("getSavedSummaryAction", error);
  }
}

export async function deleteSavedSummaryAction(
  requestDTO: SummaryIdRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(SummaryIdSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await deleteSavedSummaryService(validatedRequest.data);

    // All three areas render the same page, and somebody can have it open
    // in more than one - so all three are revalidated rather than the one
    // this request happened to come from.
    revalidatePath(ROUTES.ADMIN_SUMMARIES);
    revalidatePath(ROUTES.MANAGE_SUMMARIES);
    revalidatePath(ROUTES.PORTAL_SUMMARIES);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("deleteSavedSummaryAction", error);
  }
}
