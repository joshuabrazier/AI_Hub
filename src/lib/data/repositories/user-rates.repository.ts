import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";

import { NewUserRate, RateBand, UserRate } from "../kysely-database-types";

// -------------------------------------------------------------------
// Effective-dated charge rates, three bands per person.
//
// UNSCOPED READS. These are commercial figures and cost rates are a pay
// proxy, so the guard is the ADMIN check in the service - there is nothing
// in the schema that stops a read. Do not add a caller that skips it.
//
// THE ONLY QUESTION THIS TABLE ANSWERS is "what was this person's rate in
// this band on this day", and the answer is the greatest `effectiveFrom`
// on or before the work date. Never the nearest, and never a later one:
// work done before somebody's earliest rate has NO rate and is reported as
// unvalued, because a rate that did not exist when the hour was worked is
// exactly the quietly wrong number this module refuses to produce.
//
// ROWS ARE REMOVABLE. An earlier draft of this file argued the table
// should be append-only; correcting a mistyped figure won that argument,
// because an admin who enters 150000 for 15000 should not have to live
// with a wrong row in an effective-dated table forever. What a delete does
// and does not change is on `deleteUserRateRepo`, and it is NOT what the
// same act means in `staff_rate` - read that note before calling it.
//
// `effectiveFrom` is a Postgres DATE and therefore a 'YYYY-MM-DD' STRING.
// Every comparison here is lexicographic, in SQL and in TypeScript alike.
// Nothing in this file constructs a Date from one.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Set a rate, keyed on (user, band, date).
//
// An UPSERT rather than an insert, matching the unique index: an admin
// fixing a figure they entered this morning is correcting today's rate,
// not starting a second one on the same day. A rate from a new date is a
// new row, which is how history stays intact - editing "the July rate"
// touches July and leaves June alone.
//
// The conflict branch names its columns rather than spreading the input,
// so `id` and `createdAt` cannot be rewritten by a caller-supplied value
// and the row keeps the identity it already had. `updatedAt` is set here
// because nothing in this schema stamps it.
// -------------------------------------------------------------------
export async function upsertUserRateRepo(row: NewUserRate, db: DBClient = database): Promise<UserRate> {
  try {
    return await db
      .insertInto("userRates")
      .values(row)
      .onConflict((oc) =>
        oc.columns(["userId", "band", "effectiveFrom"]).doUpdateSet((eb) => ({
          chargeRateCents: eb.ref("excluded.chargeRateCents"),
          costRateCents: eb.ref("excluded.costRateCents"),
          updatedAt: new Date(),
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("upsertUserRateRepo", error);
  }
}

// -------------------------------------------------------------------
// One rate row by id. Undefined when the id matches nothing.
//
// It exists for the delete path. A service has to read the row BEFORE it
// removes it, both to decide whether the caller may touch it and to name
// the person, band, date and cents in the audit entry - none of which
// survives the row, so reading it back afterwards is not an option.
//
// Undefined here rather than the null `getUserRateAsAtRepo` returns. That
// null is an ANSWER a caller acts on ("this person had no rate in that
// band"); this is only a miss on an id, which the service turns into
// notFound().
// -------------------------------------------------------------------
export async function getUserRateByIdRepo(rateId: string, db: DBClient = database): Promise<UserRate | undefined> {
  try {
    return await db.selectFrom("userRates").selectAll().where("id", "=", rateId).executeTakeFirst();
  } catch (error) {
    throw handleError("getUserRateByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// Remove one rate row. Returns how many rows went, so a service can tell
// "deleted" from "was never there" and answer notFound() for an id that
// matched nothing, without a second read.
//
// THIS DOES NOT RESTATE HISTORY, and that is where it parts company with
// `deleteStaffRateRepo`. Time entries SNAPSHOT the rate they were charged
// at, so an hour already logged keeps its captured cents whatever becomes
// of the row those cents were copied from. No margin already reported
// moves because of this call.
//
// WHAT IT CHANGES IS WHAT FUTURE ENTRIES RESOLVE TO, and it can leave a
// GAP. The resolution rule is the greatest `effectiveFrom` on or before
// the work date, never a later one, so deleting the ONLY rate effective
// before some work date means entries logged for that date afterwards
// resolve to no rate at all and are recorded unvalued. The resolver is
// being correct there, not failing - but it makes the earliest row of a
// band the dangerous one to remove, because a backdated entry made after
// the delete comes back unvalued and nothing on the screen says the rate
// it needed was deleted. The service warns before it happens.
// -------------------------------------------------------------------
export async function deleteUserRateRepo(rateId: string, db: DBClient = database): Promise<number> {
  try {
    const result = await db.deleteFrom("userRates").where("id", "=", rateId).executeTakeFirst();

    // numDeletedRows is a bigint, which node-postgres hands back as a
    // string. Converted once, here at the boundary.
    return Number(result.numDeletedRows ?? 0);
  } catch (error) {
    throw handleError("deleteUserRateRepo", error);
  }
}

// -------------------------------------------------------------------
// One person's whole rate history, newest start date first.
//
// Band is a second sort key, not decoration: three bands can share an
// `effectiveFrom`, and without it those rows come back in whatever order
// the plan produces and the screen reshuffles between loads.
// -------------------------------------------------------------------
export async function listUserRatesForUserRepo(userId: string, db: DBClient = database): Promise<UserRate[]> {
  try {
    return await db
      .selectFrom("userRates")
      .selectAll()
      .where("userId", "=", userId)
      .orderBy("effectiveFrom", "desc")
      .orderBy("band")
      .execute();
  } catch (error) {
    throw handleError("listUserRatesForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// Everybody's rates as at one date - the admin rates screen.
//
// DISTINCT ON gives the latest row per (user, band) in a single pass, and
// applies the same resolution rule as the lookups below rather than a
// second one that could drift from them. `asAtDate` is a parameter and not
// today: deriving a calendar day in here would use the server's zone, and
// the app's zone is the service's to supply.
//
// Returns rate rows only. Joining `users` for names was the alternative
// and it answers a different question - the screen also has to offer the
// people who have NO rate yet, so it lists users separately and matches on
// `userId`.
// -------------------------------------------------------------------
export async function listCurrentUserRatesRepo(asAtDate: string, db: DBClient = database): Promise<UserRate[]> {
  try {
    return await db
      .selectFrom("userRates")
      .selectAll()
      .distinctOn(["userId", "band"])
      .where("effectiveFrom", "<=", asAtDate)
      // Postgres requires the DISTINCT ON expressions to lead the sort, so
      // the descending date is what picks the winner within each group.
      .orderBy("userId")
      .orderBy("band")
      .orderBy("effectiveFrom", "desc")
      .execute();
  } catch (error) {
    throw handleError("listCurrentUserRatesRepo", error);
  }
}

// -------------------------------------------------------------------
// The rate for one (user, band) as at one work date.
//
// Null when the person had no rate in that band yet. NOT the earliest one
// they later acquired: valuing an hour at a rate that did not exist when
// it was worked moves a client's bill with nothing on the screen to say
// so, whereas a null is visible and reads as unvalued.
//
// The index on (user_id, band, effective_from DESC) is exactly this query.
// -------------------------------------------------------------------
export async function getUserRateAsAtRepo(
  userId: string,
  band: RateBand,
  workDate: string,
  db: DBClient = database,
): Promise<UserRate | null> {
  try {
    const row = await db
      .selectFrom("userRates")
      .selectAll()
      .where("userId", "=", userId)
      .where("band", "=", band)
      // A DATE column against a 'YYYY-MM-DD' string: Postgres compares
      // dates, which for this format agrees with the lexicographic
      // comparisons this file makes in TypeScript.
      .where("effectiveFrom", "<=", workDate)
      .orderBy("effectiveFrom", "desc")
      .limit(1)
      .executeTakeFirst();

    // Null rather than undefined, because "this person had no rate" is an
    // answer callers act on - it decides whether a time entry is logged
    // with a rate snapshot or without one.
    return row ?? null;
  } catch (error) {
    throw handleError("getUserRateAsAtRepo", error);
  }
}

// One (user, band, date) a rate is wanted for.
export type UserRateRequest = {
  userId: string;
  band: RateBand;
  // 'YYYY-MM-DD'.
  workDate: string;
};

// -------------------------------------------------------------------
// The key `resolveUserRatesAsAtRepo` maps its answers under.
//
// Exported so no caller invents a second format: a key built differently
// would miss every lookup, and a miss here is indistinguishable from "this
// person had no rate", which is a wrong number rather than an error.
// -------------------------------------------------------------------
export function userRateKey(userId: string, band: RateBand, workDate: string): string {
  return `${userId}|${band}|${workDate}`;
}

// -------------------------------------------------------------------
// Resolve many (user, band, date) combinations in ONE round trip.
//
// The time-logging path captures a rate snapshot per entry, and a week of
// timesheet lines asked one at a time is an N+1 on the hottest write in
// the module.
//
// Candidates are fetched by (user, band) and the winner picked per request
// in memory. The alternative was a VALUES list joined against the table
// with DISTINCT ON, which resolves it server-side - it lost because it
// needs raw SQL and a cast to the `rate_band` enum to express, while the
// candidate set is a handful of rows per person per band. `staff_rate` has
// read its whole table for the same reason since migration 007.
//
// A combination with no rate on or before its date is ABSENT from the map,
// never a zero and never the earliest rate that exists. `map.get(key)`
// undefined means unvalued.
// -------------------------------------------------------------------
export async function resolveUserRatesAsAtRepo(
  requests: readonly UserRateRequest[],
  db: DBClient = database,
): Promise<Map<string, UserRate>> {
  try {
    if (requests.length === 0) return new Map();

    const userIds = [...new Set(requests.map((request) => request.userId))];
    const bands = [...new Set(requests.map((request) => request.band))];

    // No row starting after the latest date asked about can win for any
    // request, so this narrows the read without changing an answer.
    // Lexicographic, because these are date strings.
    const latestWorkDate = requests.reduce(
      (latest, request) => (request.workDate > latest ? request.workDate : latest),
      requests[0].workDate,
    );

    const candidates = await db
      .selectFrom("userRates")
      .selectAll()
      .where("userId", "in", userIds)
      .where("band", "in", bands)
      .where("effectiveFrom", "<=", latestWorkDate)
      .orderBy("effectiveFrom", "desc")
      .execute();

    // Grouped once, and already newest-first inside each group, so the
    // answer for a request is the first row whose start date it reached.
    const byUserBand = new Map<string, UserRate[]>();
    for (const candidate of candidates) {
      const groupKey = `${candidate.userId}|${candidate.band}`;
      const group = byUserBand.get(groupKey);
      if (group) group.push(candidate);
      else byUserBand.set(groupKey, [candidate]);
    }

    const resolved = new Map<string, UserRate>();
    for (const request of requests) {
      const group = byUserBand.get(`${request.userId}|${request.band}`) ?? [];
      const rate = group.find((candidate) => candidate.effectiveFrom <= request.workDate);
      if (rate) resolved.set(userRateKey(request.userId, request.band, request.workDate), rate);
    }

    return resolved;
  } catch (error) {
    throw handleError("resolveUserRatesAsAtRepo", error);
  }
}
