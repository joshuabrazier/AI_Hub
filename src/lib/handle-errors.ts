import { toast } from "sonner";
import { MESSAGES } from "./constants";
import { ServerApiResponse } from "./types";
import { isDisplayError, isRedirectError } from "./errors";
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

  if (isRedirectError(error)) {
    redirect(error.path);
  }

  // isDisplayError, not `instanceof` - see the note in errors.ts. A
  // production build can put the throw and this check in different chunks,
  // and identity comparison quietly fails across them, turning every
  // deliberate message into the generic one.
  const errorMessage = isDisplayError(error) ? error.message : MESSAGES.SOMETHING_WENT_WRONG;

  return {
    success: false,
    formError: errorMessage,
  };
}

// -------------------------------------------------------------------
// Is this the page having outlived the deployment it was served by?
//
// Next.js identifies a server action by a hash of the build it came from.
// Deploy while somebody has a page open and their tab keeps posting the OLD
// hash, which the new server has never heard of. It answers "Failed to find
// Server Action" and REJECTS THE REQUEST BEFORE ANY APPLICATION CODE RUNS.
//
// From the reader's side the button simply does nothing, and from the
// server's side there is no trace at all - not in a service log, not in an
// action log - because nothing of ours was reached. It cost most of an
// afternoon: every button on a stale tab is dead, and every diagnosis
// points at the feature the button belongs to rather than at the tab.
//
// Nothing can be fixed by retrying. The page has to be reloaded to fetch
// the current build's JavaScript, so that is what we tell people to do.
// -------------------------------------------------------------------
function isStaleDeploymentError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");

  return message.includes("Failed to find Server Action");
}

// -------------------------------------------------------------------
// handleFrontendErrorWithToast - log error then show error toast
// -------------------------------------------------------------------
export function handleFrontendErrorWithToast(error: unknown) {
  if (isStaleDeploymentError(error)) {
    console.error("Stale deployment: this page predates the running build.", error);

    // A button rather than an automatic reload. Reloading unprompted would
    // throw away whatever somebody had typed - a half-written chat message,
    // a form they are part-way through - and this fires on the first action
    // they attempt, which is often mid-task.
    toast.error("The app has been updated. Reload the page to continue.", {
      duration: Infinity,
      action: { label: "Reload", onClick: () => window.location.reload() },
    });

    return;
  }

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

  if (isDisplayError(error)) {
    errorMessage = error.message;
  } else {
    errorMessage = MESSAGES.SOMETHING_WENT_WRONG;
  }

  return errorMessage;
}
