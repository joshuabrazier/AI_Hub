"use server";

import { requireUser } from "@/lib/auth/session-auth-server";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  deleteUserRateService,
  getUserRateDeletionImpactService,
  setUserRateService,
} from "./delivery-rates.service";
import {
  DeleteUserRateRequestDTO,
  DeleteUserRateSchema,
  SetUserRateRequestDTO,
  SetUserRateSchema,
  UserRateDTO,
  UserRateDeletionImpactDTO,
} from "./delivery.types";

// -------------------------------------------------------------------
// Rate actions.
//
// THREE, for a service with seven exports, and the arithmetic is worth
// stating. Two of the seven are mutations and both are here. Four are
// reads a SERVER COMPONENT performs directly - the overview, one person's
// history and a project's budget report are what their pages render, and
// `rateDeletionConsequenceOf` is pure and has no session to check - so
// none of them gets an action. The seventh, the deletion impact, is the
// exception argued for below.
//
// EVERY ONE OF THEM IS ADMIN-ONLY AND NONE OF THEM SAYS SO. The gate here
// is `requireUser`, exactly as it is on the transcription actions, and the
// role check lives in `requireRatesAdmin` inside the service. That is not
// laziness about a sensitive feature - it is the reason the feature is
// safe. The rates screen is not the only way in (a page can call the
// service directly, and one does), so the service has to hold the decision
// whatever an action does. Repeating it here would put "admin only" in two
// places, and the copy in the action is the one somebody would edit while
// wiring up a lead-visible report.
//
// So: each action proves there is a signed-in, two-factor-satisfied, set-up
// person on the other end, bounds the shape with Zod, and hands over. It
// decides nothing.
//
// NO revalidatePath HERE EITHER. `revalidateRatesViews` in the service
// runs after the write, inside the same call that knows whether it
// succeeded, and rates are mounted on ONE admin screen - there is no
// /manage or /portal path to keep in step, unlike the rest of delivery.
// Revalidating from the action as well would refresh a path on a save the
// service refused.
//
// A REFUSAL ARRIVES AS A SENTENCE, AND THE CATCH BELOW IS WHY. Everything
// these three can meet - a rate a second admin removed, an account since
// de-identified - is a DisplayErrorMessage rather than notFound(), because
// handleError calls unstable_rethrow and a notFound() thrown inside a server
// action escapes the catch, propagates past the action and replaces the page
// the caller is sitting on with the not-found page. handleServerApiError
// completes the path: Next's own control-flow errors are rethrown, then
// isDisplayError - the marker property, not `instanceof`, because a
// production chunk split breaks class identity - decides whether the
// message or the generic line is returned, as `formError`. So a caller reads
// `response.formError` and shows the sentence the service wrote.
//
// THE TWO notFound() ANSWERS THIS SERVICE STILL HAS ARE OUT OF REACH FROM
// HERE, and that is checked rather than assumed: `getUserRateHistoryService`
// and `buildBudgetReport` are PAGE reads keyed on an id in a path, where a
// 404 is the whole response and a guessed id learns nothing. Nothing below
// calls either. If an action is ever added for a read that does, it needs
// the sentence half of that pair first, not a catch here that swallows it.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Set a rate for one person in one band from one date.
//
// The schema has already turned dollars into integer cents by the time the
// service sees this, which is why the parameter is the REQUEST DTO and not
// the Input DTO: the Input type is what the form holds, and on a coerced
// field it widens to `unknown`, so typing an action against it would prove
// nothing and would let dollars through where cents are read. See the note
// on the first Input/Request pair in delivery.types.ts.
//
// Returns the saved row. The screen needs the id and the stored cents back:
// the upsert may have CORRECTED an existing row rather than added one, and
// the caller cannot tell which from what it sent.
// -------------------------------------------------------------------
export async function setUserRateAction(
  requestDTO: SetUserRateRequestDTO,
): Promise<ServerApiResponse<UserRateDTO>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(SetUserRateSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const rate = await setUserRateService(validatedRequest.data);

    return { success: true, data: rate } satisfies ServerApiResponse<UserRateDTO>;
  } catch (error) {
    return handleServerApiError("setUserRateAction", error);
  }
}

// -------------------------------------------------------------------
// What deleting this rate would do, for the confirmation dialog.
//
// THE ONE READ WITH AN ACTION, for the reason `listTeamsMeetingsAction`
// has one: the page cannot carry the answer. The impact of a delete is two
// further reads PER RATE ROW, and the rates screen lists every person in
// three bands, so pre-computing it for a dialog nobody may open would turn
// one page load into dozens of queries. It is wanted at the moment somebody
// reaches for Delete and not before.
//
// Validated with DeleteUserRateSchema, on purpose, even though this writes
// nothing. It is the same single id, and sharing the schema is what stops
// the dialog and the delete disagreeing about which ids are acceptable - a
// second schema of the same shape is one more thing to keep in step for no
// gain. The service also computes the answer with the same function the
// delete uses, so the warning shown cannot differ from the outcome.
// -------------------------------------------------------------------
export async function getUserRateDeletionImpactAction(
  requestDTO: DeleteUserRateRequestDTO,
): Promise<ServerApiResponse<UserRateDeletionImpactDTO>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(DeleteUserRateSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const impact = await getUserRateDeletionImpactService(validatedRequest.data.rateId);

    return { success: true, data: impact } satisfies ServerApiResponse<UserRateDeletionImpactDTO>;
  } catch (error) {
    return handleServerApiError("getUserRateDeletionImpactAction", error);
  }
}

// -------------------------------------------------------------------
// Delete a rate row, and hand back what it did.
//
// The impact is returned rather than discarded, and that is the service's
// decision rather than this file's - but it only reaches anybody if the
// action passes it on. A delete reached from a stale screen, a keyboard
// shortcut or a second tab still reports the unvalued window it opened, so
// being warned does not depend on a dialog having been opened first.
// -------------------------------------------------------------------
export async function deleteUserRateAction(
  requestDTO: DeleteUserRateRequestDTO,
): Promise<ServerApiResponse<UserRateDeletionImpactDTO>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(DeleteUserRateSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const impact = await deleteUserRateService(validatedRequest.data);

    return { success: true, data: impact } satisfies ServerApiResponse<UserRateDeletionImpactDTO>;
  } catch (error) {
    return handleServerApiError("deleteUserRateAction", error);
  }
}
