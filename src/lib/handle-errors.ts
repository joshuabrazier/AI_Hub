import { toast } from "sonner";
import { MESSAGES } from "./constants";
import { ServerApiResponse } from "./types";
import { DisplayErrorMessage, RedirectError } from "./errors";
import { redirect, unstable_rethrow } from "next/navigation";

// -------------------------------------------------------------------
// handleError - log error
// -------------------------------------------------------------------
export function handleError(context: string, err: unknown) {
  // Next.js uses thrown errors as control flow (redirect / notFound / the
  // build-time "dynamic server usage" bail-out). Those MUST propagate to Next,
  // not be caught and logged - otherwise the redirect/404 never happens and the
  // build logs spurious errors. unstable_rethrow re-throws them; no-op otherwise.
  unstable_rethrow(err);

  const error = err instanceof Error ? err : new Error(String(err));

  console.error(`[${context}]`, error.message);
  return error;
}

// -------------------------------------------------------------------
// handleServerApiError - log error and return ServerApiResponse
// with success = false
// -------------------------------------------------------------------
export function handleServerApiError(method: string, error: unknown): ServerApiResponse<never> {
  // Let Next.js control-flow errors (redirect / notFound / dynamic server usage)
  // propagate instead of swallowing them into a failed response.
  unstable_rethrow(error);

  console.error(`${method} Error:`, error);

  if (error instanceof RedirectError) {
    redirect(error.path);
  }

  const errorMessage = error instanceof DisplayErrorMessage ? error.message : MESSAGES.SOMETHING_WENT_WRONG;

  return {
    success: false,
    formError: errorMessage,
  };
}

// -------------------------------------------------------------------
// handleFrontendErrorWithToast - log error then show error toast
// -------------------------------------------------------------------
export function handleFrontendErrorWithToast(error: unknown) {
  const errorMessage = getFrontendErrorMessage(error);

  console.error(errorMessage);

  toast.error(errorMessage);
}

// -------------------------------------------------------------------
// getFrontendErrorMessage - if error of type DisplayErrorMessage
// then show error else show something went wrong
// -------------------------------------------------------------------
function getFrontendErrorMessage(error: unknown) {
  let errorMessage: string;

  if (error instanceof DisplayErrorMessage) {
    errorMessage = error.message;
  } else {
    errorMessage = MESSAGES.SOMETHING_WENT_WRONG;
  }

  return errorMessage;
}
