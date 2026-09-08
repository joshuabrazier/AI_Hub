import "server-only";

import { sql } from "kysely";

import { database, DBClient, runInTransaction } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import {
  type NewTask,
  type NewTaskAttachment,
  type ProjectStatus,
  type Task,
  type TaskAttachment,
  type TaskColumn,
  type UpdateTask,
} from "../kysely-database-types";

// -------------------------------------------------------------------
// Tasks - the cards on a project's board - and the files attached to them.
//
// THE BOUNDARY IS `project_id`, AND IT IS ALREADY ON EVERY ROW. Migration
// 016 denormalised it onto `tasks` for exactly this reason: membership of
// `project_members` is what authorises a read, so once a service has
// established that somebody is on a project, the project id is the
// predicate that keeps them inside it. Every function that can be given
// one takes it and puts it in the WHERE clause, the same way the chat and
// transcription repositories carry `user_id`.
//
// Three reads cannot: a task by id, a SET of tasks by id, and an
// attachment by id, because the caller does not yet know which project any
// of them belongs to. All three return the project id so the service can
// authorise on it, and a miss comes back as nothing rather than as an error
// - `undefined` for the two single reads, an absent row for the set - which
// is the same answer a wrong id gets, so a guessed id cannot confirm
// somebody else's task exists.
//
// Ordering is board ordering, and it comes out of the database rather than
// out of a component: phase position, then column, then position within
// the column. One query for a whole board, never one per phase.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// A board card, with the two things it renders that are not on the task
// row.
//
// The joins are here rather than in the service because the alternative is
// a read per card for the assignee's name - the N+1 this feature can least
// afford, since the board is the screen people leave open all day. The
// phase is joined for its `position`, which is what orders the boards.
// -------------------------------------------------------------------
export interface TaskBoardRow extends Task {
  phaseName: string;
  phasePosition: number;
  // Null for an unassigned card, and also null once an assignee's account
  // has gone - `assignee_id` is ON DELETE SET NULL.
  assigneeName: string | null;
  assigneeImage: string | null;
}

// A row in "my work": the same card, plus enough context to mean something
// away from its own board. A title on its own ("Fix the export") says
// nothing about which client is waiting for it.
//
// The timesheet week reads the SAME shape through `getTasksByIdsRepo`
// rather than declaring a near-identical one of its own, because a
// timesheet row is the same problem - a card being shown away from the
// board that gives it its meaning.
export interface AssignedTaskRow extends TaskBoardRow {
  projectTitle: string;
  projectStatus: ProjectStatus;
  clientId: string;
  clientName: string;
}

export interface AssignedTaskFilter {
  // Which projects count. Absent means every project this person has a
  // task on; an EMPTY array means none, and is answered with no rows - an
  // empty scope is nothing, not everything.
  projectStatuses?: readonly ProjectStatus[];
  // Which columns count. "My work" normally leaves `done` out, but that is
  // the service's decision to make, not this file's.
  boardColumns?: readonly TaskColumn[];
}

// Minutes are INTEGER MINUTES throughout. Postgres sums an INTEGER column
// into a BIGINT, which node-postgres hands back as a string, so a total is
// converted once at this boundary rather than coerced by accident further
// up.
export interface PhaseEstimateTotal {
  phaseId: string;
  estimateMinutes: number;
  // Cards in the phase, counted in the same grouped query. The GROUP BY is
  // already paid for, so this rides along for nothing, and the alternative
  // - a second read, or a count in the caller - is a second chance for two
  // numbers printed side by side in one heading to disagree.
  taskCount: number;
}

// How many files one card has. See `getAttachmentCountsForProjectRepo` for
// the absence contract: a card with no files has no row here.
export interface TaskAttachmentCount {
  taskId: string;
  attachmentCount: number;
}

// -------------------------------------------------------------------
// What a move has to be told.
//
// `orderedTaskIds` is the DESTINATION COLUMN'S WHOLE ORDERED LIST, moved
// card included, because plain integer positions mean a drop renumbers
// every sibling - migration 016 chose that over fractional ordering
// deliberately. Handing over the finished order makes the write one
// statement and leaves no reachable state where two cards claim position 3.
// -------------------------------------------------------------------
export interface TaskMove {
  taskId: string;
  projectId: string;
  phaseId: string;
  boardColumn: TaskColumn;
  orderedTaskIds: readonly string[];
}

// What the caller still owes storage once a task row has gone. See the
// note on `deleteTaskReturningBlobKeysRepo`.
export interface DeletedTaskResult {
  deleted: boolean;
  storageKeysToClear: string[];
}

// Metadata without the blob pointer, for the surfaces that only render
// names and sizes. Same split as `ai-chat-attachments.repository.ts`: a
// list that never selects `storage_key` cannot leak a storage path into a
// DTO or a component, and only the download route and the delete paths ask
// for it.
export type TaskAttachmentMeta = Omit<TaskAttachment, "storageKey">;

// An attachment plus the project that authorises reading it. The row only
// knows its task, and membership is checked against a project, so the join
// saves a second read on the one path where the answer decides whether
// bytes are served.
export interface TaskAttachmentWithProject extends TaskAttachment {
  projectId: string;
}

// Listed once so the two metadata reads cannot drift apart, and so a new
// column is a compile error here rather than a silently missing field
// downstream.
const ATTACHMENT_META_COLUMNS = [
  "id",
  "taskId",
  "fileName",
  "mediaType",
  "byteSize",
  "uploadedBy",
  "createdAt",
] as const;

// -------------------------------------------------------------------
// Create a task.
//
// `phase_id` and `project_id` are checked against each other by the
// composite foreign key, so a phase belonging to another project is
// refused by the database rather than trusted here. Only a project LEAD
// reaches this, which is the service's business.
// -------------------------------------------------------------------
export async function addTaskRepo(newTask: NewTask, db: DBClient = database): Promise<Task> {
  try {
    return await db.insertInto("tasks").values(newTask).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addTaskRepo", error);
  }
}

// -------------------------------------------------------------------
// One task by id, UNSCOPED - the only task read that is.
//
// It has to be: the caller has a task id and nothing else, and the project
// it belongs to is what decides whether they may see it. So this answers
// "which project is this task in" as much as "what is this task", and the
// service authorises on `task.projectId` before showing a single field of
// it. Undefined for a missing id.
// -------------------------------------------------------------------
export async function getTaskRepo(taskId: string, db: DBClient = database): Promise<Task | undefined> {
  try {
    return await db.selectFrom("tasks").selectAll().where("id", "=", taskId).executeTakeFirst();
  } catch (error) {
    throw handleError("getTaskRepo", error);
  }
}

// -------------------------------------------------------------------
// Edit a task inside a project the caller has been authorised for.
// Undefined when the task is not in that project.
//
// FIELDS STRIPPED FROM THE PATCH, each for its own reason:
//
//   `id` and `createdAt`, because `Updateable` allows them and an id in a
//   patch rewrites the primary key of whichever row the WHERE matched.
//   `createdBy` goes with them: who made a task is not an edit.
//
//   `projectId`, because a task never changes project. Time entries carry
//   a composite key back to (task_id, project_id), so the database refuses
//   it the moment any time has been logged - and where none has, it would
//   quietly move work out of the project that is paying for it.
//
//   `boardColumn` and `position`, because setting either without
//   renumbering the siblings is how two cards end up claiming one slot.
//   `moveTaskRepo` is the only way those two change.
// -------------------------------------------------------------------
export async function updateTaskRepo(
  taskId: string,
  projectId: string,
  patch: UpdateTask,
  db: DBClient = database,
): Promise<Task | undefined> {
  try {
    const safePatch: UpdateTask = { ...patch };
    delete safePatch.id;
    delete safePatch.projectId;
    delete safePatch.createdAt;
    delete safePatch.createdBy;
    delete safePatch.boardColumn;
    delete safePatch.position;

    return await db
      .updateTable("tasks")
      // Nothing stamps updated_at in the database, so the repository does.
      .set({ ...safePatch, updatedAt: new Date() })
      .where("id", "=", taskId)
      .where("projectId", "=", projectId)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateTaskRepo", error);
  }
}

// -------------------------------------------------------------------
// THE BOARD READ. Every card in a project, in display order, in ONE query.
//
// One query and not one per phase, because a board is the screen this
// feature is judged on and a query per phase is a round trip per heading.
// Grouping into columns is the component's job; getting the order right is
// this file's, so a board and a report can never disagree about what
// "first" means.
//
// Ordering by `board_column` sorts LEFT TO RIGHT, and that is not luck:
// the `task_column` enum is declared in board order, so Postgres' enum
// ordering IS the board's ordering, and `TASK_COLUMN_ORDER` says the same
// thing for the UI. If one is ever reordered without the other, this is
// where the disagreement surfaces.
//
// `id` breaks every tie, so two cards written in the same millisecond with
// the same position do not swap places between renders.
// -------------------------------------------------------------------
export async function getProjectBoardTasksRepo(
  projectId: string,
  db: DBClient = database,
): Promise<TaskBoardRow[]> {
  try {
    return await db
      .selectFrom("tasks as t")
      .innerJoin("phases as ph", "ph.id", "t.phaseId")
      .leftJoin("users as u", "u.id", "t.assigneeId")
      .selectAll("t")
      .select([
        "ph.name as phaseName",
        "ph.position as phasePosition",
        "u.name as assigneeName",
        "u.image as assigneeImage",
      ])
      .where("t.projectId", "=", projectId)
      .orderBy("ph.position")
      .orderBy("ph.id")
      .orderBy("t.boardColumn")
      .orderBy("t.position")
      .orderBy("t.id")
      .execute();
  } catch (error) {
    throw handleError("getProjectBoardTasksRepo", error);
  }
}

// -------------------------------------------------------------------
// Move a card: set its phase and column, then renumber the destination
// column from the ordered list the caller supplied. Undefined when the
// task is not in that project.
//
// IN A TRANSACTION, because the renumber IS the move. Committing the card
// into its new column without renumbering leaves a board with a duplicate
// position, which renders in an arbitrary order and looks to the person
// who dragged it as though the drag was ignored.
//
// The order of the two writes matters: the card is moved FIRST so that it
// matches the phase and column predicates of the renumber, which is what
// makes it pick up its own new position from the list.
//
// THE RENUMBER CANNOT REACH OUT OF THE DESTINATION COLUMN. It carries the
// project, the phase and the column in its WHERE clause, so a stale or
// hostile id list can only ever reorder cards already sitting where this
// one was dropped, and an id it does not recognise updates nothing.
//
// One statement with `unnest ... WITH ORDINALITY` rather than an update
// per sibling: a column holds tens of cards, so a loop would be correct
// but would spend a round trip per card on the interaction people repeat
// most. Positions are zero-based, matching the column default of 0 for a
// column holding one card, and a card already in the right place is left
// alone so `updated_at` only moves for cards that actually moved.
// -------------------------------------------------------------------
export async function moveTaskRepo(move: TaskMove, db: DBClient = database): Promise<Task | undefined> {
  try {
    // An invariant the database cannot express, and a silent corruption if
    // it is broken: the moved card would keep its old position and collide
    // with whichever sibling was renumbered into it.
    if (!move.orderedTaskIds.includes(move.taskId)) {
      throw new Error("moveTaskRepo requires the moved task id in orderedTaskIds");
    }

    const now = new Date();

    return await runInTransaction(db, async (trx) => {
      const moved = await trx
        .updateTable("tasks")
        .set({ phaseId: move.phaseId, boardColumn: move.boardColumn, updatedAt: now })
        .where("id", "=", move.taskId)
        .where("projectId", "=", move.projectId)
        .returning("id")
        .executeTakeFirst();

      // Not this project's task. Nothing has been written yet, so there is
      // nothing to undo, and the caller gets the answer a wrong id gets.
      if (!moved) return undefined;

      // Raw SQL because the ordered list has to reach the database as
      // DATA. The alternative that lost was a CASE expression built in a
      // loop: same one statement, but unreadable and awkward to type for
      // no gain. Snake case is deliberate - CamelCasePlugin rewrites
      // identifiers the query builder produces, not a raw fragment.
      await sql`
        UPDATE tasks AS t
        SET "position" = ordered.ord - 1,
            updated_at = ${now}
        FROM unnest(${sql.val(move.orderedTaskIds)}::text[]) WITH ORDINALITY AS ordered(id, ord)
        WHERE t.id = ordered.id
          AND t.project_id = ${move.projectId}
          AND t.phase_id = ${move.phaseId}
          AND t.board_column = ${move.boardColumn}::task_column
          AND t."position" <> ordered.ord - 1
      `.execute(trx);

      // Read back inside the transaction so the caller is handed the
      // position the card ended up with rather than the one the first
      // statement left behind.
      return await trx.selectFrom("tasks").selectAll().where("id", "=", move.taskId).executeTakeFirst();
    });
  } catch (error) {
    throw handleError("moveTaskRepo", error);
  }
}

// -------------------------------------------------------------------
// "My work": every task assigned to one person, across every project.
//
// The per-project board cannot answer this, which is what the partial
// index on `assignee_id` is for.
//
// SCOPED BY MEMBERSHIP AS WELL AS BY ASSIGNEE, because being the assignee
// is not evidence of membership - it is only evidence that somebody was a
// member when the card was assigned. Nothing in the database clears
// `assignee_id` when a person is taken off a project, and this read hands
// back the phase name, the project title and the CLIENT NAME, none of
// which a former member can reach any other way once their
// `project_members` row has gone.
//
// THE PROJECTS REPOSITORY CLEARS `assignee_id` ON REMOVAL TOO, AND
// NEITHER IS SUFFICIENT ALONE. The clear is the correct data change - a
// card should not keep pointing at somebody who cannot open it - but it is
// a write, so it is only as good as every removal path remembering to do
// it, and a crash between two statements leaves the stale row behind. This
// join is what makes the read safe on its own terms: even with a stale
// `assignee_id`, membership is asked for at the moment of access. Removing
// either one leaves the module relying on the other being perfect.
//
// The join cannot multiply rows: (project_id, user_id) is the primary key
// of `project_members`, so at most one row matches a card.
//
// Ordered by client then project so the list reads as somebody's workload
// rather than a pile, and in board order within each project.
// -------------------------------------------------------------------
export async function getTasksAssignedToUserRepo(
  userId: string,
  filter: AssignedTaskFilter = {},
  db: DBClient = database,
): Promise<AssignedTaskRow[]> {
  try {
    // Fail closed. A filter narrowed to nothing selects nothing; dropping
    // it and reading every status would be fail-open, and Kysely cannot
    // render an empty IN list in any case.
    if (filter.projectStatuses && filter.projectStatuses.length === 0) return [];
    if (filter.boardColumns && filter.boardColumns.length === 0) return [];

    let query = db
      .selectFrom("tasks as t")
      .innerJoin("phases as ph", "ph.id", "t.phaseId")
      .innerJoin("projects as p", "p.id", "t.projectId")
      .innerJoin("clients as c", "c.id", "p.clientId")
      .innerJoin("projectMembers as pm", "pm.projectId", "t.projectId")
      .leftJoin("users as u", "u.id", "t.assigneeId")
      .selectAll("t")
      .select([
        "ph.name as phaseName",
        "ph.position as phasePosition",
        "u.name as assigneeName",
        "u.image as assigneeImage",
        "p.title as projectTitle",
        "p.status as projectStatus",
        "c.id as clientId",
        "c.name as clientName",
      ])
      .where("t.assigneeId", "=", userId)
      // The same id twice, deliberately: assigned TO this person, on a
      // project this person is still on.
      .where("pm.userId", "=", userId);

    // Presence, not truthiness: an empty array is a supplied filter that
    // matches nothing and is handled above, not a missing one.
    if (filter.projectStatuses !== undefined) {
      query = query.where("p.status", "in", filter.projectStatuses);
    }
    if (filter.boardColumns !== undefined) {
      query = query.where("t.boardColumn", "in", filter.boardColumns);
    }

    return await query
      .orderBy("c.name")
      .orderBy("p.title")
      .orderBy("p.id")
      .orderBy("ph.position")
      .orderBy("ph.id")
      .orderBy("t.boardColumn")
      .orderBy("t.position")
      .orderBy("t.id")
      .execute();
  } catch (error) {
    throw handleError("getTasksAssignedToUserRepo", error);
  }
}

// -------------------------------------------------------------------
// A SET of tasks by id, with the context each one needs away from its
// board.
//
// THE TIMESHEET WEEK IS WHY THIS EXISTS. A week read comes back as bare
// time entries carrying task ids, and every row on the grid names its
// task, its phase, its project and its client. Nothing else here can
// answer that in one query: `getTaskRepo` is one task, the board read is
// one project, and the assignee read is by assignee - and people log time
// on tasks they were never assigned, across several projects, in a single
// week. So the alternative was a read per row on a screen that is a grid
// of them, which is the N+1 this file already refuses to accept for a card
// and refuses again here.
//
// UNSCOPED, like `getTaskRepo` and for the same reason: the caller holds
// task ids and nothing else. Every row carries `projectId` back so the
// service authorises before rendering a field of it. Membership is
// deliberately NOT joined - unlike the assignee read above - because a
// timesheet is the record of work somebody actually did, and a project
// they have since been taken off is their own history rather than
// somebody else's data. The ids reaching here came from their own time
// entries, not from the browser.
//
// Ordering matches "my work" exactly, so a timesheet and a task list can
// never disagree about what comes first.
// -------------------------------------------------------------------
export async function getTasksByIdsRepo(
  taskIds: readonly string[],
  db: DBClient = database,
): Promise<AssignedTaskRow[]> {
  try {
    // Fail closed, the way `getLoggedMinutesByProjectRepo` does: no ids
    // asks for no rows. It is also not optional - an `in ()` with no values
    // is a Postgres syntax error, so the empty week would fail rather than
    // come back empty.
    if (taskIds.length === 0) return [];

    return await db
      .selectFrom("tasks as t")
      .innerJoin("phases as ph", "ph.id", "t.phaseId")
      .innerJoin("projects as p", "p.id", "t.projectId")
      .innerJoin("clients as c", "c.id", "p.clientId")
      .leftJoin("users as u", "u.id", "t.assigneeId")
      .selectAll("t")
      .select([
        "ph.name as phaseName",
        "ph.position as phasePosition",
        "u.name as assigneeName",
        "u.image as assigneeImage",
        "p.title as projectTitle",
        "p.status as projectStatus",
        "c.id as clientId",
        "c.name as clientName",
      ])
      .where("t.id", "in", taskIds)
      .orderBy("c.name")
      .orderBy("p.title")
      .orderBy("p.id")
      .orderBy("ph.position")
      .orderBy("ph.id")
      .orderBy("t.boardColumn")
      .orderBy("t.position")
      .orderBy("t.id")
      .execute();
  } catch (error) {
    throw handleError("getTasksByIdsRepo", error);
  }
}

// -------------------------------------------------------------------
// Every estimated minute on a project, for the budget bar.
//
// Estimates ONLY. What has been logged against them is a different table
// and a different repository, and the two must never be added together by
// accident.
// -------------------------------------------------------------------
export async function getProjectEstimateMinutesRepo(
  projectId: string,
  db: DBClient = database,
): Promise<number> {
  try {
    const row = await db
      .selectFrom("tasks")
      .select((eb) => eb.fn.sum<string>("estimateMinutes").as("estimateMinutes"))
      .where("projectId", "=", projectId)
      .executeTakeFirst();

    // SUM over an INTEGER column is a BIGINT, which arrives as a string,
    // and it is NULL for a project with no tasks at all.
    return Number(row?.estimateMinutes ?? 0);
  } catch (error) {
    throw handleError("getProjectEstimateMinutesRepo", error);
  }
}

// -------------------------------------------------------------------
// The same totals broken down by phase, AND how many cards made them, in
// ONE grouped query.
//
// The count is here rather than anywhere else because the grouping is
// already done: `count(*)` over a group Postgres has built costs nothing,
// where a per-phase count would be a round trip per heading on a screen
// that shows every heading at once.
//
// A phase with no tasks IS ABSENT from the result rather than present as a
// zero - for both figures - because this reads `tasks` and an empty phase
// has nothing to group. The caller already holds the project's phases and
// should default a missing one to 0, which a Map lookup does for free.
// -------------------------------------------------------------------
export async function getPhaseEstimateMinutesRepo(
  projectId: string,
  db: DBClient = database,
): Promise<PhaseEstimateTotal[]> {
  try {
    const rows = await db
      .selectFrom("tasks")
      .select((eb) => [
        "phaseId",
        eb.fn.sum<string>("estimateMinutes").as("estimateMinutes"),
        eb.fn.countAll<string>().as("taskCount"),
      ])
      .where("projectId", "=", projectId)
      .groupBy("phaseId")
      .execute();

    // SUM of an INTEGER is a BIGINT and count() is a BIGINT, both of which
    // node-postgres hands back as strings. Converted once, here.
    return rows.map((row) => ({
      phaseId: row.phaseId,
      estimateMinutes: Number(row.estimateMinutes ?? 0),
      taskCount: Number(row.taskCount),
    }));
  } catch (error) {
    throw handleError("getPhaseEstimateMinutesRepo", error);
  }
}

// -------------------------------------------------------------------
// DELETE A TASK, AND HAND BACK THE BLOBS IT NO LONGER OWNS.
//
// A POSTGRES CASCADE CANNOT DELETE AN AZURE BLOB. `task_attachments` is ON
// DELETE CASCADE, so deleting a task takes the metadata and leaves the
// files - the orphan this whole arrangement exists to prevent.
//
// WHICH APPROACH, AND WHY. Chat attachments and transcription media clear
// STORAGE FIRST and the row second, because those deletes cannot be
// refused. This one can: `time_entries` references (task_id, project_id)
// ON DELETE RESTRICT, so a task with logged time is refused by the
// database, and billing history is precisely what that restriction is
// there to protect. Deleting blobs first would then leave a LIVE task
// whose attachments have no bytes behind them - a download that 404s, and
// no way back. So the order is inverted here on purpose: rows go first,
// inside a transaction, and the keys come back for the caller to clear
// AFTER the commit. Both halves of the signature say so - the name says
// keys come back, the field says they still need clearing, and the only
// way to learn what was deleted is to receive the thing that still needs
// deleting.
//
// A crash between the commit and the storage delete leaves an
// unreferenced blob, which the monthly reconciliation sweep collects using
// `getAllTaskAttachmentKeysRepo`. That is the failure this design chooses
// to have, and it is the recoverable one.
//
// The attachment rows are deleted explicitly rather than left to the
// cascade, because their keys have to be read while they still exist and a
// refused task delete has to roll their removal back with it.
//
// `deleted: false` means the task was not in that project. A REFUSED
// delete throws: the caller should tell somebody their task has time
// logged against it, not report a bug.
// -------------------------------------------------------------------
export async function deleteTaskReturningBlobKeysRepo(
  taskId: string,
  projectId: string,
  db: DBClient = database,
): Promise<DeletedTaskResult> {
  try {
    return await runInTransaction(db, async (trx) => {
      // Ownership first, so nothing is deleted for a task in a project the
      // caller was never authorised for.
      const task = await trx
        .selectFrom("tasks")
        .select("id")
        .where("id", "=", taskId)
        .where("projectId", "=", projectId)
        .executeTakeFirst();

      if (!task) return { deleted: false, storageKeysToClear: [] };

      const attachments = await trx
        .deleteFrom("taskAttachments")
        .where("taskId", "=", taskId)
        .returning("storageKey")
        .execute();

      await trx.deleteFrom("tasks").where("id", "=", taskId).where("projectId", "=", projectId).execute();

      return { deleted: true, storageKeysToClear: attachments.map((row) => row.storageKey) };
    });
  } catch (error) {
    throw handleError("deleteTaskReturningBlobKeysRepo", error);
  }
}

// -------------------------------------------------------------------
// Record an uploaded file against a task.
//
// Metadata only comes back - the caller already holds the key it just
// wrote, and nothing downstream of an upload needs it. `mediaType` is
// server-derived from the BYTES by the time it arrives here; a browser's
// Content-Type is not evidence of anything.
// -------------------------------------------------------------------
export async function addTaskAttachmentRepo(
  newAttachment: NewTaskAttachment,
  db: DBClient = database,
): Promise<TaskAttachmentMeta> {
  try {
    return await db
      .insertInto("taskAttachments")
      .values(newAttachment)
      .returning(ATTACHMENT_META_COLUMNS)
      .executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addTaskAttachmentRepo", error);
  }
}

// -------------------------------------------------------------------
// Everything attached to one task, oldest first, WITHOUT the blob keys.
//
// Scoped by task, which is what the caller has already been authorised
// for. `id` breaks the tie so the list does not reshuffle between renders.
// -------------------------------------------------------------------
export async function getTaskAttachmentsRepo(
  taskId: string,
  db: DBClient = database,
): Promise<TaskAttachmentMeta[]> {
  try {
    return await db
      .selectFrom("taskAttachments")
      .select(ATTACHMENT_META_COLUMNS)
      .where("taskId", "=", taskId)
      .orderBy("createdAt")
      .orderBy("id")
      .execute();
  } catch (error) {
    throw handleError("getTaskAttachmentsRepo", error);
  }
}

// -------------------------------------------------------------------
// How many files each card in a project has, in ONE grouped query.
//
// FOR THE PAPERCLIP ON THE BOARD, and it exists for the same reason the
// assignee is joined into `getProjectBoardTasksRepo`: the per-task read
// above would draw a board of sixty cards in sixty round trips, to render
// sixty icons, on the screen this file calls the one people leave open all
// day. Only the count is read - the names are not needed until a card is
// opened, and that is when `getTaskAttachmentsRepo` earns its keep.
//
// Scoped through `tasks.project_id`, because that is the module's
// boundary and an attachment row knows only its task. The join is the only
// way to ask the question by project.
//
// A CARD WITH NO FILES IS ABSENT from the result rather than present as a
// zero, the same contract `getPhaseEstimateMinutesRepo` documents: this
// reads `task_attachments`, so a card with none has nothing to group. The
// caller already holds the board's cards and defaults a missing one to 0.
// -------------------------------------------------------------------
export async function getAttachmentCountsForProjectRepo(
  projectId: string,
  db: DBClient = database,
): Promise<TaskAttachmentCount[]> {
  try {
    const rows = await db
      .selectFrom("taskAttachments as a")
      .innerJoin("tasks as t", "t.id", "a.taskId")
      .select((eb) => ["a.taskId as taskId", eb.fn.countAll<string>().as("attachmentCount")])
      .where("t.projectId", "=", projectId)
      .groupBy("a.taskId")
      .execute();

    // count() is a BIGINT, which node-postgres hands back as a string.
    // Converted once at this boundary rather than left to be coerced by a
    // component deciding whether to draw an icon.
    return rows.map((row) => ({ taskId: row.taskId, attachmentCount: Number(row.attachmentCount) }));
  } catch (error) {
    throw handleError("getAttachmentCountsForProjectRepo", error);
  }
}

// -------------------------------------------------------------------
// One attachment WITH its blob key and the project that authorises it, for
// the download path. Undefined for a miss.
//
// UNSCOPED of necessity - a download route holds an attachment id and
// nothing else - which is why it returns `projectId`: the service checks
// membership on it before a byte is served. The file is then streamed back
// through the app and never handed out as a signed URL, for the reason
// chat attachments are not: a SAS is a bearer token that outlives the
// session check that produced it.
// -------------------------------------------------------------------
export async function getTaskAttachmentRepo(
  attachmentId: string,
  db: DBClient = database,
): Promise<TaskAttachmentWithProject | undefined> {
  try {
    return await db
      .selectFrom("taskAttachments as a")
      .innerJoin("tasks as t", "t.id", "a.taskId")
      .select([
        "a.id",
        "a.taskId",
        "a.fileName",
        "a.mediaType",
        "a.byteSize",
        "a.uploadedBy",
        "a.createdAt",
        "a.storageKey",
        "t.projectId",
      ])
      .where("a.id", "=", attachmentId)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getTaskAttachmentRepo", error);
  }
}

// -------------------------------------------------------------------
// Remove one attachment and hand back the key the caller now has to clear.
// Undefined when it is not on that task.
//
// The key is RETURNED rather than the blob being deleted here, because a
// repository does not talk to storage - and returning it is what makes the
// obligation hard to miss.
//
// Scoped by task as well as by id, so the id the caller authorised is the
// id it deletes. Order for this one is the ordinary one - blob first, then
// row - and the service should do exactly that: nothing refuses this
// delete, so the inversion `deleteTaskReturningBlobKeysRepo` needs does not
// apply, and clearing the file first means a failure leaves no row
// pointing at bytes that have gone.
// -------------------------------------------------------------------
export async function deleteTaskAttachmentRepo(
  attachmentId: string,
  taskId: string,
  db: DBClient = database,
): Promise<string | undefined> {
  try {
    const deleted = await db
      .deleteFrom("taskAttachments")
      .where("id", "=", attachmentId)
      .where("taskId", "=", taskId)
      .returning("storageKey")
      .executeTakeFirst();

    return deleted?.storageKey;
  } catch (error) {
    throw handleError("deleteTaskAttachmentRepo", error);
  }
}

// -------------------------------------------------------------------
// Every storage key the database still claims.
//
// For the monthly reconciliation sweep, which lists the container and
// deletes whatever is there but not here. It is the ONLY thing that
// catches a file orphaned by a cascade nobody wrote code for - deleting a
// project takes its phases, its tasks and their attachment rows, and not
// one step of that chain can reach blob storage. If the count it clears is
// steadily non-zero, a delete path is missing its blob cleanup.
//
// Unscoped, like the other retention reads in this codebase: it runs from
// the job, which has no session at all.
// -------------------------------------------------------------------
export async function getAllTaskAttachmentKeysRepo(db: DBClient = database): Promise<string[]> {
  try {
    const rows = await db.selectFrom("taskAttachments").select("storageKey").execute();

    return rows.map((row) => row.storageKey);
  } catch (error) {
    throw handleError("getAllTaskAttachmentKeysRepo", error);
  }
}
