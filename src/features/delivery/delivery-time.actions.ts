"use server";

import { requireUser } from "@/lib/auth/session-auth-server";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  addTimesheetRowService,
  adjustTaskEstimateService,
  deleteTimeEntryService,
  getTimesheetWeekService,
  logTimeService,
  updateTimeEntryService,
} from "./delivery-time.service";
import {
  AddTimesheetRowSchema,
  AdjustTaskEstimateSchema,
  DeleteTimeEntrySchema,
  LogTimeSchema,
  TimesheetWeekSchema,
  UpdateTimeEntrySchema,
  type AddTimesheetRowRequestDTO,
  type AdjustTaskEstimateRequestDTO,
  type DeleteTimeEntryRequestDTO,
  type LogTimeRequestDTO,
  type TimeEntryDTO,
  type TimesheetRowDTO,
  type TimesheetWeekDTO,
  type TimesheetWeekRequestDTO,
  type UpdateTimeEntryRequestDTO,
} from "./delivery.types";

// -------------------------------------------------------------------
// ===================================================================
// DELIVERY: THE TIME WRITES
// ===================================================================
//
// Four of them: log an hour, correct one, remove one, and move an estimate.
// Plus the timesheet grid's two entry points, which write nothing and are
// argued for at the bottom of this block.
//
// EACH IS A SHAPE CHECK AND A HAND-OFF. The requireUser here is the OUTER
// GATE ONLY - it keeps an unauthenticated post out of a service call, and
// decides nothing else. Every question that matters is answered in
// delivery-time.service.ts: which project the task belongs to, whether the
// caller holds a membership row on it, whether they are a lead, whose time
// this is, and what the hour was worth on the day it was worked. An action
// that re-answered any of those would be a second authorization to keep in
// step with the first, and a page calling the service directly gets the
// service's answer either way.
//
// `hours` ARRIVES AS HOURS AND LEAVES AS MINUTES, converted once by the
// schema. That is why every parameter below is the REQUEST DTO and not the
// input DTO: `z.coerce` widens `z.input` to `unknown`, so the input type
// would leave the one field a caller most needs help with typed as anything
// at all. The request type is a shape check on the call site, not a promise
// the value has already been converted - validateRequest is what converts
// it, and only the service reads the converted value.
//
// NOTHING HERE REVALIDATES. The service invalidates all six delivery
// surfaces itself on every successful write, because one logged hour moves a
// timesheet cell, a board card's logged-against-estimate figure and a budget
// bar, in whichever of the three areas the reader happens to be in.
// Repeating those paths here would run the same invalidation twice and would
// fall behind the service the first time a seventh surface is added.
//
// A REFUSAL FROM THE SERVICE HAS TO ARRIVE AS A SENTENCE, AND THIS FILE IS
// THE SECOND HALF OF THAT PATH. Every refusal in delivery-time.service.ts is
// a DisplayErrorMessage - a task a lead deleted a moment ago, an entry a
// second tab already removed, a project the caller holds no membership on -
// and NOT notFound(), because handleError calls unstable_rethrow: a
// notFound() thrown inside a server action escapes the catch by design,
// propagates past the action and replaces the page the caller is sitting on
// with the not-found page. On this feature that means somebody's half-filled
// timesheet week disappearing over an ordinary race.
//
// handleServerApiError is what finishes the job, and every catch below calls
// it: it rethrows Next's own control-flow errors, then tests isDisplayError
// - by the marker property, not `instanceof`, because a production chunk
// split breaks class identity and would collapse each message into the
// generic line - and returns the message as `formError`. So the sentence the
// service wrote is the sentence the screen can show, and a caller reads
// `response.formError`. A catch here that returned its own generic failure,
// or that inspected the error itself, would quietly undo all of it.
//
// THE TWO READS ON THIS SERVICE NOW HAVE ACTIONS, because delivery.types.ts
// now carries a schema for each: TimesheetWeekSchema and
// AddTimesheetRowSchema. Neither call writes anything - opening a week and
// adding an empty row both store nothing - and both are here anyway, for the
// reason listTeamsMeetingsAction is on the transcription actions: the page
// cannot carry the answer. The added rows are furniture out of a
// browser-held store, and a server component cannot see one, so the grid has
// to ask for the week again with the rows the store is holding.
//
// THE DIRECT PAGE PATH STAYS, AND IT IS NOT A DUPLICATE OF THIS ONE. A
// server component still calls getTimesheetWeekService with the URL's own
// `?week=`, where a bookmarked, edited or forwarded date lands on this week
// rather than on an error. An action's caller is a control this app wrote,
// so a date it made up is a bug worth reporting, which is exactly what
// calendarDateField does. Both schemas normalise `weekStart` through
// startOfWeek and the service normalises again; that is safe rather than
// wasteful, because the start of a week is its own start.
//
// NEITHER READ REVALIDATES, for a plainer reason than the writes above:
// there is nothing to invalidate.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Log time against one task.
//
// Returns the stored entry so the caller can render the cell it just filled
// without re-reading the week. No rate reaches the DTO - the snapshots the
// service captured are for the budget report, which is gated on its own.
//
// `userId` is optional and means "me" when absent. Sending one is not proof
// of anything: the service branches on what the caller may do BEFORE it
// looks at the value, and discards it outright for an ordinary member rather
// than validating it, so there is nothing here to probe with a colleague's
// id.
// -------------------------------------------------------------------
export async function logTimeAction(requestDTO: LogTimeRequestDTO): Promise<ServerApiResponse<TimeEntryDTO>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(LogTimeSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const entry = await logTimeService(validatedRequest.data);

    return { success: true, data: entry } satisfies ServerApiResponse<TimeEntryDTO>;
  } catch (error) {
    return handleServerApiError("logTimeAction", error);
  }
}

// -------------------------------------------------------------------
// Correct an entry: the day, the length, the note.
//
// The schema carries no task and no person, so this cannot move an hour to
// another project - see the note on UpdateTimeEntrySchema for why that is a
// delete and a re-log rather than an edit. The updated entry comes back for
// the same reason the log does.
// -------------------------------------------------------------------
export async function updateTimeEntryAction(
  requestDTO: UpdateTimeEntryRequestDTO,
): Promise<ServerApiResponse<TimeEntryDTO>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(UpdateTimeEntrySchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const entry = await updateTimeEntryService(validatedRequest.data);

    return { success: true, data: entry } satisfies ServerApiResponse<TimeEntryDTO>;
  } catch (error) {
    return handleServerApiError("updateTimeEntryAction", error);
  }
}

// -------------------------------------------------------------------
// Remove an entry.
//
// Nothing comes back but success: the row is gone, and the screens that
// showed it are already being revalidated by the service.
// -------------------------------------------------------------------
export async function deleteTimeEntryAction(requestDTO: DeleteTimeEntryRequestDTO): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(DeleteTimeEntrySchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await deleteTimeEntryService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("deleteTimeEntryAction", error);
  }
}

// -------------------------------------------------------------------
// Add hours to a task's estimate, or move them off another task.
//
// ONE ACTION FOR BOTH, because AdjustTaskEstimateSchema is one discriminated
// union: validateRequest picks the branch on `source`, so a transfer with no
// `fromTaskId`, or one taking hours from the task they are going to, comes
// back as a FIELD error against the control somebody used rather than as a
// sentence from the service. Splitting it in two here would move the choice
// between the branches into the caller and leave the union with no reader.
//
// Whether the caller may do it at all is the service's answer - lead or
// admin, on that project, with the source task in the same one.
// -------------------------------------------------------------------
export async function adjustTaskEstimateAction(
  requestDTO: AdjustTaskEstimateRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(AdjustTaskEstimateSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await adjustTaskEstimateService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("adjustTaskEstimateAction", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// THE TIMESHEET GRID'S TWO ENTRY POINTS
// ===================================================================
//
// Neither writes. Both are here because the grid holds state a server
// component cannot read - see the block at the top of this file.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// One person's week: seven columns, one row per task.
//
// `weekStart` may be ANY day in the week and comes back as the week's own
// first day, so a caller can hand over the date it happens to be holding.
// `addedTaskIds` are the empty rows the browser is carrying: de-duplicated
// and CAPPED rather than refused by the schema, because a store that has
// been accumulating for weeks should open a working week rather than fail
// one. The service applies the same cap again, since a page reaches it
// without passing through here.
//
// `userId` is optional and means "me". Naming somebody else is admin-only,
// and the service refuses it in words - a lead deliberately cannot, because
// a week is one person's time across every project they are on.
//
// SPLIT RATHER THAN PASSED WHOLE, because the service takes the date
// positionally and the rest as options. Nothing is dropped in the process:
// TimesheetWeekRequestDTO is exactly `weekStart` plus the fields
// TimesheetWeekOptions names, which is why it is assignable to it.
// -------------------------------------------------------------------
export async function getTimesheetWeekAction(
  requestDTO: TimesheetWeekRequestDTO,
): Promise<ServerApiResponse<TimesheetWeekDTO>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(TimesheetWeekSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const { weekStart, ...options } = validatedRequest.data;

    const week = await getTimesheetWeekService(weekStart, options);

    return { success: true, data: week } satisfies ServerApiResponse<TimesheetWeekDTO>;
  } catch (error) {
    return handleServerApiError("getTimesheetWeekAction", error);
  }
}

// -------------------------------------------------------------------
// Add an empty row to the week.
//
// IT STORES NOTHING AND IT STILL BEHAVES LIKE A WRITE, which is why it has
// an action at all: somebody pressed Add, so a task they may not log time to
// is refused in a sentence rather than dropped. The week read drops the same
// row silently, and the difference is deliberate - there an empty row is
// furniture, here a person is asking for it. Whose week it is, and whether
// they are on the project, are the service's answers.
//
// `weekStart` is part of the request because the row comes back with seven
// empty cells in the week's own order, so the grid can render it beside rows
// that came from the week read without building cells of its own.
// -------------------------------------------------------------------
export async function addTimesheetRowAction(
  requestDTO: AddTimesheetRowRequestDTO,
): Promise<ServerApiResponse<TimesheetRowDTO>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(AddTimesheetRowSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const { taskId, weekStart, ...options } = validatedRequest.data;

    const row = await addTimesheetRowService(taskId, weekStart, options);

    return { success: true, data: row } satisfies ServerApiResponse<TimesheetRowDTO>;
  } catch (error) {
    return handleServerApiError("addTimesheetRowAction", error);
  }
}
