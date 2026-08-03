import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { ClosureDay, NewClosureDay } from "../kysely-database-types";

// -------------------------------------------------------------------
// All closure days, soonest first.
// -------------------------------------------------------------------
export async function getClosureDaysRepo(): Promise<ClosureDay[]> {
  try {
    return await database.selectFrom("closureDays").selectAll().orderBy("dayDate").execute();
  } catch (error) {
    throw handleError("getClosureDaysRepo", error);
  }
}

// -------------------------------------------------------------------
// Closure days within an inclusive date range ('YYYY-MM-DD'). Used by the
// schedules to overlay a "cancelled" state on every session on those dates.
// -------------------------------------------------------------------
export async function getClosureDaysInRangeRepo(startDate: string, endDate: string): Promise<ClosureDay[]> {
  try {
    return await database
      .selectFrom("closureDays")
      .selectAll()
      .where("dayDate", ">=", startDate)
      .where("dayDate", "<=", endDate)
      .orderBy("dayDate")
      .execute();
  } catch (error) {
    throw handleError("getClosureDaysInRangeRepo", error);
  }
}

// -------------------------------------------------------------------
// Closure days from `fromDate` ('YYYY-MM-DD') onward. Used to keep booking
// flows away from closed dates.
// -------------------------------------------------------------------
export async function getClosureDaysFromRepo(fromDate: string): Promise<ClosureDay[]> {
  try {
    return await database
      .selectFrom("closureDays")
      .selectAll()
      .where("dayDate", ">=", fromDate)
      .orderBy("dayDate")
      .execute();
  } catch (error) {
    throw handleError("getClosureDaysFromRepo", error);
  }
}

// -------------------------------------------------------------------
// The closure day on a given date ('YYYY-MM-DD'), if any.
// -------------------------------------------------------------------
export async function getClosureDayByDateRepo(date: string): Promise<ClosureDay | undefined> {
  try {
    return await database.selectFrom("closureDays").selectAll().where("dayDate", "=", date).executeTakeFirst();
  } catch (error) {
    throw handleError("getClosureDayByDateRepo", error);
  }
}

// -------------------------------------------------------------------
// A closure day by id, if it exists.
// -------------------------------------------------------------------
export async function getClosureDayByIdRepo(id: string): Promise<ClosureDay | undefined> {
  try {
    return await database.selectFrom("closureDays").selectAll().where("id", "=", id).executeTakeFirst();
  } catch (error) {
    throw handleError("getClosureDayByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// Add a closure day. The day_date UNIQUE constraint stops duplicates.
// -------------------------------------------------------------------
export async function createClosureDayRepo(row: NewClosureDay, db: DBClient = database): Promise<ClosureDay> {
  try {
    return await db.insertInto("closureDays").values(row).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("createClosureDayRepo", error);
  }
}

// -------------------------------------------------------------------
// Remove a closure day by id (its sessions return to the schedule).
// -------------------------------------------------------------------
export async function deleteClosureDayRepo(id: string, db: DBClient = database): Promise<void> {
  try {
    await db.deleteFrom("closureDays").where("id", "=", id).execute();
  } catch (error) {
    throw handleError("deleteClosureDayRepo", error);
  }
}
