import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { NewClassMember } from "../kysely-database-types";

// A user who is in a class (for the class roster / membership list).
export type ClassMemberEntry = {
  classMemberId: string;
  userId: string;
  userName: string;
  userEmail: string;
  joinedAt: Date;
};

// -------------------------------------------------------------------
// The members of one class, ordered by name. A row exists only while the user
// is in the class - leaving deletes it, so there is no status to filter on.
// -------------------------------------------------------------------
export async function getClassMembersByClassRepo(classId: string): Promise<ClassMemberEntry[]> {
  try {
    return await database
      .selectFrom("classMembers as cm")
      .innerJoin("users as u", "u.id", "cm.userId")
      .where("cm.classId", "=", classId)
      .select([
        "cm.id as classMemberId",
        "u.id as userId",
        "u.name as userName",
        "u.email as userEmail",
        "cm.joinedAt as joinedAt",
      ])
      .orderBy("u.name")
      .execute();
  } catch (error) {
    throw handleError("getClassMembersByClassRepo", error);
  }
}

// -------------------------------------------------------------------
// The user ids in one class. Used to back-fill the roster of newly-created
// sessions, so it is readable inside the transaction that creates them.
// -------------------------------------------------------------------
export async function getClassMemberUserIdsByClassRepo(classId: string, db: DBClient = database): Promise<string[]> {
  try {
    const rows = await db.selectFrom("classMembers").select("userId").where("classId", "=", classId).execute();
    return rows.map((row) => row.userId);
  } catch (error) {
    throw handleError("getClassMemberUserIdsByClassRepo", error);
  }
}

// -------------------------------------------------------------------
// The class ids a user belongs to. A user can be in several classes, so this
// is always a list.
// -------------------------------------------------------------------
export async function getClassIdsByUserRepo(userId: string): Promise<string[]> {
  try {
    const rows = await database.selectFrom("classMembers").select("classId").where("userId", "=", userId).execute();
    return rows.map((row) => row.classId);
  } catch (error) {
    throw handleError("getClassIdsByUserRepo", error);
  }
}

// -------------------------------------------------------------------
// Whether a user is in a given class. The membership check a service makes
// before letting someone act on a class's sessions.
//
// Takes the optional db like the mutations it guards: a service doing
// check-then-mutate has to run the check on the SAME connection, or it reads
// outside its own transaction - blind to its uncommitted writes and taking no
// part in the row locking that keeps the decision true until commit.
// -------------------------------------------------------------------
export async function isClassMemberRepo(
  classId: string,
  userId: string,
  db: DBClient = database,
): Promise<boolean> {
  try {
    const row = await db
      .selectFrom("classMembers")
      .select("id")
      .where("classId", "=", classId)
      .where("userId", "=", userId)
      .executeTakeFirst();
    return row !== undefined;
  } catch (error) {
    throw handleError("isClassMemberRepo", error);
  }
}

// -------------------------------------------------------------------
// Member count per class (for the "members / capacity" column).
// -------------------------------------------------------------------
export async function getClassMemberCountsRepo(): Promise<{ classId: string; count: number }[]> {
  try {
    const rows = await database
      .selectFrom("classMembers")
      .select((eb) => ["classId", eb.fn.countAll<string>().as("count")])
      .groupBy("classId")
      .execute();
    return rows.map((row) => ({ classId: row.classId, count: Number(row.count) }));
  } catch (error) {
    throw handleError("getClassMemberCountsRepo", error);
  }
}

// -------------------------------------------------------------------
// Member count for a single class (used to enforce capacity), readable inside
// the transaction that adds members.
// -------------------------------------------------------------------
export async function countClassMembersByClassRepo(classId: string, db: DBClient = database): Promise<number> {
  try {
    const row = await db
      .selectFrom("classMembers")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("classId", "=", classId)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  } catch (error) {
    throw handleError("countClassMembersByClassRepo", error);
  }
}

// -------------------------------------------------------------------
// Add one user to a class.
// -------------------------------------------------------------------
export async function createClassMemberRepo(newMember: NewClassMember, db: DBClient = database): Promise<void> {
  try {
    await db.insertInto("classMembers").values(newMember).execute();
  } catch (error) {
    throw handleError("createClassMemberRepo", error);
  }
}

// -------------------------------------------------------------------
// Add several users to a class at once. No-op if empty. The (class_id,
// user_id) UNIQUE constraint is left to raise on a duplicate rather than
// being swallowed, so a double-add surfaces instead of quietly succeeding.
// -------------------------------------------------------------------
export async function createClassMembersRepo(rows: NewClassMember[], db: DBClient = database): Promise<void> {
  try {
    if (rows.length === 0) return;
    await db.insertInto("classMembers").values(rows).execute();
  } catch (error) {
    throw handleError("createClassMembersRepo", error);
  }
}

// -------------------------------------------------------------------
// Remove a user from a class.
// -------------------------------------------------------------------
export async function deleteClassMemberRepo(
  classId: string,
  userId: string,
  db: DBClient = database,
): Promise<void> {
  try {
    await db.deleteFrom("classMembers").where("classId", "=", classId).where("userId", "=", userId).execute();
  } catch (error) {
    throw handleError("deleteClassMemberRepo", error);
  }
}
