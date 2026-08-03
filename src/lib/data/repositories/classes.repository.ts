import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { Class, NewClass, UpdateClass } from "../kysely-database-types";

// A class row joined with the display names of its program, location, owning
// team (if any) and lead staff member.
export type ClassWithRefs = Class & {
  programName: string;
  locationName: string;
  // NULL when the class has no owning team, i.e. it is admin-only.
  teamName: string | null;
  leadUserName: string | null;
  // Whether the class is running on the date the caller asked about: still
  // flagged active (not manually retired) AND that date falls within its
  // start/end dates. Classes that have not started yet are NOT running.
  // Distinct from the class's own `isActive`.
  isRunning: boolean;
};

// A minimal class row for read-only consumers (e.g. addressing a notification
// to specific classes).
export type ActiveClass = Pick<Class, "id" | "name" | "schedule" | "isActive">;

// -------------------------------------------------------------------
// Shared select for the "class + display names" queries below.
//
// `today` is supplied by the caller rather than derived here: the app resolves
// the current calendar day in its own time zone (todayInAppZone), and a server
// clock reading either side of midnight would flag classes as running or not
// running against a different day than the rest of the app sees.
// -------------------------------------------------------------------
const classesWithRefsQuery = (today: string) =>
  database
    .selectFrom("classes as c")
    .innerJoin("programs as p", "p.id", "c.programId")
    .innerJoin("locations as l", "l.id", "c.locationId")
    .leftJoin("teams as t", "t.id", "c.teamId")
    .leftJoin("users as u", "u.id", "c.leadUserId")
    .selectAll("c")
    .select((eb) => [
      "p.name as programName",
      "l.name as locationName",
      "t.name as teamName",
      "u.name as leadUserName",
      // Dates are DATE columns, so both sides are 'YYYY-MM-DD' strings and
      // compare lexicographically.
      eb
        .and([eb("c.isActive", "=", true), eb("c.startDate", "<=", today), eb("c.endDate", ">=", today)])
        .$castTo<boolean>()
        .as("isRunning"),
    ]);

// -------------------------------------------------------------------
// Get every class, joined with display names. Ordered by program then class
// name. Admin-wide: use getClassesForTeamsRepo for a team-scoped view.
// -------------------------------------------------------------------
export async function getAllClassesRepo(today: string): Promise<ClassWithRefs[]> {
  try {
    return await classesWithRefsQuery(today).orderBy("p.name").orderBy("c.name").execute();
  } catch (error) {
    throw handleError("getAllClassesRepo", error);
  }
}

// -------------------------------------------------------------------
// Classes belonging to any of the given teams, joined with display names.
//
// `teamIds` is the caller's full team set, resolved from the SESSION - team
// membership is many-to-many, so it is always a list. An empty list means the
// caller manages no teams, which returns nothing rather than everything.
// Classes with no team are admin-only and never appear here.
// -------------------------------------------------------------------
export async function getClassesForTeamsRepo(teamIds: string[], today: string): Promise<ClassWithRefs[]> {
  try {
    if (teamIds.length === 0) return [];

    return await classesWithRefsQuery(today)
      .where("c.teamId", "in", teamIds)
      .orderBy("p.name")
      .orderBy("c.name")
      .execute();
  } catch (error) {
    throw handleError("getClassesForTeamsRepo", error);
  }
}

// -------------------------------------------------------------------
// Get active classes (read-only). Used so a staff member can list classes when
// addressing a notification. Returns just what those views need.
// -------------------------------------------------------------------
export async function getActiveClassesRepo(): Promise<ActiveClass[]> {
  try {
    return await database
      .selectFrom("classes")
      .select(["id", "name", "schedule", "isActive"])
      .where("isActive", "=", true)
      .orderBy("name", "asc")
      .execute();
  } catch (error) {
    throw handleError("getActiveClassesRepo", error);
  }
}

// -------------------------------------------------------------------
// Get a single class by id. Undefined if it does not exist. Carries teamId,
// so a service can check the caller's team scope before acting on it.
// -------------------------------------------------------------------
export async function getClassByIdRepo(id: string, db: DBClient = database): Promise<Class | undefined> {
  try {
    return await db.selectFrom("classes").selectAll().where("id", "=", id).executeTakeFirst();
  } catch (error) {
    throw handleError("getClassByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// Create a class.
// -------------------------------------------------------------------
export async function createClassRepo(newClass: NewClass, db: DBClient = database): Promise<Class> {
  try {
    return await db.insertInto("classes").values(newClass).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("createClassRepo", error);
  }
}

// -------------------------------------------------------------------
// Update a class by id. Undefined if the id does not exist.
// -------------------------------------------------------------------
export async function updateClassByIdRepo(
  id: string,
  updateClass: UpdateClass,
  db: DBClient = database,
): Promise<Class | undefined> {
  try {
    // Updateable<Classes> allows id and createdAt. A patch carrying an id would
    // rewrite the primary key of the row the WHERE matched, orphaning every
    // class_members / class_sessions row that references it. Neither column is
    // ever legitimately patched, so drop both before the spread.
    const patch: UpdateClass = { ...updateClass };
    delete patch.id;
    delete patch.createdAt;

    return await db
      .updateTable("classes")
      // Nothing stamps updated_at in the database, so the repository does it.
      .set({ ...patch, updatedAt: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateClassByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// Deactivate every still-active class whose end date has passed, so the lists
// reflect the calendar without an admin retiring each one. `today` comes from
// the caller for the same reason as above. Returns how many were flipped;
// idempotent.
// -------------------------------------------------------------------
export async function deactivateEndedClassesRepo(today: string, db: DBClient = database): Promise<number> {
  try {
    const result = await db
      .updateTable("classes")
      .set({ isActive: false, updatedAt: new Date() })
      .where("isActive", "=", true)
      .where("endDate", "<", today)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  } catch (error) {
    throw handleError("deactivateEndedClassesRepo", error);
  }
}
