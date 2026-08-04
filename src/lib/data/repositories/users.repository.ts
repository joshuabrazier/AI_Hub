import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { STAFF_ROLES, USER_ROLES, UpdateUser, User } from "../kysely-database-types";

// -------------------------------------------------------------------
// Every person is a user - there is no separate member profile table. Which
// teams a user belongs to is a team_members question, so it lives in
// team-members.repository, not here.
//
// Role literals always come from USER_ROLES / STAFF_ROLES. Spelling a role
// out as a string would compile happily and then match nothing the next time
// the enum is renamed.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// All staff accounts (admins and managers), active first then by name, so
// the admin list leads with the people still working in the product.
// -------------------------------------------------------------------
export async function getStaffUsersRepo(db: DBClient = database): Promise<User[]> {
  try {
    return await db
      .selectFrom("users")
      .selectAll()
      .where("role", "in", [...STAFF_ROLES])
      .orderBy("isActive", "desc")
      .orderBy("name")
      .execute();
  } catch (error) {
    throw handleError("getStaffUsersRepo", error);
  }
}

// -------------------------------------------------------------------
// Active staff accounts - the pool a class picks its lead from. Deactivated
// staff are excluded so they cannot be assigned to run anything.
// -------------------------------------------------------------------
export async function getActiveStaffUsersRepo(db: DBClient = database): Promise<User[]> {
  try {
    return await db
      .selectFrom("users")
      .selectAll()
      .where("role", "in", [...STAFF_ROLES])
      .where("isActive", "=", true)
      .orderBy("name")
      .execute();
  } catch (error) {
    throw handleError("getActiveStaffUsersRepo", error);
  }
}

// -------------------------------------------------------------------
// Active admins only, not managers - a manager is scoped to their own teams,
// so admins are who gets told about things with no team behind them, such as
// a public enquiry.
// -------------------------------------------------------------------
export async function getActiveAdminUsersRepo(db: DBClient = database): Promise<User[]> {
  try {
    return await db
      .selectFrom("users")
      .selectAll()
      .where("role", "=", USER_ROLES.ADMIN)
      .where("isActive", "=", true)
      .orderBy("name")
      .execute();
  } catch (error) {
    throw handleError("getActiveAdminUsersRepo", error);
  }
}

// -------------------------------------------------------------------
// All member accounts (the end users), active first then by name.
// -------------------------------------------------------------------
export async function getMemberUsersRepo(db: DBClient = database): Promise<User[]> {
  try {
    return await db
      .selectFrom("users")
      .selectAll()
      .where("role", "=", USER_ROLES.MEMBER)
      .orderBy("isActive", "desc")
      .orderBy("name")
      .execute();
  } catch (error) {
    throw handleError("getMemberUsersRepo", error);
  }
}

// -------------------------------------------------------------------
// Get a user by id. Undefined if the id does not exist.
// -------------------------------------------------------------------
export async function getUserByUserIdRepo(id: string, db: DBClient = database): Promise<User | undefined> {
  try {
    return await db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst();
  } catch (error) {
    throw handleError("getUserByUserIdRepo", error);
  }
}

// -------------------------------------------------------------------
// Get a user by email address. Undefined if the email does not exist.
// -------------------------------------------------------------------
export async function getUserByEmailRepo(email: string, db: DBClient = database): Promise<User | undefined> {
  try {
    return await db.selectFrom("users").selectAll().where("email", "=", email).executeTakeFirst();
  } catch (error) {
    throw handleError("getUserByEmailRepo", error);
  }
}

// -------------------------------------------------------------------
// Get several users by id - resolves a set of ids (a team's membership, a broadcast
// audience) to accounts in one query instead of one per id.
// -------------------------------------------------------------------
export async function getUsersByIdsRepo(userIds: string[], db: DBClient = database): Promise<User[]> {
  try {
    // An empty `in` list is a SQL syntax error, and no ids must mean no rows
    // rather than every row.
    if (userIds.length === 0) return [];

    return await db.selectFrom("users").selectAll().where("id", "in", userIds).orderBy("name").execute();
  } catch (error) {
    throw handleError("getUsersByIdsRepo", error);
  }
}

// -------------------------------------------------------------------
// The per-type email preferences for a set of users, keyed by user id. A
// user opts out of a notification type by setting that type's key to false;
// an absent key means opted in, so a user with no preferences saved still
// receives everything. Used to drop recipients who muted the type being sent.
// -------------------------------------------------------------------
export async function getNotificationPreferencesByUserIdsRepo(
  userIds: string[],
  db: DBClient = database,
): Promise<Map<string, Record<string, boolean>>> {
  try {
    if (userIds.length === 0) return new Map();

    const rows = await db
      .selectFrom("users")
      .select(["id", "notificationPreferences"])
      .where("id", "in", userIds)
      .execute();

    return new Map(rows.map((row) => [row.id, row.notificationPreferences ?? {}]));
  } catch (error) {
    throw handleError("getNotificationPreferencesByUserIdsRepo", error);
  }
}

// -------------------------------------------------------------------
// Replace a user's notification preferences. The column is JSONB, so the
// serialisation is done here rather than at each call site.
// -------------------------------------------------------------------
export async function updateUserNotificationPreferencesRepo(
  id: string,
  notificationPreferences: Record<string, boolean>,
  db: DBClient = database,
): Promise<void> {
  try {
    await db
      .updateTable("users")
      .set({ notificationPreferences: JSON.stringify(notificationPreferences), updatedAt: new Date() })
      .where("id", "=", id)
      .execute();
  } catch (error) {
    throw handleError("updateUserNotificationPreferencesRepo", error);
  }
}

// -------------------------------------------------------------------
// Update a user by id. Undefined if the id does not exist.
//
// `role` and `isActive` are server-assigned: they may only be set from a
// value the service worked out, never from anything a client sent. This is
// also the write path for de-identification, which sets deidentifiedAt
// alongside the redacted profile fields and is irreversible.
// -------------------------------------------------------------------
export async function updateUserByIdRepo(
  id: string,
  updateUser: UpdateUser,
  db: DBClient = database,
): Promise<User | undefined> {
  try {
    // Updateable<Users> allows id and createdAt. A patch carrying an id would
    // rewrite the primary key of the row the WHERE matched, moving the account
    // this write path's role, isActive and de-identification land on. Neither
    // column is ever legitimately patched, so drop both before the spread.
    const patch: UpdateUser = { ...updateUser };
    delete patch.id;
    delete patch.createdAt;

    return await db
      .updateTable("users")
      // Nothing stamps updated_at in the database, so the repository does it.
      .set({ ...patch, updatedAt: new Date() })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateUserByIdRepo", error);
  }
}
