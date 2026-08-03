import { z } from "zod";
import { ServerApiResponse } from "./types";

// -------------------------------------------------------------------
// zodErrorResponse - Return Zod Form and Field errors
// -------------------------------------------------------------------
export function zodErrorResponse(error: z.ZodError): ServerApiResponse<never> {
  const fieldErrors: Record<string, string[]> = {};
  let formError: string | undefined;

  for (const issue of error.issues) {
    const key = issue.path.join(".");

    if (key) {
      fieldErrors[key] ??= [];
      fieldErrors[key].push(issue.message);
    } else {
      formError = formError ? `${formError}, ${issue.message}` : issue.message;
    }
  }

  return {
    success: false,
    fieldErrors,
    formError,
  };
}

// -------------------------------------------------------------------
// validateRequest - Validate server request against Zod request schema
// -------------------------------------------------------------------
export async function validateRequest<Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: unknown,
): Promise<{ success: true; data: z.output<Schema> } | { success: false; response: ServerApiResponse<never> }> {
  // If input is FormData, convert it to a plain object automatically
  const payload = input instanceof FormData ? Object.fromEntries(input.entries()) : input;

  const result = await schema.safeParseAsync(payload);

  if (!result.success) {
    const responseError = zodErrorResponse(result.error);
    console.log("Validation Failed:", responseError);
    return {
      success: false,
      response: responseError,
    };
  }

  return {
    success: true,
    data: result.data as z.output<Schema>,
  };
}
