"use server";

import { requireUser } from "@/lib/auth/session-auth-server";
import { handleServerApiError } from "@/lib/handle-errors";
import { validateRequest } from "@/lib/server-requests";
import { ServerApiResponse } from "@/lib/types";

import {
  createTaskService,
  deleteTaskAttachmentService,
  deleteTaskService,
  getTaskDetailForPanelService,
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
  TaskIdRequestDTO,
  TaskIdSchema,
  UpdateTaskRequestDTO,
  UpdateTaskSchema,
  type TaskDetailDTO,
} from "./delivery.types";

// -------------------------------------------------------------------
// Board actions: the four things somebody does to a card, and the one
// thing they do to a file on it.
//
// SIX, AND THE ARITHMETIC IS WORTH WRITING DOWN so the gaps do not read as
// oversights.
//
//   FOUR CARD MUTATIONS are here: create, edit, move, delete.
//
//   ONE ATTACHMENT MUTATION IS HERE: the delete. The OTHER one, the upload,
//   is never getting an action - see the closing note, which is where that
//   argument lives rather than being repeated here.
//
//   ONE READ IS HERE, AND IT IS THE ONLY ONE: the task panel, which opens
//   over a board already on screen and therefore has to fetch. It is served
//   by getTaskDetailForPanelService rather than getTaskDetailService, and
//   the two differ ONLY in how they refuse - which is the whole reason the
//   pair exists. See the note on the action itself.
//
//   THE OTHER THREE READS ARE STILL NOT HERE. The board, this person's work
//   list and a task's attachment list are what a SERVER COMPONENT renders,
//   and each answers a scope miss with notFound() - a page's answer, and the
//   right one when the URL itself named the thing.
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
// ONE TASK, OPENED ON A BOARD THAT IS ALREADY ON SCREEN.
//
// THE ONLY READ IN THIS FILE, and it earns that by being the only one with
// no page behind it. The panel opens over the client-side board, so the
// description, the files, the time logged and the estimate history cannot
// come from the board read - a hundred cards carrying all four would be a
// megabyte on every render - and there is no navigation for a server
// component to hang off.
//
// IT CALLS getTaskDetailForPanelService, NOT getTaskDetailService, and the
// difference is the only reason both exist. The page version answers a miss
// with notFound(), which is correct when a URL named the task and fatal
// here: notFound() thrown inside a server action is propagated by
// unstable_rethrow and REPLACES THE PAGE, so a card a lead deleted a second
// ago would take the whole board away and read as a broken app. The panel
// version refuses in words, like a mutation, and the board survives it.
//
// The refusal is IDENTICAL for "deleted" and "not on that project", which is
// the service's doing rather than this file's. Two sentences would let
// somebody walk task ids and learn which are real.
// -------------------------------------------------------------------
export async function getTaskDetailAction(
  requestDTO: TaskIdRequestDTO,
): Promise<ServerApiResponse<TaskDetailDTO>> {
  try {
    await requireUser();

    const validatedRequest = await validateRequest(TaskIdSchema, requestDTO);
    if (!validatedRequest.success) return validatedRequest.response;

    const detail = await getTaskDetailForPanelService(validatedRequest.data.taskId);

    return { success: true, data: detail } satisfies ServerApiResponse<TaskDetailDTO>;
  } catch (error) {
    return handleServerApiError("getTaskDetailAction", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// WHAT IS NOT HERE, AND WHY
// ===================================================================
//
//   1. AN UPLOAD ACTION. DELIBERATELY NEVER ONE, and this is the gap on
//      the list that is not waiting for anything.
//
//      The bytes cannot travel through an action: serverActions
//      .bodySizeLimit is GLOBAL and defaults to 1 MB, so raising it to clear
//      a scope document would weaken every action in the app. So the upload
//      is a ROUTE HANDLER - POST /api/delivery/task-attachments - the same
//      exception AI chat's upload already is, and for the same one reason.
//
//      That route validates UploadTaskAttachmentSchema (a task id and a file
//      name, and nothing that describes the bytes) and hands the bytes
//      straight to uploadTaskAttachmentService. It does NOT sniff, key,
//      write or authorise: those are the service's, which is what keeps the
//      storage key builder in one place and lets an archived project be
//      refused BEFORE the file lands rather than never.
//
//   2. AN ATTACHMENT DOWNLOAD ACTION, for the plainer reason that an action
//      cannot return bytes. GET /api/delivery/task-attachments/[id] streams
//      one back, authorised by the service, and it is a READ - so the
//      mutations-go-through-actions rule never applied to it.
//
//   3. NO OTHER READ ACTIONS. The board and the work list are pages keyed on
//      their own routes, and both answer notFound() on a miss - the
//      enumeration answer a page owes a guessed id. Only the panel fetches
//      on demand, and only the panel has an action.
//
//      getTaskAttachmentsService is the one that looks like it should have
//      followed the panel here and did not: the panel's own read already
//      carries the attachment list, so an action for it would be a second
//      round trip for something the caller has in hand. It stays a page
//      read, with a page's refusal.
// -------------------------------------------------------------------
