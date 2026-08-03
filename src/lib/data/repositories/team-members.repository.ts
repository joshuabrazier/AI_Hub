import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { NewTeamMember, TEAM_ROLES, TeamMember, TeamRole } from "../kysely-database-types";

// -------------------------------------------------------------------
// Team membership is the app's security boundary, and it is MANY-TO-MANY:
// a user can be in no team, one team, or several.
//
// Every "which teams does this user belong to / manage" helper here returns
// string[], and callers must scope with `in`. Reading one row and treating it
// as "the" team would be a silent IDOR: Postgres does not guarantee row order
// without an ORDER BY, so a user in two teams would get an arbitrary scope on
// each request, with no error to notice. The user id passed in must always
// come from the session, never from a URL parameter.
//
// These helpers answer membership only. Admins are platform-wide and are not
// required to hold a team_members row, so the admin bypass is a decision for
// the service layer, not something baked in here.
// -------------------------------------------------------------------

// One member of a team, joined with the display fields of their user account.
// `teamRole` is their role INSIDE this team; `isActive` is the user account's
// status, so staff can see a deactivated person still holding a place.
export type TeamMemberWithUser = {
  membershipId: string;
  teamId: string;
  userId: string;
  teamRole: TeamRole;
  name: string;
  preferredName: string | null;
  email: string;
  isActive: boolean;
};

// A team a user belongs to, with the team's name, for the portal's team list.
// `teamIsActive` is the TEAM's status, not the user's.
export type UserTeamMembership = {
  teamId: string;
  teamName: string;
  teamRole: TeamRole;
  teamIsActive: boolean;
};

// -------------------------------------------------------------------
// Every team id a user belongs to. Returns [] when they belong to none,
// which must be treated as "sees nothing", never as "unscoped".
// -------------------------------------------------------------------
export async function getTeamIdsForUserRepo(userId: string, db: DBClient = database): Promise<string[]> {
  try {
    const rows = await db
      .selectFrom("teamMembers")
      .select("teamId")
      .where("userId", "=", userId)
      // Deterministic order so a scope list is stable between requests.
      .orderBy("teamId")
      .execute();
    return rows.map((row) => row.teamId);
  } catch (error) {
    throw handleError("getTeamIdsForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// Every team id a user MANAGES (team_role = 'manager'). This is the scope
// the manager portal filters on, so it is deliberately narrower than plain
// membership - being in a team does not let you administer it.
// -------------------------------------------------------------------
export async function getManagedTeamIdsForUserRepo(userId: string, db: DBClient = database): Promise<string[]> {
  try {
    const rows = await db
      .selectFrom("teamMembers")
      .select("teamId")
      .where("userId", "=", userId)
      .where("teamRole", "=", TEAM_ROLES.MANAGER)
      .orderBy("teamId")
      .execute();
    return rows.map((row) => row.teamId);
  } catch (error) {
    throw handleError("getManagedTeamIdsForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// Every membership row for a user, with the team's name - the portal's team
// list and switcher. Still one row per team; a user with several teams gets
// all of them.
// -------------------------------------------------------------------
export async function getTeamMembershipsForUserRepo(
  userId: string,
  db: DBClient = database,
): Promise<UserTeamMembership[]> {
  try {
    return await db
      .selectFrom("teamMembers as tm")
      .innerJoin("teams as t", "t.id", "tm.teamId")
      .where("tm.userId", "=", userId)
      .select([
        "tm.teamId as teamId",
        "t.name as teamName",
        "tm.teamRole as teamRole",
        "t.isActive as teamIsActive",
      ])
      .orderBy("t.name")
      .execute();
  } catch (error) {
    throw handleError("getTeamMembershipsForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// Is this user in this team? Safe to read a single row here because
// (team_id, user_id) is UNIQUE, so the question has exactly one answer -
// unlike "which team is this user in", which has many.
// -------------------------------------------------------------------
export async function isUserInTeamRepo(userId: string, teamId: string, db: DBClient = database): Promise<boolean> {
  try {
    const row = await db
      .selectFrom("teamMembers")
      .select("id")
      .where("userId", "=", userId)
      .where("teamId", "=", teamId)
      .executeTakeFirst();
    return row !== undefined;
  } catch (error) {
    throw handleError("isUserInTeamRepo", error);
  }
}

// -------------------------------------------------------------------
// Does this user manage this team? Same unique-pair reasoning as above, with
// the team role pinned to 'manager'.
// -------------------------------------------------------------------
export async function isUserTeamManagerRepo(
  userId: string,
  teamId: string,
  db: DBClient = database,
): Promise<boolean> {
  try {
    const row = await db
      .selectFrom("teamMembers")
      .select("id")
      .where("userId", "=", userId)
      .where("teamId", "=", teamId)
      .where("teamRole", "=", TEAM_ROLES.MANAGER)
      .executeTakeFirst();
    return row !== undefined;
  } catch (error) {
    throw handleError("isUserTeamManagerRepo", error);
  }
}

// -------------------------------------------------------------------
// The members of one team, ordered by name.
// -------------------------------------------------------------------
export async function getTeamMembersRepo(teamId: string, db: DBClient = database): Promise<TeamMemberWithUser[]> {
  try {
    return await db
      .selectFrom("teamMembers as tm")
      .innerJoin("users as u", "u.id", "tm.userId")
      .where("tm.teamId", "=", teamId)
      .select([
        "tm.id as membershipId",
        "tm.teamId as teamId",
        "tm.userId as userId",
        "tm.teamRole as teamRole",
        "u.name as name",
        "u.preferredName as preferredName",
        "u.email as email",
        "u.isActive as isActive",
      ])
      .orderBy("u.name")
      .execute();
  } catch (error) {
    throw handleError("getTeamMembersRepo", error);
  }
}

// -------------------------------------------------------------------
// The members of several teams at once - a manager's whole scope in one
// query rather than one per team. A user in two of the given teams appears
// once per team, which is what the per-team lists need.
// -------------------------------------------------------------------
export async function getTeamMembersForTeamsRepo(
  teamIds: string[],
  db: DBClient = database,
): Promise<TeamMemberWithUser[]> {
  try {
    // An empty `in` list is a SQL syntax error, and an empty scope must
    // return nothing rather than everything.
    if (teamIds.length === 0) return [];

    return await db
      .selectFrom("teamMembers as tm")
      .innerJoin("users as u", "u.id", "tm.userId")
      .where("tm.teamId", "in", teamIds)
      .select([
        "tm.id as membershipId",
        "tm.teamId as teamId",
        "tm.userId as userId",
        "tm.teamRole as teamRole",
        "u.name as name",
        "u.preferredName as preferredName",
        "u.email as email",
        "u.isActive as isActive",
      ])
      .orderBy("tm.teamId")
      .orderBy("u.name")
      .execute();
  } catch (error) {
    throw handleError("getTeamMembersForTeamsRepo", error);
  }
}

// -------------------------------------------------------------------
// The distinct user ids across a set of teams - the recipient list when a
// broadcast is addressed to teams. Distinct because a person in two of the
// addressed teams must not get the message twice.
// -------------------------------------------------------------------
export async function getUserIdsForTeamsRepo(teamIds: string[], db: DBClient = database): Promise<string[]> {
  try {
    if (teamIds.length === 0) return [];

    const rows = await db
      .selectFrom("teamMembers")
      .select("userId")
      .distinct()
      .where("teamId", "in", teamIds)
      .orderBy("userId")
      .execute();
    return rows.map((row) => row.userId);
  } catch (error) {
    throw handleError("getUserIdsForTeamsRepo", error);
  }
}

// -------------------------------------------------------------------
// Member count per team, for the "members" column on the teams list.
// Teams with no members are absent from the result rather than zero.
// -------------------------------------------------------------------
export async function getTeamMemberCountsRepo(db: DBClient = database): Promise<{ teamId: string; count: number }[]> {
  try {
    const rows = await db
      .selectFrom("teamMembers")
      .select((eb) => ["teamId", eb.fn.countAll<string>().as("count")])
      .groupBy("teamId")
      .execute();
    return rows.map((row) => ({ teamId: row.teamId, count: Number(row.count) }));
  } catch (error) {
    throw handleError("getTeamMemberCountsRepo", error);
  }
}

// -------------------------------------------------------------------
// Add a user to a team. Returns undefined if they were already in it: the
// existing row is left exactly as it is, so re-adding somebody can never
// quietly change the team role they already hold. Use
// updateTeamMemberRoleRepo when a role change is what is intended.
// -------------------------------------------------------------------
export async function addTeamMemberRepo(
  newTeamMember: NewTeamMember,
  db: DBClient = database,
): Promise<TeamMember | undefined> {
  try {
    return await db
      .insertInto("teamMembers")
      .values(newTeamMember)
      .onConflict((oc) => oc.columns(["teamId", "userId"]).doNothing())
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("addTeamMemberRepo", error);
  }
}

// -------------------------------------------------------------------
// Change a user's role within one team. Keyed on (teamId, userId) because
// that is what a caller holds after resolving scope, and it is UNIQUE, so
// exactly one row can match. Undefined if the user is not in the team.
// -------------------------------------------------------------------
export async function updateTeamMemberRoleRepo(
  teamId: string,
  userId: string,
  teamRole: TeamRole,
  db: DBClient = database,
): Promise<TeamMember | undefined> {
  try {
    return await db
      .updateTable("teamMembers")
      .set({ teamRole, updatedAt: new Date() })
      .where("teamId", "=", teamId)
      .where("userId", "=", userId)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateTeamMemberRoleRepo", error);
  }
}

// -------------------------------------------------------------------
// Remove a user from a team. Membership is the only thing deleted; the user
// account and anything else they hold are untouched.
// -------------------------------------------------------------------
export async function removeTeamMemberRepo(
  teamId: string,
  userId: string,
  db: DBClient = database,
): Promise<void> {
  try {
    await db.deleteFrom("teamMembers").where("teamId", "=", teamId).where("userId", "=", userId).execute();
  } catch (error) {
    throw handleError("removeTeamMemberRepo", error);
  }
}
