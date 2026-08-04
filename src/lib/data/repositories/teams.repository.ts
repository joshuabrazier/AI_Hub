import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { NewTeam, Team, UpdateTeam } from "../kysely-database-types";

// -------------------------------------------------------------------
// Teams hold no membership themselves - who is in a team lives in
// team_members, so anything scoped to a user goes through
// team-members.repository. This file is only the teams table.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Get all teams, active first then by name, so the admin list leads with
// the ones still in use.
// -------------------------------------------------------------------
export async function getAllTeamsRepo(db: DBClient = database): Promise<Team[]> {
  try {
    return await db.selectFrom("teams").selectAll().orderBy("isActive", "desc").orderBy("name").execute();
  } catch (error) {
    throw handleError("getAllTeamsRepo", error);
  }
}

// -------------------------------------------------------------------
// Get active teams only - the pickers (assigning a class to a team,
// addressing a broadcast) must not offer a retired team.
// -------------------------------------------------------------------
export async function getActiveTeamsRepo(db: DBClient = database): Promise<Team[]> {
  try {
    return await db.selectFrom("teams").selectAll().where("isActive", "=", true).orderBy("name").execute();
  } catch (error) {
    throw handleError("getActiveTeamsRepo", error);
  }
}

// -------------------------------------------------------------------
// Get several teams by id. Takes a list because a user's scope is a set of
// teams, not one: this is what a manager's team ids resolve into for
// display. Empty list in, empty list out.
// -------------------------------------------------------------------
export async function getTeamsByIdsRepo(teamIds: string[], db: DBClient = database): Promise<Team[]> {
  try {
    // An empty `in` list is a SQL syntax error, and an empty scope must
    // return nothing rather than everything.
    if (teamIds.length === 0) return [];

    return await db.selectFrom("teams").selectAll().where("id", "in", teamIds).orderBy("name").execute();
  } catch (error) {
    throw handleError("getTeamsByIdsRepo", error);
  }
}

// -------------------------------------------------------------------
// Get a single team by id. Undefined if not found. Fetching a team by id
// does not authorize anything on its own - the caller must first check the
// id is inside the acting user's scope.
// -------------------------------------------------------------------
export async function getTeamByIdRepo(id: string, db: DBClient = database): Promise<Team | undefined> {
  try {
    return await db.selectFrom("teams").selectAll().where("id", "=", id).executeTakeFirst();
  } catch (error) {
    throw handleError("getTeamByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// Create a team. Teams are only ever created explicitly by an admin, so
// there is no find-or-create here. It starts empty; members are added
// afterwards through team-members.repository.
// -------------------------------------------------------------------
export async function createTeamRepo(newTeam: NewTeam, db: DBClient = database): Promise<Team> {
  try {
    return await db.insertInto("teams").values(newTeam).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("createTeamRepo", error);
  }
}

// -------------------------------------------------------------------
// Update a team by id. Undefined if the id does not exist. Retiring a team
// is an update setting isActive to false, not a delete - deleting would
// cascade its memberships away and orphan anything else pointing at it.
// -------------------------------------------------------------------
export async function updateTeamByIdRepo(
  id: string,
  updateTeam: UpdateTeam,
  db: DBClient = database,
): Promise<Team | undefined> {
  try {
    // Updateable<Teams> allows id and createdAt, so a patch carrying an id
    // would rewrite the primary key of the row the WHERE matched and drag
    // every team_members row pointing at it onto a new id. Neither column is
    // ever legitimately patched, so drop both before the spread.
    const patch: UpdateTeam = { ...updateTeam };
    delete patch.id;
    delete patch.createdAt;

    return await db
      .updateTable("teams")
      // Nothing stamps updated_at in the database, so the repository does it.
      .set({ ...patch, updatedAt: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateTeamByIdRepo", error);
  }
}
