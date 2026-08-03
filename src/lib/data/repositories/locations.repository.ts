import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { Location, NewLocation, UpdateLocation } from "../kysely-database-types";

// -------------------------------------------------------------------
// Get all locations, ordered by name.
// -------------------------------------------------------------------
export async function getLocationsRepo(): Promise<Location[]> {
  try {
    return await database.selectFrom("locations").selectAll().orderBy("name").execute();
  } catch (error) {
    throw handleError("getLocationsRepo", error);
  }
}

// -------------------------------------------------------------------
// Get the active locations only - the venues a class can be created
// against. Ordered by name.
// -------------------------------------------------------------------
export async function getActiveLocationsRepo(): Promise<Location[]> {
  try {
    return await database
      .selectFrom("locations")
      .selectAll()
      .where("isActive", "=", true)
      .orderBy("name")
      .execute();
  } catch (error) {
    throw handleError("getActiveLocationsRepo", error);
  }
}

// -------------------------------------------------------------------
// Get a single location by id. Returns undefined if not found.
// -------------------------------------------------------------------
export async function getLocationByIdRepo(id: string): Promise<Location | undefined> {
  try {
    return await database.selectFrom("locations").selectAll().where("id", "=", id).executeTakeFirst();
  } catch (error) {
    throw handleError("getLocationByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// Create a location.
// -------------------------------------------------------------------
export async function createLocationRepo(newLocation: NewLocation, db: DBClient = database): Promise<Location> {
  try {
    return await db.insertInto("locations").values(newLocation).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("createLocationRepo", error);
  }
}

// -------------------------------------------------------------------
// Update a location by id. Returns undefined if the id does not exist.
// -------------------------------------------------------------------
export async function updateLocationByIdRepo(
  id: string,
  updateLocation: UpdateLocation,
  db: DBClient = database,
): Promise<Location | undefined> {
  try {
    // Updateable<Locations> allows id and createdAt. A patch carrying an id
    // would rewrite the primary key of the row the WHERE matched, leaving every
    // class pointing at this venue stranded on the old id. Neither column is
    // ever legitimately patched, so drop both before the spread.
    const patch: UpdateLocation = { ...updateLocation };
    delete patch.id;
    delete patch.createdAt;

    return await db
      .updateTable("locations")
      // Nothing stamps updated_at in the database, so the repository does it.
      .set({ ...patch, updatedAt: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateLocationByIdRepo", error);
  }
}
