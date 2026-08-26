import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";

import { NewStaffRate, StaffRate } from "../kysely-database-types";

// -------------------------------------------------------------------
// Staff charge rates.
//
// UNSCOPED READS, like the rest of the timesheet read model, and the guard is
// the ADMIN check in the service. These are commercial figures and cost rates
// are a pay proxy, so this is a table where a missing guard leaks something
// people would mind about - do not add a caller that skips it.
//
// EVERY RATE ROW IS READ, not just the current one. Valuation needs the rate
// in force on each worklog's own date, so filtering to "today's rate" here
// would quietly restate history. The table is one row per person per rate
// change, so it stays small enough to read whole.
// -------------------------------------------------------------------

export async function listStaffRatesRepo(db: DBClient = database): Promise<StaffRate[]> {
  try {
    return await db
      .selectFrom("staffRate")
      .selectAll()
      // Person, then date descending, which is the order resolution wants and
      // the order the admin screen displays.
      .orderBy("personId")
      .orderBy("effectiveFrom", "desc")
      .execute();
  } catch (error) {
    throw handleError("listStaffRatesRepo", error);
  }
}

export async function listStaffRatesForPersonRepo(
  personId: string,
  db: DBClient = database,
): Promise<StaffRate[]> {
  try {
    return await db
      .selectFrom("staffRate")
      .selectAll()
      .where("personId", "=", personId)
      .orderBy("effectiveFrom", "desc")
      .execute();
  } catch (error) {
    throw handleError("listStaffRatesForPersonRepo", error);
  }
}

// -------------------------------------------------------------------
// Upsert on (person, effective_from).
//
// So editing "the July rate" updates that row, and setting a rate from a new
// date adds one. That is the whole history model: nothing overwrites a rate
// that applied to a period somebody has already reported on, unless they
// deliberately edit that same start date.
// -------------------------------------------------------------------
export async function upsertStaffRateRepo(row: NewStaffRate, db: DBClient = database): Promise<StaffRate> {
  try {
    return await db
      .insertInto("staffRate")
      .values(row)
      .onConflict((oc) =>
        oc.columns(["personId", "effectiveFrom"]).doUpdateSet((eb) => ({
          personName: eb.ref("excluded.personName"),
          chargeRateCents: eb.ref("excluded.chargeRateCents"),
          costRateCents: eb.ref("excluded.costRateCents"),
          notes: eb.ref("excluded.notes"),
          // updated_at has no trigger in this schema, so it is set here.
          updatedAt: new Date(),
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("upsertStaffRateRepo", error);
  }
}

// -------------------------------------------------------------------
// Remove one rate row.
//
// Deleting the EARLIEST row for somebody makes their earlier work unvalued
// again rather than valuing it at the next rate up - which is correct, and
// worth knowing before pressing it. The service says so.
// -------------------------------------------------------------------
export async function deleteStaffRateRepo(id: string, db: DBClient = database): Promise<void> {
  try {
    await db.deleteFrom("staffRate").where("id", "=", id).execute();
  } catch (error) {
    throw handleError("deleteStaffRateRepo", error);
  }
}
