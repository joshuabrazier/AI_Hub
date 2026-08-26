"use server";

import { BedrockNotConfiguredError } from "@/lib/ai/converse";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import { askTimesheetQueryService, QueryNotUnderstoodError } from "./admin-timesheets-query.service";
import {
  AskTimesheetQuerySchema,
  type AskTimesheetQueryRequestDTO,
  type TimesheetQueryResultDTO,
} from "./admin-timesheets-query.types";

// -------------------------------------------------------------------
// Ask a question, get a filtered view.
//
// No role check here: askTimesheetQueryService requires ADMIN itself, because
// an action is not the only thing that can call a service.
//
// NO revalidatePath. Nothing changed - the answer is a path, and the client
// navigates to it. A revalidate would be busywork on every question.
//
// The two recoverable failures come back as form errors rather than thrown
// faults, because neither is a fault: a question the model could not read as a
// filter, and a deployment with no model at all.
// -------------------------------------------------------------------
export async function askTimesheetQueryAction(
  request: AskTimesheetQueryRequestDTO,
): Promise<ServerApiResponse<TimesheetQueryResultDTO>> {
  try {
    const parsed = await validateRequest(AskTimesheetQuerySchema, request);
    if (!parsed.success) return parsed.response;

    const { question, ...filters } = parsed.data;

    return { success: true, data: await askTimesheetQueryService(question, filters) };
  } catch (error) {
    if (error instanceof QueryNotUnderstoodError) {
      return {
        success: false,
        formError: "I could not read that as a filter. Try naming a period, a person or a job.",
      };
    }

    if (error instanceof BedrockNotConfiguredError) {
      return { success: false, formError: "This environment has no AI model configured." };
    }

    return handleServerApiError("askTimesheetQueryAction", error);
  }
}
