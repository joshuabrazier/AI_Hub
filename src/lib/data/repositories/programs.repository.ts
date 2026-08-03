import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { NewProgram, Program, UpdateProgram } from "../kysely-database-types";

// -------------------------------------------------------------------
// Get all programs, ordered by name.
// -------------------------------------------------------------------
export async function getProgramsRepo(): Promise<Program[]> {
  try {
    return await database.selectFrom("programs").selectAll().orderBy("name").execute();
  } catch (error) {
    throw handleError("getProgramsRepo", error);
  }
}

// -------------------------------------------------------------------
// Get the active programs only - the options a class can be created
// against. Ordered by name.
// -------------------------------------------------------------------
export async function getActiveProgramsRepo(): Promise<Program[]> {
  try {
    return await database
      .selectFrom("programs")
      .selectAll()
      .where("isActive", "=", true)
      .orderBy("name")
      .execute();
  } catch (error) {
    throw handleError("getActiveProgramsRepo", error);
  }
}

// -------------------------------------------------------------------
// Get a single program by id. Returns undefined if not found.
// -------------------------------------------------------------------
export async function getProgramByIdRepo(id: string): Promise<Program | undefined> {
  try {
    return await database.selectFrom("programs").selectAll().where("id", "=", id).executeTakeFirst();
  } catch (error) {
    throw handleError("getProgramByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// Create a program.
// -------------------------------------------------------------------
export async function createProgramRepo(newProgram: NewProgram, db: DBClient = database): Promise<Program> {
  try {
    return await db.insertInto("programs").values(newProgram).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("createProgramRepo", error);
  }
}

// -------------------------------------------------------------------
// Update a program by id. Returns undefined if the id does not exist.
// -------------------------------------------------------------------
export async function updateProgramByIdRepo(
  id: string,
  updateProgram: UpdateProgram,
  db: DBClient = database,
): Promise<Program | undefined> {
  try {
    // Updateable<Programs> allows id and createdAt. A patch carrying an id
    // would rewrite the primary key of the row the WHERE matched, leaving every
    // class pointing at this program stranded on the old id. Neither column is
    // ever legitimately patched, so drop both before the spread.
    const patch: UpdateProgram = { ...updateProgram };
    delete patch.id;
    delete patch.createdAt;

    return await db
      .updateTable("programs")
      // Nothing stamps updated_at in the database, so the repository does it.
      .set({ ...patch, updatedAt: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateProgramByIdRepo", error);
  }
}
