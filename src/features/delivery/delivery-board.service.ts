import "server-only";

import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth/session-auth-server";
import type { SessionUser } from "@/lib/auth/auth.types";
import {
  PROJECT_STATUSES,
  TASK_COLUMN_LABELS,
  TASK_COLUMN_ORDER,
  TASK_COLUMNS,
  USER_ROLES,
  type ProjectStatus,
  type Task,
  type TaskColumn,
} from "@/lib/data/kysely-database-types";
import { getPhaseRepo, getPhasesForProjectRepo } from "@/lib/data/repositories/phases.repository";
import {
  getProjectByIdRepo,
  getProjectForMemberRepo,
  getProjectMemberRepo,
} from "@/lib/data/repositories/projects.repository";
import {
  addTaskAttachmentRepo,
  addTaskRepo,
  deleteTaskAttachmentRepo,
  deleteTaskReturningBlobKeysRepo,
  getAttachmentCountsForProjectRepo,
  getProjectBoardTasksRepo,
  getTaskAttachmentRepo,
  getTaskAttachmentsRepo,
  getTaskRepo,
  getTasksAssignedToUserRepo,
  getTasksByIdsRepo,
  moveTaskRepo,
  updateTaskRepo,
  type TaskAttachmentMeta,
  type TaskBoardRow,
} from "@/lib/data/repositories/tasks.repository";
import {
  getEstimateChangesForTaskRepo,
  getLoggedMinutesByTaskRepo,
  getTimeEntriesForTaskRepo,
  type EstimateChangeEntry,
  type TaskTimeEntry,
} from "@/lib/data/repositories/time-entries.repository";
import { getUsersByIdsRepo } from "@/lib/data/repositories/users.repository";
import { DisplayErrorMessage } from "@/lib/errors";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import {
  deleteTaskAttachmentBlob,
  isTaskAttachmentStorageConfigured,
  taskAttachmentStorageKey,
} from "@/lib/storage/task-attachment-storage";
import { userDisplayName } from "@/lib/user-display-name";

import {
  ATTACHMENT_NAME_MAX_CHARS,
  budgetProgress,
  canEditProjectTasks,
  type BoardColumnDTO,
  type BoardDTO,
  type BoardPhaseDTO,
  type CreateTaskRequestDTO,
  type DeleteTaskRequestDTO,
  type EstimateChangeDTO,
  type MoveTaskRequestDTO,
  type MyWorkItemDTO,
  type TaskAttachmentDTO,
  type TaskAttachmentUpload,
  type TaskCardDTO,
  type TaskDetailDTO,
  type TimeEntryDTO,
  type UpdateTaskRequestDTO,
} from "./delivery.types";

// -------------------------------------------------------------------
// The board, and everything on a task
//
// THE ACCESS MODEL, WHICH IS TWO GATES AND NOT ONE.
//
//   `project_members` is the boundary. A non-admin sees a project, its
//   board and its tasks only if they hold a membership row, and
//   getProjectForMemberRepo is the read that ANSWERS that rather than a
//   check run beside a read that did not need it. It hands back `isLead`
//   from the same join, so one query both authorises and says what the
//   caller may do.
//
//   `is_lead` is the second gate. A lead (or an admin) creates, edits,
//   moves and deletes a card; an ordinary member logs time against cards
//   that already exist. That is why `canEditTasks` travels on every DTO -
//   resolved once per request, rather than a component deriving it from
//   `isLead` plus a role and getting an admin wrong. THE RULE ITSELF IS
//   canEditProjectTasks IN delivery.types.ts and is imported, not restated:
//   it was written out by hand in three services, which is how a screen
//   comes to offer a member a button the server refuses.
//
//   An admin is not a member and does not need to be. Every helper below
//   branches on the role FIRST, so an admin never fails a membership test
//   for a project nobody has staffed yet.
//
// THE SESSION IS RESOLVED BEFORE ANY ROW IS READ. Several writes here hold
// a task or an attachment id and have to load the row to find out which
// project authorises it, so the row read cannot move after the project
// check - but it can and does come after requireUser. An unauthenticated
// caller therefore never reaches a query at all, which keeps a signed-out
// request from being a way to time the existence of an id. The order is
// SESSION, then row, then the row's project.
//
// AN ARCHIVED PROJECT TAKES NO NEW STRUCTURE, the same refusal
// delivery-time.service.ts makes for an hour logged against one. See
// requireUnarchivedProject below: a lead building cards nobody can ever
// log time against is the contradiction that rule exists to close.
//
// A SCOPE FAILURE ON A PAGE ANSWERS notFound(). Replying "forbidden" to a
// guessed project or task id confirms the record exists and turns the
// route into an enumeration oracle. THE WRITE PATHS answer a sentence
// instead - an action returns JSON to a fetch, and a 404 mid-drag replaces
// the board with an error page - but it is the SAME sentence for "gone" and
// for "not yours", so it leaks exactly as little.
//
// ONE READ PER SCREEN, NOT ONE PER CARD. The board is the screen people
// leave open all day: it is four queries whatever the project's size (the
// cards, the phases, the logged minutes per card, the attachment counts per
// card), and the two "counts" reads are grouped in SQL. Anything added here
// that reads per card is a round trip per card.
//
// NO MONEY ANYWHERE IN THIS FILE. A card, a task panel and a work list are
// effort, not price. The rate snapshots on a time entry are not selected by
// the reads used here (see TimeEntryWithoutRates), and the DTOs have nowhere
// to put one - the budget report is the only surface that carries cents and
// it is gated on its own.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// The feature is mounted in all three areas and a board sits under a
// dynamic segment of each (.../projects/[projectId]), so a write refreshes
// the SUBTREE rather than the literal path. revalidatePath with a plain
// string clears that one entry only, which would leave the board somebody
// just dragged a card on serving the copy it rendered before the drag.
//
// All three, because which area the caller is looking at is not knowable
// here - and a lead who works in /manage and an admin reviewing the same
// project in /admin must not see two different boards.
// -------------------------------------------------------------------
function revalidateBoardViews(): void {
  revalidatePath(ROUTES.ADMIN_PROJECTS, "layout");
  revalidatePath(ROUTES.MANAGE_PROJECTS, "layout");
  revalidatePath(ROUTES.PORTAL_PROJECTS, "layout");
}

// -------------------------------------------------------------------
// Said in one place so the two cases it covers cannot drift apart: a task
// that has been deleted, and a task in a project the caller is not on. The
// answer has to be identical, or the difference between the two messages
// tells somebody which ids exist.
// -------------------------------------------------------------------
const TASK_UNAVAILABLE_MESSAGE = "That task is no longer available.";

const PROJECT_UNAVAILABLE_MESSAGE = "That project is no longer available.";

// A ROLE-ish refusal rather than a scope one, so it may say what it means:
// the caller has already proved they are on the project, and learning that
// editing needs a lead tells them nothing they could not read off the
// screen.
const NOT_A_LEAD_MESSAGE =
  "Only a project lead or an admin can add, change, move or delete a task on this project.";

// -------------------------------------------------------------------
// Who is asking, about which project, and what they may do to it.
// -------------------------------------------------------------------
type ProjectAccess = {
  user: SessionUser;
  projectId: string;
  projectTitle: string;
  /** Carried so a write can refuse an archived project. */
  status: ProjectStatus;
  /** True for an admin, or for a member whose `is_lead` is set. */
  canEditTasks: boolean;
};

// -------------------------------------------------------------------
// Resolve the caller's access to one project, or null.
//
// Null covers BOTH "no such project" and "not a member of it", and nothing
// downstream may tell them apart. The role branch comes first because an
// admin has no membership row to find and must not be refused for it.
//
// THE SESSION USER IS A PARAMETER, not resolved here. Callers holding a task
// or an attachment id have to read that row before they know which project
// to ask about, and requireUser has to have run before the read - so the
// session is resolved at the top of each entry point and handed down. A
// helper that called requireUser itself would put the authentication check
// after a query in every one of those paths, which is the order this file
// used to have.
//
// THE PROJECT ID IS THE ONLY THING TAKEN FROM THE REQUEST. The actor is the
// session user, always: an id in a DTO is a claim, not evidence.
// -------------------------------------------------------------------
async function resolveProjectAccess(user: SessionUser, projectId: string): Promise<ProjectAccess | null> {
  if (user.role === USER_ROLES.ADMIN) {
    const project = await getProjectByIdRepo(projectId);

    if (!project) return null;

    return {
      user,
      projectId: project.id,
      projectTitle: project.title,
      status: project.status,
      // An admin is not a lead and still edits. The rule is imported so this
      // and the branch below cannot answer differently.
      canEditTasks: canEditProjectTasks(user.role, false),
    };
  }

  const project = await getProjectForMemberRepo(projectId, user.id);

  if (!project) return null;

  return {
    user,
    projectId: project.id,
    projectTitle: project.title,
    status: project.status,
    // `isLead` comes straight off the membership row the authorising join
    // already read, so the second gate costs no extra query.
    canEditTasks: canEditProjectTasks(user.role, project.isLead),
  };
}

/** For a page render: out of scope is answered exactly as a missing id is. */
async function requireProjectAccessForPage(user: SessionUser, projectId: string): Promise<ProjectAccess> {
  const access = await resolveProjectAccess(user, projectId);

  if (!access) notFound();

  return access;
}

/** For a mutation: a sentence rather than a 404, identical for both cases. */
async function requireProjectAccessForWrite(user: SessionUser, projectId: string): Promise<ProjectAccess> {
  const access = await resolveProjectAccess(user, projectId);

  if (!access) {
    throw new DisplayErrorMessage(PROJECT_UNAVAILABLE_MESSAGE);
  }

  return access;
}

// -------------------------------------------------------------------
// An archived project takes no new structure.
//
// THE SAME REFUSAL delivery-time.service.ts MAKES, in the same words, and it
// is here because the two were contradicting each other: that service
// refuses to log an hour against an archived project, while this one would
// happily let a lead create, rename and re-order cards on it - so the board
// could grow work that nobody can ever log a minute against, on a project
// that is out of the nav, out of the pickers and out of every list anybody
// reads.
//
// APPLIED TO CREATE, EDIT AND MOVE. Deliberately NOT to deleting a card, and
// that is the same line the time service draws: it refuses the writes that
// put something new on the record and allows the ones that correct it.
// Refusing a delete would trap a card somebody created by mistake on an
// archived project with no way to remove it, which is the opposite of what
// this rule is for - and the delete is already refused outright once any
// time is logged, so nothing billable can go this way.
//
// `on_hold` and `completed` pass. Finishing off the board for a project
// somebody marked completed on Friday is the ordinary case; archiving is the
// module's soft delete and is the only status that means "done with".
// -------------------------------------------------------------------
function requireUnarchivedProject(access: ProjectAccess, act: string): void {
  if (access.status !== PROJECT_STATUSES.ARCHIVED) return;

  throw new DisplayErrorMessage(
    `This project has been archived, so ${act} is no longer possible. An administrator can make it active again first.`,
  );
}

// -------------------------------------------------------------------
// The task a write is about, once the caller has been proved a lead on the
// project it belongs to.
//
// getTaskRepo is UNSCOPED by necessity - the caller holds a task id and the
// project that authorises it is on the row - so the order here is
// load-bearing: prove there is a SESSION, read the row, authorise on ITS
// project id, and only then let anything happen. Nothing about the task is
// returned to a caller who fails any of the three, and a signed-out caller
// never reaches the read.
// -------------------------------------------------------------------
async function requireEditableTask(taskId: string): Promise<{ task: Task; access: ProjectAccess }> {
  const user = await requireUser();

  const task = await getTaskRepo(taskId);

  if (!task) {
    throw new DisplayErrorMessage(TASK_UNAVAILABLE_MESSAGE);
  }

  const access = await requireProjectAccessForWrite(user, task.projectId);

  if (!access.canEditTasks) {
    throw new DisplayErrorMessage(NOT_A_LEAD_MESSAGE);
  }

  return { task, access };
}

// -------------------------------------------------------------------
// An assignee has to be on the project.
//
// Nothing in the database says so - `assignee_id` is a plain reference to
// users - and assigning work to somebody who cannot open the project is a
// silent dead end: the card would sit on a board they cannot reach, and
// "my work" joins project_members so it would never appear on their list
// either. Null is the ordinary case (a card nobody has picked up yet) and
// is not a failure.
// -------------------------------------------------------------------
async function requireProjectMemberAssignee(projectId: string, assigneeId: string | null): Promise<void> {
  if (!assigneeId) return;

  const member = await getProjectMemberRepo(projectId, assigneeId);

  if (!member) {
    throw new DisplayErrorMessage(
      "That person is not on this project, so a task cannot be assigned to them. Add them to the project first.",
    );
  }
}

// -------------------------------------------------------------------
// The cards already sitting where one is about to be created or dropped,
// in board order.
//
// It reads the WHOLE board to look at one column, which is deliberate but
// not free: the alternative is a targeted read this repository does not
// have (see the note at the bottom of this file). It is still ONE query for
// an interaction people repeat all day, against a project's worth of narrow
// rows, and the board read is the query this feature is built around.
// -------------------------------------------------------------------
async function columnCards(projectId: string, phaseId: string, column: TaskColumn): Promise<TaskBoardRow[]> {
  const tasks = await getProjectBoardTasksRepo(projectId);

  // Already ordered by position then id inside a column by the read itself,
  // so no sorting happens here - two places deciding board order is how a
  // board and a report come to disagree.
  return tasks.filter((task) => task.phaseId === phaseId && task.boardColumn === column);
}

// -------------------------------------------------------------------
// The destination column's whole ordered id list, with the moved card at
// the slot it was dropped in.
//
// EXPORTED AND TESTED DIRECTLY, because every interesting case here is a
// boundary: a card dropped below the last one, a stale position from a
// board that has since changed, and a card dragged within its own column -
// where removing it before inserting is what stops it landing one slot
// short of where it was let go.
//
// The position is CLAMPED rather than refused. It is an index into a list
// the browser last saw some milliseconds ago; a drop past the end of a
// column somebody else has just emptied means "last", and refusing it would
// undo a drag for a reason nobody could act on.
// -------------------------------------------------------------------
export function placeIdAtPosition(
  orderedIds: readonly string[],
  taskId: string,
  position: number,
): string[] {
  const without = orderedIds.filter((id) => id !== taskId);
  const index = Math.min(Math.max(0, Math.trunc(position)), without.length);

  return [...without.slice(0, index), taskId, ...without.slice(index)];
}

// -------------------------------------------------------------------
// Mappers. Every one of them is total: a card, an attachment or an entry
// that reached here has already been authorised, and nothing is filtered
// out at this point.
// -------------------------------------------------------------------
function mapTaskCard(row: TaskBoardRow, loggedMinutes: number, attachmentCount: number): TaskCardDTO {
  return {
    id: row.id,
    phaseId: row.phaseId,
    title: row.title,
    boardColumn: row.boardColumn,
    position: row.position,
    estimateMinutes: row.estimateMinutes,
    loggedMinutes,
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    attachmentCount,
  };
}

function mapTimeEntry(entry: TaskTimeEntry): TimeEntryDTO {
  return {
    id: entry.id,
    taskId: entry.taskId,
    userId: entry.userId,
    userName: entry.userName,
    // A DATE column, so this is already 'YYYY-MM-DD'. Never turn it into a
    // Date on the way past.
    workDate: entry.workDate,
    minutes: entry.minutes,
    notes: entry.notes,
    createdAt: entry.createdAt,
  };
}

// -------------------------------------------------------------------
// One line of the estimate log, FROM THE POINT OF VIEW OF THE TASK BEING
// LOOKED AT.
//
// THE NEGATION IS THE WHOLE JOB. A transfer writes one row keyed to the
// RECEIVER, with `minutes` positive because it describes the receiver, and
// the history read matches either end of it - so the source task is handed
// a positive number for minutes that LEFT it. Rendering that as stored puts
// "+2h" under a task whose estimate just went down, which is the
// plausible-but-wrong figure `direction` was added to prevent.
//
// Negating here rather than in the component is the same rule the rest of
// this module follows: the arithmetic is finished before anything renders.
// A surface that had to consult `direction` before printing a number is a
// surface that can forget to.
//
// Exported so a test can assert both sides of one row without a database.
// -------------------------------------------------------------------
export function mapEstimateChange(row: EstimateChangeEntry): EstimateChangeDTO {
  return {
    id: row.id,
    minutes: row.direction === "out" ? -row.minutes : row.minutes,
    reason: row.reason,
    changedByName: row.changedByName,
    createdAt: row.createdAt,
    direction: row.direction,
    // The far end of the row: the task these minutes came from, or the one
    // they went to. Null on a plain adjustment, and null when the other task
    // has since been deleted - `from_task_id` is ON DELETE SET NULL, and a
    // line with less to say still belongs in the record.
    counterpartTaskId: row.counterpartTaskId,
    counterpartTaskTitle: row.counterpartTaskTitle,
  };
}

// -------------------------------------------------------------------
// THE BOARD. Phases in order, each holding all four columns, each column
// holding its cards in position order.
//
// FOUR QUERIES, FIXED. The cards and the phases are read separately because
// a phase with no tasks still has to appear: an empty column is a drop
// target, and a board assembled only from the cards it has would have
// nowhere to put the first one that ever gets blocked. The two count reads
// are grouped in SQL and come back missing the cards that have none, which
// is why both default through a Map lookup rather than being assumed
// present.
//
// ALL FOUR COLUMNS, ALWAYS, in TASK_COLUMN_ORDER - the order the enum is
// declared in, so the board, a report and the database all agree on what
// "first" means.
// -------------------------------------------------------------------
export async function getProjectBoardService(projectId: string): Promise<BoardDTO> {
  try {
    const user = await requireUser();
    const access = await requireProjectAccessForPage(user, projectId);

    // In parallel and only AFTER the guard: four reads that each carry the
    // project id the guard just proved.
    const [phases, tasks, loggedMinutes, attachmentCounts] = await Promise.all([
      getPhasesForProjectRepo(access.projectId),
      getProjectBoardTasksRepo(access.projectId),
      getLoggedMinutesByTaskRepo(access.projectId),
      getAttachmentCountsForProjectRepo(access.projectId),
    ]);

    const loggedByTask = new Map(loggedMinutes.map((row) => [row.taskId, row.minutes]));
    const attachmentsByTask = new Map(attachmentCounts.map((row) => [row.taskId, row.attachmentCount]));

    // One pass over the cards, keyed by phase and column, so assembling the
    // board is not a scan of every card per column - which for a project
    // with four phases would be sixteen passes over the same array.
    const cardsByPhaseColumn = new Map<string, TaskCardDTO[]>();

    for (const task of tasks) {
      const key = `${task.phaseId}:${task.boardColumn}`;
      const card = mapTaskCard(task, loggedByTask.get(task.id) ?? 0, attachmentsByTask.get(task.id) ?? 0);
      const existing = cardsByPhaseColumn.get(key);

      if (existing) {
        existing.push(card);
      } else {
        cardsByPhaseColumn.set(key, [card]);
      }
    }

    const boardPhases: BoardPhaseDTO[] = phases.map((phase) => {
      const columns: BoardColumnDTO[] = TASK_COLUMN_ORDER.map((column) => ({
        column,
        tasks: cardsByPhaseColumn.get(`${phase.id}:${column}`) ?? [],
      }));

      return { phaseId: phase.id, phaseName: phase.name, position: phase.position, columns };
    });

    return { projectId: access.projectId, canEditTasks: access.canEditTasks, phases: boardPhases };
  } catch (error) {
    throw handleError("getProjectBoardService", error);
  }
}

// -------------------------------------------------------------------
// ONE TASK, OPENED: the card, its files, its time and its estimate
// history.
//
// The task is read through getTasksByIdsRepo rather than getTaskRepo, for
// one card, because that read already carries the four things the panel
// heads itself with - the phase name, the project title, the client and the
// assignee's name - and getTaskRepo carries none of them. It is unscoped
// like every by-id read in that repository, and returns `projectId` for
// exactly the reason used here: authorise on the row's own project before
// showing a single field of it.
//
// THE LOGGED TOTAL IS SUMMED FROM THE ENTRIES ALREADY LOADED. The panel
// shows every entry on the task, so the figure in the bar is the sum of the
// lines underneath it - which is the property somebody reconciling a task
// needs, and it costs no second query. The grouped per-task read exists for
// the board, where the entries themselves are not loaded.
// -------------------------------------------------------------------
export async function getTaskDetailService(taskId: string): Promise<TaskDetailDTO> {
  try {
    // Session first, then the row, then the row's project. The read cannot
    // move after the project check - the row is what names the project - but
    // it can come after requireUser, and it must.
    const user = await requireUser();

    const [row] = await getTasksByIdsRepo([taskId]);

    if (!row) notFound();

    const access = await requireProjectAccessForPage(user, row.projectId);

    const [attachments, timeEntries, estimateHistory] = await Promise.all([
      getTaskAttachmentsRepo(row.id),
      getTimeEntriesForTaskRepo(row.id),
      getEstimateChangesForTaskRepo(row.id),
    ]);

    const loggedMinutes = timeEntries.reduce((total, entry) => total + entry.minutes, 0);

    return {
      task: mapTaskCard(row, loggedMinutes, attachments.length),
      projectId: row.projectId,
      projectTitle: row.projectTitle,
      phaseName: row.phaseName,
      description: row.description,
      attachments: await mapAttachments(attachments),
      timeEntries: timeEntries.map(mapTimeEntry),
      estimateHistory: estimateHistory.map(mapEstimateChange),
      // Estimate against logged. A task with no estimate comes back with a
      // null percentage rather than a full bar - nobody has said what this
      // one was meant to take, and painting it red for that blames the
      // person who did the work.
      rollup: budgetProgress(row.estimateMinutes, loggedMinutes),
      canEditTasks: access.canEditTasks,
    };
  } catch (error) {
    throw handleError("getTaskDetailService", error);
  }
}

// -------------------------------------------------------------------
// CREATE A CARD. Lead or admin.
//
// The phase decides the project: the client sends `phaseId` and nothing
// else about where this lands, so there is no second claim about the same
// fact for the two to disagree on. The composite foreign key on
// (phase_id, project_id) would catch a mismatch anyway; reading the phase
// first is what lets the caller be authorised against the project the phase
// is actually in.
//
// `estimateHours` HOLDS MINUTES by the time it arrives. The schema
// converts at the boundary and keeps the field name a form would use, so
// this is the one line in the file where the two units are next to each
// other - see the note at the top of delivery.types.ts.
//
// NO ESTIMATE LOG ROW. The first figure is the estimate; `estimate_changes`
// records how it CHANGED after that, and an opening entry saying "created
// with 8 hours" would make the log stop summing to the difference between
// the original estimate and the current one.
// -------------------------------------------------------------------
export async function createTaskService(requestDTO: CreateTaskRequestDTO): Promise<string> {
  try {
    // Session before the phase read: the phase is what names the project to
    // authorise against, so the read stays ahead of the project check, but a
    // caller with no session never gets that far.
    const user = await requireUser();

    const phase = await getPhaseRepo(requestDTO.phaseId);

    // A phase id from the browser naming a project the caller is not on gets
    // the same answer as one that does not exist.
    if (!phase) {
      throw new DisplayErrorMessage("That phase is no longer available.");
    }

    const access = await requireProjectAccessForWrite(user, phase.projectId);

    if (!access.canEditTasks) {
      throw new DisplayErrorMessage(NOT_A_LEAD_MESSAGE);
    }

    requireUnarchivedProject(access, "adding a task to it");

    const assigneeId = requestDTO.assigneeId ?? null;

    await requireProjectMemberAssignee(access.projectId, assigneeId);

    // APPENDED to the column, not inserted at the top. `position` defaults
    // to 0 in the database, so leaving it out would pile every new card onto
    // the same slot and leave the id tiebreak to decide where each one
    // appears - which reads as a card landing in an arbitrary place.
    const siblings = await columnCards(access.projectId, phase.id, requestDTO.boardColumn);
    const position = siblings.length === 0 ? 0 : Math.max(...siblings.map((card) => card.position)) + 1;

    const now = new Date();

    const created = await addTaskRepo({
      id: generateId(),
      phaseId: phase.id,
      projectId: access.projectId,
      title: requestDTO.title,
      description: requestDTO.description,
      // Minutes. See the note above.
      estimateMinutes: requestDTO.estimateHours,
      boardColumn: requestDTO.boardColumn,
      position,
      assigneeId,
      // From the SESSION, never from the request.
      createdBy: access.user.id,
      createdAt: now,
      updatedAt: now,
    });

    revalidateBoardViews();

    // The id rather than a card: the board re-renders from the revalidation
    // above, and what the caller needs is the handle to open what it just
    // made. Building a DTO here would need the assignee's name looked up
    // again for a card that is about to be re-read anyway.
    return created.id;
  } catch (error) {
    throw handleError("createTaskService", error);
  }
}

// -------------------------------------------------------------------
// EDIT A CARD's title, description and assignee. Lead or admin.
//
// NO ESTIMATE FIELD, and no board column either. An estimate change belongs
// in the append-only log, and moving a card renumbers its siblings - both
// are their own mutation, and the repository strips both columns out of a
// patch as a backstop.
// -------------------------------------------------------------------
export async function updateTaskService(requestDTO: UpdateTaskRequestDTO): Promise<void> {
  try {
    const { access } = await requireEditableTask(requestDTO.taskId);

    requireUnarchivedProject(access, "changing a task on it");

    // Null clears the assignment, which is a legitimate edit and is
    // distinguished from "unchanged" by the schema making the field
    // required.
    await requireProjectMemberAssignee(access.projectId, requestDTO.assigneeId);

    const updated = await updateTaskRepo(requestDTO.taskId, access.projectId, {
      title: requestDTO.title,
      description: requestDTO.description,
      assigneeId: requestDTO.assigneeId,
    });

    // The project predicate matched nothing, so the task moved or went
    // between the guard and the write. Same sentence as everywhere else.
    if (!updated) {
      throw new DisplayErrorMessage(TASK_UNAVAILABLE_MESSAGE);
    }

    revalidateBoardViews();
  } catch (error) {
    throw handleError("updateTaskService", error);
  }
}

// -------------------------------------------------------------------
// MOVE A CARD: phase, column and slot, in one write. Lead or admin.
//
// THE DESTINATION COLUMN'S WHOLE ORDERED LIST GOES DOWN, not a position.
// Plain integer positions mean a drop renumbers every sibling, and the
// repository does that in one statement inside a transaction - but only if
// it is handed the finished order. Working it out here is what makes the
// move idempotent: replaying the same list produces the same board, where
// "insert at 3" has to be re-interpreted against whatever the server now
// holds and two people dragging at once resolve it differently.
//
// THE DESTINATION PHASE MUST BE IN THE SAME PROJECT. The composite foreign
// key would refuse a cross-project move, and the repository's own predicate
// would match nothing - but a phase id naming another client's project is a
// scope failure, and it gets the answer a missing id gets rather than a
// constraint error.
// -------------------------------------------------------------------
export async function moveTaskService(requestDTO: MoveTaskRequestDTO): Promise<void> {
  try {
    const { task, access } = await requireEditableTask(requestDTO.taskId);

    requireUnarchivedProject(access, "moving a task on it");

    const phase = await getPhaseRepo(requestDTO.phaseId);

    if (!phase || phase.projectId !== access.projectId) {
      throw new DisplayErrorMessage("That phase is no longer available.");
    }

    const siblings = await columnCards(access.projectId, phase.id, requestDTO.boardColumn);

    // The moved card is included in the list it is being renumbered by -
    // the repository requires it, and it is what makes the card pick up its
    // own new position. Dragging within one column is exactly the case that
    // needs it removed before it is re-inserted.
    const orderedTaskIds = placeIdAtPosition(
      siblings.map((card) => card.id),
      task.id,
      requestDTO.position,
    );

    const moved = await moveTaskRepo({
      taskId: task.id,
      projectId: access.projectId,
      phaseId: phase.id,
      boardColumn: requestDTO.boardColumn,
      orderedTaskIds,
    });

    if (!moved) {
      throw new DisplayErrorMessage(TASK_UNAVAILABLE_MESSAGE);
    }

    revalidateBoardViews();
  } catch (error) {
    throw handleError("moveTaskService", error);
  }
}

// -------------------------------------------------------------------
// DELETE A CARD. Lead or admin, and refused if any time is logged.
//
// TIME LOGGED IS A POLITE REFUSAL, NOT A CONSTRAINT ERROR. `time_entries`
// holds a task ON DELETE RESTRICT precisely because billing history must
// survive somebody tidying a board, so the database will refuse this - but
// what it hands back is a constraint violation. Asked here, and first,
// somebody gets a sentence and an alternative.
//
// THE BLOBS ARE CLEARED AFTER THE ROWS, WHICH IS THE OPPOSITE OF EVERY
// OTHER DELETE PATH IN THIS APP, and the repository's comment says why: a
// delete that can be REFUSED must not have already destroyed the files, or
// a live task is left with attachments whose bytes have gone and no way
// back. So the rows go first, inside a transaction, and the keys come back
// for clearing afterwards. A Postgres cascade cannot delete an Azure blob;
// the reconciliation sweep is the backstop for a crash in between, not the
// plan. src/lib/storage/task-attachment-storage.ts carries the blob-first
// rule for this prefix and names THIS path as its one documented inversion,
// so the two files agree about the exception rather than one of them being
// the place it was forgotten.
// -------------------------------------------------------------------
export async function deleteTaskService(requestDTO: DeleteTaskRequestDTO): Promise<void> {
  try {
    const { task, access } = await requireEditableTask(requestDTO.taskId);

    const timeEntries = await getTimeEntriesForTaskRepo(task.id);

    if (timeEntries.length > 0) {
      throw new DisplayErrorMessage(
        `That task has time logged against it, so it cannot be deleted. Move it to ${TASK_COLUMN_LABELS[TASK_COLUMNS.DONE]} instead.`,
      );
    }

    const result = await deleteTaskReturningBlobKeysRepo(task.id, access.projectId);

    if (!result.deleted) {
      throw new DisplayErrorMessage(TASK_UNAVAILABLE_MESSAGE);
    }

    await clearAttachmentBlobs(result.storageKeysToClear);

    revalidateBoardViews();
  } catch (error) {
    throw handleError("deleteTaskService", error);
  }
}

// -------------------------------------------------------------------
// Clear blobs whose rows have already gone.
//
// BEST EFFORT ON PURPOSE. The transaction has committed by the time this
// runs, so a failure here cannot be reported as "the task was not deleted"
// - it was. What is left is an unreferenced file, which the monthly
// reconciliation sweep collects by diffing listAllTaskAttachmentKeys against
// getAllTaskAttachmentKeysRepo. Logging it and carrying on is the
// recoverable failure this design chose; throwing would tell somebody their
// task is still there when it is not.
//
// If that sweep is steadily clearing files, a delete path is missing its
// cleanup - it is a signal, not a garbage collector to lean on. THE SWEEP
// ITSELF IS NOT WIRED UP YET (see the closing list), so today a file lost
// here is paid for indefinitely and nothing says so - one more reason this
// is the only path in the file where the bytes go after the rows.
// -------------------------------------------------------------------
async function clearAttachmentBlobs(storageKeys: string[]): Promise<void> {
  if (storageKeys.length === 0) return;

  if (!isTaskAttachmentStorageConfigured()) {
    console.error(
      `[clearAttachmentBlobs] storage is not configured, so ${storageKeys.length} blob(s) were left behind`,
    );

    return;
  }

  for (const key of storageKeys) {
    try {
      await deleteTaskAttachmentBlob(key);
    } catch (error) {
      console.error(`[clearAttachmentBlobs] could not clear ${key}`, error);
    }
  }
}

// -------------------------------------------------------------------
// "MY WORK": the cards assigned to the signed-in person, across projects.
//
// THE ACTOR IS THE SESSION, and there is no parameter for whose work to
// show - a lead reviewing somebody else's list is a different screen with a
// different guard, and an optional user id here would be the whole
// authorization model in one argument.
//
// The repository read joins `project_members` as well as matching the
// assignee, and that join is NOT redundant with the check this service
// does: nothing clears `assignee_id` when the underlying membership row is
// removed by a path added later, and the row carries the phase, the project
// and the CLIENT name - four facts a former member could reach no other
// way. A predicate at the point of access is the only defence that does not
// depend on every writer remembering. It stays.
//
// TWO FILTERS, BOTH THIS SERVICE'S DECISION RATHER THAN THE READ'S:
//
//   `done` is left out. A work list is what remains.
//
//   Only ARCHIVED projects are excluded. Archiving is the module's soft
//   delete; "completed" is a judgement somebody made about a project that
//   may still have open cards on it, and hiding those is how work goes
//   missing.
//
// MyWorkItemDTO lives in delivery.types.ts, not here: a client component
// renders this list, and importing a type out of a `server-only` module
// drags the module in with it.
// -------------------------------------------------------------------
const MY_WORK_STATUSES = [
  PROJECT_STATUSES.ACTIVE,
  PROJECT_STATUSES.ON_HOLD,
  PROJECT_STATUSES.COMPLETED,
] as const;

const MY_WORK_COLUMNS = [TASK_COLUMNS.TODO, TASK_COLUMNS.IN_PROGRESS, TASK_COLUMNS.BLOCKED] as const;

export async function getMyWorkService(): Promise<MyWorkItemDTO[]> {
  try {
    const user = await requireUser();

    const tasks = await getTasksAssignedToUserRepo(user.id, {
      projectStatuses: MY_WORK_STATUSES,
      boardColumns: MY_WORK_COLUMNS,
    });

    if (tasks.length === 0) return [];

    // ONE READ PER DISTINCT PROJECT, in parallel - not one per card. There
    // is no read that totals logged minutes for a SET of task ids across
    // projects (reported as a gap), and the two alternatives were worse:
    // a query per card is the N+1 this module refuses everywhere else, and
    // dropping the figure leaves a work list that cannot say how much of an
    // estimate is already spent. Somebody is on a handful of projects, so
    // this is a handful of grouped queries.
    const projectIds = [...new Set(tasks.map((task) => task.projectId))];

    const loggedByProject = await Promise.all(
      projectIds.map((projectId) => getLoggedMinutesByTaskRepo(projectId)),
    );

    const loggedByTask = new Map(loggedByProject.flat().map((row) => [row.taskId, row.minutes]));

    return tasks.map((task) => ({
      taskId: task.id,
      title: task.title,
      boardColumn: task.boardColumn,
      phaseName: task.phaseName,
      projectId: task.projectId,
      projectTitle: task.projectTitle,
      clientName: task.clientName,
      estimateMinutes: task.estimateMinutes,
      loggedMinutes: loggedByTask.get(task.id) ?? 0,
    }));
  } catch (error) {
    throw handleError("getMyWorkService", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// ATTACHMENTS
// ===================================================================
//
// METADATA ONLY IN POSTGRES, bytes in Azure Blob, and the row holds a
// `storage_key` pointing at them. The DTO deliberately does not carry that
// key: a blob address is an internal handle, and shipping one invites
// somebody to try building a URL out of it. Files are streamed back through
// a download route that checks the session every time, never handed out as
// a signed URL.
//
// WHAT IS NOT HERE, AND MUST NOT BE ADDED HERE: the upload itself. The
// bytes have to be sniffed to decide what a file IS - never its name and
// never the browser's Content-Type - the way src/lib/ai/attachment-formats.ts
// does it for chat, and that belongs with the route that receives them. See
// the findings at the bottom of this file.
//
// WHO MAY DO WHAT, and it is not the same rule as a task edit:
//
//   ADD    any member of the project. Attaching the artefact is part of
//          doing the work, and a member who cannot attach one has to send
//          it to a lead by email, which is the outcome this replaces.
//   DELETE the person who uploaded it, or a lead, or an admin. A file
//          somebody else attached is part of the record of the task, and
//          removing it is not a tidy-up.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// The uploader's name, resolved in ONE query for however many distinct
// people have attached something to this task.
//
// The metadata read carries `uploaded_by` and not a name - it joins nothing
// - so this is the join done in the service. It is bounded by distinct
// UPLOADERS on one task, on a panel somebody opened deliberately, which is
// why it is acceptable rather than the N+1 it looks like. The proper fix is
// a left join in the repository read; it is reported as a gap.
//
// Null where the account has gone: `uploaded_by` is ON DELETE SET NULL, and
// a file whose uploader is no longer here is still part of the task.
//
// THE NAME COMES FROM userDisplayName, not from `users.name`. The time
// entries listed on the same panel resolve a preferred name, so reading the
// formal name straight off the row here showed one person under two names
// in one screen - "Ada" against her hours and "Adelaide Lovelace" against
// the file she attached. One rule, one file, imported.
// -------------------------------------------------------------------
async function mapAttachments(attachments: TaskAttachmentMeta[]): Promise<TaskAttachmentDTO[]> {
  const uploaderIds = [...new Set(attachments.map((row) => row.uploadedBy).filter((id): id is string => Boolean(id)))];

  const uploaders = await getUsersByIdsRepo(uploaderIds);
  const nameById = new Map(uploaders.map((uploader) => [uploader.id, userDisplayName(uploader)]));

  return attachments.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    mediaType: row.mediaType,
    byteSize: row.byteSize,
    uploadedByName: row.uploadedBy ? nameById.get(row.uploadedBy) ?? null : null,
    createdAt: row.createdAt,
  }));
}

// -------------------------------------------------------------------
// Everything attached to one task. Any member of the project, because the
// task panel is.
// -------------------------------------------------------------------
export async function getTaskAttachmentsService(taskId: string): Promise<TaskAttachmentDTO[]> {
  try {
    const user = await requireUser();

    const task = await getTaskRepo(taskId);

    if (!task) notFound();

    await requireProjectAccessForPage(user, task.projectId);

    return await mapAttachments(await getTaskAttachmentsRepo(task.id));
  } catch (error) {
    throw handleError("getTaskAttachmentsService", error);
  }
}

// -------------------------------------------------------------------
// STORE ONE FILE against a task the caller is on.
//
// THE STORAGE KEY IS BUILT BY src/lib/storage/task-attachment-storage.ts,
// which owns the `delivery/` prefix, the put, the deletes and the listing
// the reconciliation sweep will diff. This file used to carry its own
// builder on a `delivery/tasks/...` shape, written before that module
// existed; two builders disagreeing about the shape would leave the sweep
// unable to recognise its own files, and the PROJECT segment the shared one
// adds is what makes a per-project prefix delete possible at all. Nothing
// had been uploaded yet, so there was nothing to migrate.
//
// Still derived rather than accepted, and that is the load-bearing part: a
// service that took a `storageKey` from its caller would let a row on this
// task point at any blob in the container, including another client's
// project, while the download route authorised on the task. It is built
// from two ids this service has already authorised - the project off the
// task row, not off the request - so a row can only ever address its own
// task's prefix.
//
// `TaskAttachmentUpload` is in delivery.types.ts and NOTHING PARSES IT:
// `mediaType` must have been derived by sniffing the bytes and `byteSize`
// must be the number actually written, so a schema over those two fields
// would check a shape while proving nothing about where the values came
// from, and would afterwards read as the check that had been done. The
// download route serves the stored type back with `nosniff`, so a value
// taken from a browser here is a stored-XSS decision made in the wrong
// file. The byteSize refusal below is the second line.
// -------------------------------------------------------------------
export async function addTaskAttachmentService(upload: TaskAttachmentUpload): Promise<TaskAttachmentDTO> {
  try {
    // A caller bug rather than something a person did, so it is a plain
    // error: an empty or fractional size means the upload path handed over
    // something it never measured, and a row claiming zero bytes would
    // render as a working attachment.
    if (!Number.isInteger(upload.byteSize) || upload.byteSize <= 0) {
      throw new Error("addTaskAttachmentService requires the byte count of the file that was written");
    }

    const user = await requireUser();

    const task = await getTaskRepo(upload.taskId);

    if (!task) {
      throw new DisplayErrorMessage(TASK_UNAVAILABLE_MESSAGE);
    }

    // Membership, not lead: see the note above about who may attach.
    const access = await requireProjectAccessForWrite(user, task.projectId);

    // NO ARCHIVED CHECK HERE, and it is a decision rather than the omission
    // it looks like beside create, edit and move. By the time this runs the
    // bytes are already in storage - the route writes the blob first, because
    // the key is derived from an id it holds - so refusing here would leave a
    // file nothing points at, on the one prefix whose reconciliation sweep is
    // not wired up yet. The project's status belongs in the upload route,
    // BEFORE it writes; it is on the list at the bottom of this file with the
    // route itself, which does not exist.
    const stored = await addTaskAttachmentRepo({
      id: upload.attachmentId,
      taskId: task.id,
      storageKey: taskAttachmentStorageKey(access.projectId, task.id, upload.attachmentId),
      // Trimmed of any path the browser included and bounded, the way chat
      // does it. The name is display only; nothing downstream decides
      // anything from it.
      fileName: upload.fileName.split(/[\\/]/).pop()?.slice(0, ATTACHMENT_NAME_MAX_CHARS) || "Attachment",
      mediaType: upload.mediaType,
      byteSize: upload.byteSize,
      uploadedBy: access.user.id,
      createdAt: new Date(),
    });

    revalidateBoardViews();

    const [dto] = await mapAttachments([stored]);

    return dto;
  } catch (error) {
    throw handleError("addTaskAttachmentService", error);
  }
}

// -------------------------------------------------------------------
// Remove one attachment. THE BLOB GOES FIRST.
//
// The ordinary order, and the opposite of the task delete above: nothing
// refuses this, so clearing the file first means a failure leaves a row
// still pointing at bytes that exist. The other way round, a failed row
// delete would leave an attachment on screen that downloads nothing, and
// nothing would ever repair it.
// -------------------------------------------------------------------
export async function deleteTaskAttachmentService(attachmentId: string): Promise<void> {
  try {
    const user = await requireUser();

    // Unscoped by necessity - the caller holds an attachment id - which is
    // why the read returns the project that authorises it.
    const attachment = await getTaskAttachmentRepo(attachmentId);

    if (!attachment) {
      throw new DisplayErrorMessage("That attachment is no longer available.");
    }

    const access = await requireProjectAccessForWrite(user, attachment.projectId);

    const isUploader = attachment.uploadedBy !== null && attachment.uploadedBy === access.user.id;

    if (!isUploader && !access.canEditTasks) {
      throw new DisplayErrorMessage(
        "Only the person who attached a file, a project lead or an admin can remove it.",
      );
    }

    // THE BLOB FIRST, from the module that owns this prefix. The stored key
    // is used as recorded rather than rebuilt: it is what the row has always
    // pointed at, and a rebuilt key would silently miss any file written
    // under an earlier shape.
    if (isTaskAttachmentStorageConfigured()) {
      await deleteTaskAttachmentBlob(attachment.storageKey);
    }

    const removedKey = await deleteTaskAttachmentRepo(attachment.id, attachment.taskId);

    if (!removedKey) {
      throw new DisplayErrorMessage("That attachment is no longer available.");
    }

    revalidateBoardViews();
  } catch (error) {
    throw handleError("deleteTaskAttachmentService", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// WHAT THIS FILE NEEDS AND DOES NOT HAVE
// ===================================================================
//
// Written down here rather than worked around, because a service that runs
// its own SQL to fill one of these gaps is the layering breach the module
// is built to avoid.
//
//   1. THE UPLOAD ROUTE. A task attachment has no way in yet. It has to be
//      a route handler rather than an action - `serverActions.bodySizeLimit`
//      is global and defaults to 1 MB, and raising it weakens every action
//      in the app - and it MUST sniff the bytes to decide the media type,
//      the way src/lib/ai/attachment-formats.ts does. It validates its half
//      of the request with UploadTaskAttachmentSchema, writes the blob with
//      putTaskAttachment, and calls addTaskAttachmentService above.
//
//      TWO THINGS IT HAS TO SETTLE THAT THIS FILE CANNOT. The key needs the
//      PROJECT id, which is on the task row rather than in the request, so
//      the route has to resolve the task itself (behind
//      getVerifiedApiSession, as every route handler must) and build the
//      same key this service records. And the archived check belongs there,
//      before the bytes are written - see the note in
//      addTaskAttachmentService about why a refusal after the write would
//      orphan a file.
//
//   2. THE RECONCILIATION SWEEP. The storage module now exists
//      (src/lib/storage/task-attachment-storage.ts) and owns the `delivery/`
//      prefix, so both halves of the diff are in place:
//      listAllTaskAttachmentKeys against getAllTaskAttachmentKeysRepo. The
//      monthly retention job is where the pass itself goes, reporting a
//      count beside aiChatOrphanedBlobsPurged. Until it is wired up, a file
//      orphaned by a cascade nobody wrote code for - a phase delete is the
//      one that reaches attachment rows without an attachment being
//      mentioned - is paid for indefinitely and nothing reports it.
//
//   3. A LOGGED-MINUTES READ FOR A SET OF TASK IDS. getLoggedMinutesByTaskRepo
//      groups within ONE project, so "my work" reads once per distinct
//      project. One grouped read over a set of task ids would make it one
//      query, and the timesheet week will want the same thing.
//
//   4. A NEXT-POSITION READ FOR ONE COLUMN. Creating a card and moving one
//      both read the whole board to look at a single column.
//      addPhaseRepo derives its position inside the INSERT; the tasks
//      repository has no equivalent, so either that or a narrow
//      "cards in this phase and column" read would remove a full board read
//      from both paths.
//
//   5. THE UPLOADER'S NAME ON THE ATTACHMENT READ. getTaskAttachmentsRepo
//      selects `uploaded_by` and joins nothing, so the name is resolved
//      here in a second query. A left join to users - the one the task
//      panel's time entries already have - would remove it.
//
//   6. A "WHAT WOULD DELETING THIS TASK TAKE" READ. Refusing a delete
//      politely means asking whether any time is logged, and the only way
//      to ask is to load the entries and count them. `phases.repository.ts`
//      has getPhaseTimeLoggedRepo for exactly this question one level up;
//      the task-level equivalent would make the check one grouped count.
//
//   7. A BLOB CLEAR ON THE PHASE DELETE, which is not in this file but is
//      this file's problem: deletePhaseRepo cascades to the phase's tasks
//      and therefore to their attachment rows without an attachment being
//      named anywhere in it. deleteTaskAttachmentBlobsForTask, per task id,
//      before the phase goes, is what it needs.
// -------------------------------------------------------------------
