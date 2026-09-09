import "server-only";

import { sql } from "kysely";

import { database, DBClient, runInTransaction } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import type { NewPhase, Phase } from "../kysely-database-types";

// -------------------------------------------------------------------
// Phases - the level Jira did not have.
//
// A project's board is one board per phase, so a phase is a heading with an
// order rather than a status. That makes `position` the interesting column
// and this file mostly a story about who is allowed to write it.
//
// NO AUTHORIZATION HAPPENS HERE. The boundary for the whole delivery module
// is `project_members` (an admin sees everything), and it is checked in the
// service - a phase has no owner of its own to check against. What these
// functions do carry is a `projectId` predicate on every write: the phase id
// reaching a service came from the browser, the project id came from the
// route the service just authorised, and requiring both means a phase id
// belonging to somebody else's project matches nothing instead of being
// renamed. The schema was built for exactly that check - `phases` carries a
// UNIQUE (id, project_id) so tasks can reference the pair.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// A phase's place in its project, and what deleting it would take with it.
// -------------------------------------------------------------------
export interface PhaseTimeLogged {
  // Tasks in the phase. All of them would go with it - the foreign key from
  // tasks to (phase_id, project_id) is ON DELETE CASCADE - so this is the
  // number a confirmation prompt has to name.
  taskCount: number;
  // Time entries against those tasks. Anything above zero means the delete
  // WILL be refused by the database, not merely that it is regrettable.
  timeEntryCount: number;
  loggedMinutes: number;
}

// -------------------------------------------------------------------
// Add a phase, at the end of the project's list.
//
// `position` is deliberately NOT accepted from the caller: reorder is the
// only thing that decides an order, and a create that also chose a position
// would be a second writer able to disagree with it. It is derived in the
// insert itself rather than read first and passed in, which keeps it to one
// round trip and one statement.
//
// Two concurrent creates can still land on the same number - read committed
// means both see the same MAX - and nothing breaks when they do: no
// constraint covers (project_id, position) and the list read below breaks
// ties deterministically. A unique index would turn a harmless double-click
// into an error somebody has to understand.
// -------------------------------------------------------------------
export async function addPhaseRepo(
  newPhase: Omit<NewPhase, "position">,
  db: DBClient = database,
): Promise<Phase> {
  try {
    const nextPosition = sql<number>`
      coalesce((select max(position) + 1 from phases where project_id = ${newPhase.projectId}), 0)
    `;

    return await db
      .insertInto("phases")
      .values({ ...newPhase, position: nextPosition })
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addPhaseRepo", error);
  }
}

// -------------------------------------------------------------------
// A project's phases, board order.
//
// `position` is not unique, so it cannot be the only sort: two phases
// sharing a number would swap places between renders and the board would
// look like it had shuffled itself. `createdAt` then `id` settle it, and the
// order is stable whether or not positions collide.
// -------------------------------------------------------------------
export async function getPhasesForProjectRepo(projectId: string, db: DBClient = database): Promise<Phase[]> {
  try {
    return await db
      .selectFrom("phases")
      .selectAll()
      .where("projectId", "=", projectId)
      .orderBy("position")
      .orderBy("createdAt")
      .orderBy("id")
      .execute();
  } catch (error) {
    throw handleError("getPhasesForProjectRepo", error);
  }
}

// -------------------------------------------------------------------
// One phase by id, whichever project it is in.
//
// Unscoped on purpose, and it is the one read here that is: a caller holding
// only a phase id (a task dialog, a deep link) needs the `projectId` off the
// row before it can authorise anything. So this answers "which project is
// this phase in", and the service checks membership against that project
// before showing or writing a thing.
// -------------------------------------------------------------------
export async function getPhaseRepo(phaseId: string, db: DBClient = database): Promise<Phase | undefined> {
  try {
    return await db.selectFrom("phases").selectAll().where("id", "=", phaseId).executeTakeFirst();
  } catch (error) {
    throw handleError("getPhaseRepo", error);
  }
}

// -------------------------------------------------------------------
// Rename a phase. Undefined when it is not in that project.
//
// A rename rather than a patch update, because `name` is the only field a
// person edits - `position` belongs to reorder and `project_id` never moves
// - so accepting an `Updateable` would add nothing except the chance of an
// `id` or a `position` arriving in it.
// -------------------------------------------------------------------
export async function renamePhaseRepo(
  phaseId: string,
  projectId: string,
  name: string,
  db: DBClient = database,
): Promise<Phase | undefined> {
  try {
    return await db
      .updateTable("phases")
      // Nothing stamps updated_at in the database, so the repository does.
      .set({ name, updatedAt: new Date() })
      .where("id", "=", phaseId)
      .where("projectId", "=", projectId)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("renamePhaseRepo", error);
  }
}

// -------------------------------------------------------------------
// Delete a phase. Returns how many rows went, so a caller can tell
// "deleted" from "not in that project" without a separate read.
//
// THIS CAN FAIL FOR A GOOD REASON. The delete cascades to the phase's tasks,
// and `time_entries` holds ON DELETE RESTRICT against tasks, so a phase with
// any time logged under it is refused by the database as a foreign key
// violation. That is billing history defending itself and must not be
// worked around.
//
// `getPhaseTimeLoggedRepo` is how a caller asks BEFORE offering the button,
// but it is a read and not a lock: somebody can log time between the check
// and the delete, so the violation still has to be handled rather than
// merely made unlikely.
// -------------------------------------------------------------------
export async function deletePhaseRepo(
  phaseId: string,
  projectId: string,
  db: DBClient = database,
): Promise<number> {
  try {
    const result = await db
      .deleteFrom("phases")
      .where("id", "=", phaseId)
      .where("projectId", "=", projectId)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  } catch (error) {
    throw handleError("deletePhaseRepo", error);
  }
}

// -------------------------------------------------------------------
// What is under a phase: its tasks, and the time logged against them.
//
// Read before offering a delete. Time entries carry no `phase_id` - they
// reference the task - so the join is the only way to ask, and it is a
// LEFT join because a phase full of tasks with no time on it is deletable
// and must come back as zero rather than as no row at all.
//
// The counts come back as strings: Postgres `count` is bigint and `sum` of
// an integer column is numeric, and node-postgres will not silently narrow
// either.
// -------------------------------------------------------------------
export async function getPhaseTimeLoggedRepo(
  phaseId: string,
  projectId: string,
  db: DBClient = database,
): Promise<PhaseTimeLogged> {
  try {
    const row = await db
      .selectFrom("tasks")
      .leftJoin("timeEntries", "timeEntries.taskId", "tasks.id")
      .where("tasks.phaseId", "=", phaseId)
      .where("tasks.projectId", "=", projectId)
      .select((eb) => [
        // DISTINCT because the join multiplies a task by its entries, and
        // without it a task with four days logged would be counted four
        // times in the sentence warning somebody what they are deleting.
        eb.fn.count<string>("tasks.id").distinct().as("taskCount"),
        // Counting the column rather than the rows: a task with no entries
        // contributes a NULL here, which count skips.
        eb.fn.count<string>("timeEntries.id").as("timeEntryCount"),
        eb.fn.coalesce(eb.fn.sum<string>("timeEntries.minutes"), eb.val<string>("0")).as("loggedMinutes"),
      ])
      .executeTakeFirst();

    return {
      taskCount: Number(row?.taskCount ?? 0),
      timeEntryCount: Number(row?.timeEntryCount ?? 0),
      loggedMinutes: Number(row?.loggedMinutes ?? 0),
    };
  } catch (error) {
    throw handleError("getPhaseTimeLoggedRepo", error);
  }
}

// -------------------------------------------------------------------
// Is this ordering exactly the project's phases, each of them once?
//
// Pure, and exported so it can be tested without a database - the same
// arrangement as `admitOption` in the timesheets ask box, and for the same
// reason: the interesting part of a reorder is what it REFUSES, and a check
// only reachable through a transaction never gets tested.
//
// The tension in that comparison is real and was weighed: `admitOption`
// lives in a types module with no server dependencies, whereas this file
// imports the Kysely client and so pulls in `envServer` behind it. It stays
// here anyway. `vitest.config.ts` passes `loadEnv`, so a test importing
// this module gets the environment those imports validate at load time, and
// the guard is worth more sitting beside the one transaction that enforces
// it than it would be in a types module a reader of the reorder would have
// to go looking for.
//
// A duplicate is a mismatch, not a curiosity: `["a", "a", "b"]` for three
// phases would write two positions and leave the third phase where it was,
// which is a board that has quietly ignored a drag.
// -------------------------------------------------------------------
export function isCompletePhaseOrdering(
  existingPhaseIds: readonly string[],
  orderedPhaseIds: readonly string[],
): boolean {
  const existing = new Set(existingPhaseIds);
  const supplied = new Set(orderedPhaseIds);

  if (supplied.size !== orderedPhaseIds.length) return false;
  if (supplied.size !== existing.size) return false;

  return orderedPhaseIds.every((phaseId) => existing.has(phaseId));
}

// -------------------------------------------------------------------
// Rewrite the order of a project's phases, all of them, in ONE transaction.
//
// A drag moves one card and changes several rows, because positions are
// plain integers (migration 020 chose that over fractional ordering: a
// project has a handful of phases, and rewriting them is cheaper than
// explaining fractional indices to the next reader). Done row by row on the
// bare connection, a failure on the second write leaves the board
// half-reordered - two phases at position 1, one of them nowhere near where
// it was dropped - and there is nothing left in the database to say what the
// order was meant to be. So it is all or nothing.
//
// It takes the FULL ordered list rather than "move phase X to position 3",
// which is also what makes the guard below possible: the transaction reads
// the project's own phase ids first and refuses unless the list is exactly
// that set. A partial list would silently leave the phases nobody mentioned
// holding stale positions that collide with the new ones, and a list
// carrying an id from another project would otherwise be quietly ignored.
// The read and the write have to be in the same transaction for that check
// to mean anything - a phase created in another tab between them would
// otherwise sneak past it.
//
// Returns the reordered phases, or UNDEFINED when the list did not match.
// That is a real and unexceptional outcome (a stale board in a second tab,
// most often), so it is an answer rather than a thrown error, and the
// service decides whether that reads as "refresh and try again". Nothing is
// written on that path.
// -------------------------------------------------------------------
export async function reorderPhasesForProjectRepo(
  projectId: string,
  orderedPhaseIds: readonly string[],
  db: DBClient = database,
): Promise<Phase[] | undefined> {
  try {
    return await runInTransaction(db, async (trx) => {
      const existing = await trx
        .selectFrom("phases")
        .select("id")
        .where("projectId", "=", projectId)
        .execute();

      const existingIds = existing.map((phase) => phase.id);

      if (!isCompletePhaseOrdering(existingIds, orderedPhaseIds)) return undefined;

      // One statement per phase, inside the transaction, rather than a
      // single UPDATE ... FROM unnest(...) WITH ORDINALITY. The transaction
      // already makes the set atomic, so the raw-SQL version would buy round
      // trips on a handful of rows at the cost of leaving the typed query
      // builder. Positions are 0-based, matching the column default, and no
      // constraint covers (project_id, position), so the intermediate states
      // inside the transaction are nothing to work around.
      const now = new Date();

      for (const [position, phaseId] of orderedPhaseIds.entries()) {
        await trx
          .updateTable("phases")
          .set({ position, updatedAt: now })
          .where("id", "=", phaseId)
          .where("projectId", "=", projectId)
          .execute();
      }

      return await trx
        .selectFrom("phases")
        .selectAll()
        .where("projectId", "=", projectId)
        .orderBy("position")
        .orderBy("createdAt")
        .orderBy("id")
        .execute();
    });
  } catch (error) {
    throw handleError("reorderPhasesForProjectRepo", error);
  }
}
