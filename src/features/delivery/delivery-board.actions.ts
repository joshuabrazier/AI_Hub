"use server";

import { requireUser } from "@/lib/auth/session-auth-server";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  createTaskService,
  deleteTaskAttachmentService,
  deleteTaskService,
  moveTaskService,
  updateTaskService,
} from "./delivery-board.service";
import {
  CreateTaskRequestDTO,
  CreateTaskSchema,
  DeleteTaskRequestDTO,
  DeleteTaskSchema,
  MoveTaskRequestDTO,
  MoveTaskSchema,
  TaskAttachmentIdRequestDTO,
  TaskAttachmentIdSchema,
  UpdateTaskRequestDTO,
  UpdateTaskSchema,
} from "./delivery.types";

// -------------------------------------------------------------------
// Board actions: the four things somebody does to a card, and the one
// thing they do to a file on it.
//
// FIVE, FOR A SERVICE WITH TEN ASYNC EXPORTS, and the arithmetic is worth
// writing down so the gap does not read as an oversight.
//
//   FOUR CARD MUTATIONS are here: create, edit, move, delete.
//
//   ONE ATTACHMENT MUTATION IS HERE: the delete, now that
//   delivery.types.ts carries a schema for an attachment id. The OTHER one,
//   the upload, is never getting an action - see the closing note, which is
//   where that argument lives rather than being repeated here.
//
//   FOUR READS ARE NOT HERE. The board, one task opened, this person's work
//   list and a task's attachments are all what a SERVER COMPONENT renders,
//   and each of them answers a scope miss with notFound() - a page's
//   answer. An action wrapper around one of those would turn a card
//   somebody else has just deleted into the not-found page replacing the
//   whole board, which is the opposite of what a fetch-on-demand caller
//   wants. TaskIdSchema now exists and is NOT what was missing; see the
//   closing note.
//
// THE GATE HERE IS requireUser AND NOTHING ELSE, exactly as on the
// transcription actions. The four card mutations are lead-or-admin and none
// of them says so: requireProjectAccessForWrite plus the canEditTasks check
// inside the service is where that decision lives, because a board page
// calls the service directly and would otherwise be guarded by a check that
// only ran when a button was pressed. Repeating the rule here would put
// "lead or admin" in two files, and the copy in the action is the one
// somebody would edit while wiring up a screen for a member.
//
// AND THE ATTACHMENT DELETE IS A DIFFERENT RULE AGAIN - the person who
// uploaded the file, or a lead, or an admin - which settles the question
// rather than complicating it: "who uploaded it" is on the row, so an
// action could not answer it without reading the row the service is about
// to authorise on. Two mutations here would need two different checks, and
// neither belongs in a file whose job is to bound a shape.
//
// So each action proves there is a signed-in, two-factor-satisfied, set-up
// person on the other end, bounds the shape with Zod, and hands over. IT
// DECIDES NOTHING - not who may write, not which project a card is in, not
// where in a column it lands.
//
// EVERY PARAMETER IS THE REQUEST DTO, NEVER THE INPUT DTO. Two of these
// schemas coerce (hours to minutes, a drop position to an integer), and on a
// coerced field z.input widens to unknown - typing an action against it
// would prove nothing at the one boundary that exists to prove something.
// See the note on the first Input/Request pair in delivery.types.ts.
//
// NO revalidatePath HERE. revalidateBoardViews runs inside the service,
// after the write, in the call that knows whether it succeeded - and it
// refreshes the subtree of all three areas, which an action has no reason to
// know about. Revalidating here as well would refresh a board on a save the
// service refused.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Add a card to a phase.
//
// The request carries phaseId and no project id, so there is only one claim
// about where this lands and the service resolves the project from the phase
// it names. estimateHours holds MINUTES by the time the service sees it,
// which is the schema's doing and not this file's.
//
// Returns the new task id. The board re-renders from the revalidation the
// service performs; what the caller needs back is the handle to open what it
// just made.
// -------------------------------------------------------------------
export async function createTaskAction(
  requestDTO: CreateTaskRequestDTO,
): Promise<ServerApiResponse<string>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(CreateTaskSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const taskId = await createTaskService(validatedRequest.data);

    return { success: true, data: taskId } satisfies ServerApiResponse<string>;
  } catch (error) {
    return handleServerApiError("createTaskAction", error);
  }
}

// -------------------------------------------------------------------
// Edit a card's title, description and assignee.
//
// No estimate and no column: an estimate change belongs in the append-only
// log and is the time service's mutation, and a move renumbers siblings so
// it is the action below. The schema carries neither field, so a form that
// grew one would fail here rather than silently save three quarters of
// itself.
// -------------------------------------------------------------------
export async function updateTaskAction(
  requestDTO: UpdateTaskRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(UpdateTaskSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await updateTaskService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("updateTaskAction", error);
  }
}

// -------------------------------------------------------------------
// A drag: phase, column and slot in one write.
//
// One action rather than three, because the schema keeps the three facts
// together - a card dragged across phases moves column and slot at the same
// moment, and applying that as two calls leaves it somewhere nobody dropped
// it. The service turns the position into the destination column's whole
// ordered list, so a replay of the same request produces the same board.
//
// It returns null even though the board has changed shape, and that is the
// revalidation above doing the work: handing back a card here would be a
// second description of a board the client is about to be sent anyway.
// -------------------------------------------------------------------
export async function moveTaskAction(
  requestDTO: MoveTaskRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(MoveTaskSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await moveTaskService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("moveTaskAction", error);
  }
}

// -------------------------------------------------------------------
// Delete a card.
//
// It is allowed to be REFUSED in words - a task with time logged against it
// stays, and the service says so and offers the done column instead. That
// arrives here as a DisplayErrorMessage and leaves as formError, which is
// most of the reason a delete goes through an action rather than through
// something that would have to interpret a Postgres constraint violation.
// -------------------------------------------------------------------
export async function deleteTaskAction(
  requestDTO: DeleteTaskRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(DeleteTaskSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await deleteTaskService(validatedRequest.data);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("deleteTaskAction", error);
  }
}

// -------------------------------------------------------------------
// Remove one file from a card.
//
// AN ATTACHMENT ID AND NOTHING ELSE, which is the whole request: the row
// carries the task, the task carries the project, and the service
// authorises on that project rather than on anything sent alongside. A task
// id here would be a second claim about where the file lives, and the two
// could disagree.
//
// It is allowed to be REFUSED in words, twice over - a file that has
// already gone, and a file somebody else attached that the caller is
// neither a lead nor an admin over. Both arrive as a DisplayErrorMessage
// and leave as formError, so the caller must show it rather than treating a
// failed delete as a fault.
//
// The service is passed the id positionally because that is the signature
// it has. Nothing is unwrapped except the field the schema just proved.
// -------------------------------------------------------------------
export async function deleteTaskAttachmentAction(
  requestDTO: TaskAttachmentIdRequestDTO,
): Promise<ServerApiResponse<null>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(TaskAttachmentIdSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    await deleteTaskAttachmentService(validatedRequest.data.attachmentId);

    return { success: true, data: null } satisfies ServerApiResponse<null>;
  } catch (error) {
    return handleServerApiError("deleteTaskAttachmentAction", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// WHAT IS NOT HERE, AND WHY
// ===================================================================
//
//   1. addTaskAttachmentAction. DELIBERATELY NEVER AN ACTION, and this is
//      the one gap on the list that is not waiting for anything. Its
//      parameter is not a request DTO at all: mediaType must have been
//      derived by SNIFFING THE BYTES and byteSize must be the number
//      actually written, so there is nothing here a Zod schema could
//      honestly validate - parsing either from a browser payload would make
//      a stored-XSS decision in the wrong file, and would afterwards read as
//      the check that had been done. delivery.types.ts says the same thing
//      over TaskAttachmentUpload and gives the browser's half its own
//      schema, UploadTaskAttachmentSchema, which is a task id and a file
//      name and nothing that describes the bytes.
//
//      The bytes cannot travel through an action either, because
//      serverActions.bodySizeLimit is global and defaults to 1 MB. So the
//      upload is the ROUTE HANDLER the service's own findings ask for: it
//      validates that schema, sniffs the bytes, writes the blob with
//      putTaskAttachment and then calls the service - the same exception AI
//      chat's upload already is. It does not exist yet.
//
//   2. NO READ ACTIONS, which is a decision and not an omission, and
//      TaskIdSchema landing in the contract file has not changed it. The
//      board is a page keyed on /projects/[projectId], the work list is a
//      page, and both by-id reads answer notFound() on a miss - the
//      enumeration answer a page owes a guessed id. The missing schema was
//      never the blocker; the refusal SHAPE is.
//
//      NOTHING IN THIS MODULE FETCHES ON DEMAND YET either: there is not a
//      client component in src/features/delivery at all, so there is no
//      caller to serve. listTeamsMeetingsAction earns its action by asking
//      MICROSOFT something a page must not wait on, and every read on this
//      service is one fixed set of queries against our own database in the
//      request that renders the screen.
//
//      IF THE TASK PANEL LATER OPENS AS A DIALOG over the client-side board
//      rather than as a route, that changes - and the work is in the
//      SERVICE, not here: getTaskDetailService and getTaskAttachmentsService
//      would each need a write-shaped refusal (the same "no longer
//      available" sentence the mutations use) before an action could expose
//      them, because notFound() thrown inside an action propagates through
//      unstable_rethrow and replaces the board with the not-found page.
//      Wrapping them as they stand would make a card somebody else deleted
//      look like a broken app. Reported rather than done, because an action
//      that caught notFound() to soften it would be deciding something.
// -------------------------------------------------------------------
