import "server-only";

import { sql } from "kysely";

import { database, DBClient, runInTransaction } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import {
  type EstimateChange,
  type NewEstimateChange,
  type NewTimeEntry,
  type Task,
  type TimeEntry,
  type UpdateTimeEntry,
} from "../kysely-database-types";

// -------------------------------------------------------------------
// Time entries, and the append-only log of estimate changes beside them.
//
// UNLIKE chat and transcriptions, `user_id` is NOT the authorization check
// here. One entry is legitimately reachable by three people for three
// different reasons - whoever logged it, a lead on its project, an admin -
// so no single column expresses the rule and the SERVICE owns it.
// `project_members` is the boundary. The functions below take a task id, a
// project id or a user id because that is what the query needs, not because
// it has been checked, so nothing here is safe to reach from an action
// without a guard in front of it.
//
// TWO THINGS THIS FILE IS BUILT AROUND:
//
//   `work_date` IS A 'YYYY-MM-DD' STRING and is compared lexicographically.
//   The pg type parser maps DATE to a string on purpose; parsing one into a
//   Date to compare it is how somebody's Monday moves into the previous
//   week, and it would throw away the index while doing so.
//
//   EVERY TOTAL IS SUMMED IN SQL. A project with a year of time on it is
//   thousands of rows, and the budget report wants five different rollups
//   of them on one screen. Adding them up in JavaScript would pull that
//   year across the wire five times over to produce five numbers.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// An entry WITHOUT its rate snapshots, for the surfaces that show effort
// rather than money.
//
// Same split as `TaskAttachmentMeta` in `tasks.repository.ts`, and for the
// same reason: a read that never selects the column cannot leak it into a
// DTO or a component. The timesheet grid and the task panel are seen by
// every project member, and their DTOs deliberately carry no rate -
// selecting one there would put a client's rate card in front of anybody
// who can open a task. `selectAll()` survives only where the snapshots are
// the point: the single-entry read an edit works from, and the writes that
// return the row they wrote.
// -------------------------------------------------------------------
export type TimeEntryWithoutRates = Omit<TimeEntry, "chargeRateCents" | "costRateCents">;

// Listed once so the two rate-free reads cannot drift apart, and so a new
// column on the table is a compile error here rather than a silently
// missing field downstream.
const TIME_ENTRY_COLUMNS = [
  "id",
  "taskId",
  "projectId",
  "userId",
  "workDate",
  "minutes",
  "notes",
  "createdAt",
  "updatedAt",
] as const;

// The same list qualified for the joined read, derived rather than typed
// out again - two hand-written lists are two things to keep in step.
const TIME_ENTRY_COLUMNS_QUALIFIED = TIME_ENTRY_COLUMNS.map((column) => `te.${column}` as const);

export async function addTimeEntryRepo(newTimeEntry: NewTimeEntry, db: DBClient = database): Promise<TimeEntry> {
  try {
    return await db.insertInto("timeEntries").values(newTimeEntry).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addTimeEntryRepo", error);
  }
}

export async function getTimeEntryByIdRepo(
  timeEntryId: string,
  db: DBClient = database,
): Promise<TimeEntry | undefined> {
  try {
    return await db.selectFrom("timeEntries").selectAll().where("id", "=", timeEntryId).executeTakeFirst();
  } catch (error) {
    throw handleError("getTimeEntryByIdRepo", error);
  }
}

// -------------------------------------------------------------------
// Edit one entry inside a project the caller has been authorised for.
// Undefined when the entry is not in that project.
//
// `projectId` is in the WHERE for the reason it is on `EstimateAdjustment`:
// the service authorises somebody against THIS project, and the predicate
// is what makes that check load-bearing rather than advisory. The row
// already denormalises `project_id`, so it costs nothing and it means a
// service bug matches no row instead of reaching an entry belonging to
// another client.
//
// The RATE COLUMNS are patchable but should almost never be patched: they
// are snapshots of what the hour was worth when it was worked, and an edit
// that moves them restates history. Correcting one is a deliberate act, not
// a side effect of fixing a typo in the notes.
// -------------------------------------------------------------------
export async function updateTimeEntryRepo(
  timeEntryId: string,
  projectId: string,
  patch: UpdateTimeEntry,
  db: DBClient = database,
): Promise<TimeEntry | undefined> {
  try {
    // Updateable allows id, userId, projectId and createdAt. None is ever
    // legitimately patched: an id would rewrite the primary key of whichever
    // row the WHERE matched, and moving an entry to another person or
    // another project is a delete and a re-entry rather than an edit.
    const safePatch: UpdateTimeEntry = { ...patch };
    delete safePatch.id;
    delete safePatch.userId;
    delete safePatch.projectId;
    delete safePatch.createdAt;

    return await db
      .updateTable("timeEntries")
      // Nothing stamps updated_at in the database, so the repository does.
      .set({ ...safePatch, updatedAt: new Date() })
      .where("id", "=", timeEntryId)
      .where("projectId", "=", projectId)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateTimeEntryRepo", error);
  }
}

// Returns how many rows went, so a caller can tell "deleted" from "not
// there" without a second read. Scoped by project for the same reason the
// edit is: the service's authorisation is against a project, and an
// unscoped delete would let a bug there reach any entry in the
// organisation rather than matching nothing.
export async function deleteTimeEntryRepo(
  timeEntryId: string,
  projectId: string,
  db: DBClient = database,
): Promise<number> {
  try {
    const result = await db
      .deleteFrom("timeEntries")
      .where("id", "=", timeEntryId)
      .where("projectId", "=", projectId)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  } catch (error) {
    throw handleError("deleteTimeEntryRepo", error);
  }
}

// -------------------------------------------------------------------
// One person's entries between two dates, inclusive of both ends. This is
// the timesheet grid.
//
// `from` and `to` are 'YYYY-MM-DD' strings and are compared AS STRINGS.
// That is not a shortcut: it is the only comparison that cannot shift a day
// through a timezone, and it uses idx_time_entries_person_week as it
// stands. A `new Date(from)` here would put Monday's entries in the
// previous week for anybody east of UTC.
//
// Ordered by day and then by insertion, so a day renders in the order
// somebody typed it rather than in whatever order Postgres returns.
//
// NO RATES. The grid shows minutes; see `TimeEntryWithoutRates`.
// -------------------------------------------------------------------
export async function getTimeEntriesForUserInRangeRepo(
  userId: string,
  from: string,
  to: string,
  db: DBClient = database,
): Promise<TimeEntryWithoutRates[]> {
  try {
    return await db
      .selectFrom("timeEntries")
      .select(TIME_ENTRY_COLUMNS)
      .where("userId", "=", userId)
      .where("workDate", ">=", from)
      .where("workDate", "<=", to)
      .orderBy("workDate")
      .orderBy("createdAt")
      .execute();
  } catch (error) {
    throw handleError("getTimeEntriesForUserInRangeRepo", error);
  }
}

// -------------------------------------------------------------------
// A task's own log, newest first, for the detail panel.
//
// The name is joined rather than looked up per row: the panel always shows
// who logged what, and a query per entry is a round trip per line of a list
// read in one glance. An INNER join is safe because time_entries.user_id is
// ON DELETE RESTRICT and this app de-identifies dormant people in place -
// the user row survives a scrub carrying a tombstoned name, so an entry can
// never be joined away.
//
// NO RATES either, and here it matters most: the panel is open to every
// member of the project, so a rate on this read is a rate on their screen.
// -------------------------------------------------------------------
export interface TaskTimeEntry extends TimeEntryWithoutRates {
  userName: string;
  userEmail: string;
}

export async function getTimeEntriesForTaskRepo(taskId: string, db: DBClient = database): Promise<TaskTimeEntry[]> {
  try {
    return await db
      .selectFrom("timeEntries as te")
      .innerJoin("users as u", "u.id", "te.userId")
      .select(TIME_ENTRY_COLUMNS_QUALIFIED)
      .select(["u.name as userName", "u.email as userEmail"])
      .where("te.taskId", "=", taskId)
      .orderBy("te.workDate", "desc")
      .orderBy("te.createdAt", "desc")
      .execute();
  } catch (error) {
    throw handleError("getTimeEntriesForTaskRepo", error);
  }
}

// -------------------------------------------------------------------
// Logged minutes per project, for a set of projects.
//
// Takes a LIST rather than one id so the projects list costs one query
// instead of one per row. A project with no time against it is ABSENT from
// the result rather than present as zero: callers default a missing project
// to zero, which says the same thing once in the caller instead of paying
// for an outer join over every project here.
// -------------------------------------------------------------------
export async function getLoggedMinutesByProjectRepo(
  projectIds: string[],
  db: DBClient = database,
): Promise<{ projectId: string; minutes: number }[]> {
  try {
    if (projectIds.length === 0) return [];

    const rows = await db
      .selectFrom("timeEntries")
      // SUM over an integer column comes back from Postgres as a bigint,
      // which node-postgres hands over as a string. Converted once here
      // rather than left to be silently coerced somewhere later.
      .select((eb) => ["projectId", eb.fn.sum<string>("minutes").as("minutes")])
      .where("projectId", "in", projectIds)
      .groupBy("projectId")
      .execute();

    return rows.map((row) => ({ projectId: row.projectId, minutes: Number(row.minutes) }));
  } catch (error) {
    throw handleError("getLoggedMinutesByProjectRepo", error);
  }
}

// -------------------------------------------------------------------
// Logged minutes per phase, within one project.
//
// The join is unavoidable: time_entries denormalises `project_id` but
// deliberately not `phase_id`, because a task can be moved to another phase
// and a copy of the phase on every entry would then be wrong. Joining on
// both (id, project_id) columns matches the composite foreign key, so the
// entry and the task can never disagree about which project the work is in.
// -------------------------------------------------------------------
export async function getLoggedMinutesByPhaseRepo(
  projectId: string,
  db: DBClient = database,
): Promise<{ phaseId: string; minutes: number }[]> {
  try {
    const rows = await db
      .selectFrom("timeEntries as te")
      .innerJoin("tasks as t", (join) =>
        join.onRef("t.id", "=", "te.taskId").onRef("t.projectId", "=", "te.projectId"),
      )
      .select((eb) => ["t.phaseId as phaseId", eb.fn.sum<string>("te.minutes").as("minutes")])
      .where("te.projectId", "=", projectId)
      .groupBy("t.phaseId")
      .execute();

    return rows.map((row) => ({ phaseId: row.phaseId, minutes: Number(row.minutes) }));
  } catch (error) {
    throw handleError("getLoggedMinutesByPhaseRepo", error);
  }
}

// Logged minutes per task, within one project - every card's
// logged-versus-estimate figure in one query rather than one per card.
export async function getLoggedMinutesByTaskRepo(
  projectId: string,
  db: DBClient = database,
): Promise<{ taskId: string; minutes: number }[]> {
  try {
    const rows = await db
      .selectFrom("timeEntries")
      .select((eb) => ["taskId", eb.fn.sum<string>("minutes").as("minutes")])
      .where("projectId", "=", projectId)
      .groupBy("taskId")
      .execute();

    return rows.map((row) => ({ taskId: row.taskId, minutes: Number(row.minutes) }));
  } catch (error) {
    throw handleError("getLoggedMinutesByTaskRepo", error);
  }
}

// Logged minutes per person, within one project.
export async function getLoggedMinutesByUserForProjectRepo(
  projectId: string,
  db: DBClient = database,
): Promise<{ userId: string; minutes: number }[]> {
  try {
    const rows = await db
      .selectFrom("timeEntries")
      .select((eb) => ["userId", eb.fn.sum<string>("minutes").as("minutes")])
      .where("projectId", "=", projectId)
      .groupBy("userId")
      .execute();

    return rows.map((row) => ({ userId: row.userId, minutes: Number(row.minutes) }));
  } catch (error) {
    throw handleError("getLoggedMinutesByUserForProjectRepo", error);
  }
}

// -------------------------------------------------------------------
// Logged minutes per budget group, within one project - what a pooled
// budget has actually been spent against.
//
// A LEFT JOIN, and that is most of the point of the function. An inner join
// would drop time logged by somebody who is in no group, and the groups
// would then quietly fail to add up to the project's total; a report that is
// missing hours reads as if the work never happened. `groupId: null` is that
// bucket, and it is returned rather than hidden.
//
// The join is on (project_id, user_id), which is exactly the unique index
// holding the one-group-per-person-per-project rule - so a person cannot
// match two groups and have their minutes counted twice.
// -------------------------------------------------------------------
export async function getLoggedMinutesByBudgetGroupRepo(
  projectId: string,
  db: DBClient = database,
): Promise<{ groupId: string | null; minutes: number }[]> {
  try {
    const rows = await db
      .selectFrom("timeEntries as te")
      .leftJoin("projectBudgetGroupMembers as m", (join) =>
        join.onRef("m.userId", "=", "te.userId").onRef("m.projectId", "=", "te.projectId"),
      )
      .select((eb) => ["m.groupId as groupId", eb.fn.sum<string>("te.minutes").as("minutes")])
      .where("te.projectId", "=", projectId)
      .groupBy("m.groupId")
      .execute();

    return rows.map((row) => ({ groupId: row.groupId, minutes: Number(row.minutes) }));
  } catch (error) {
    throw handleError("getLoggedMinutesByBudgetGroupRepo", error);
  }
}

// -------------------------------------------------------------------
// THE MONEY HALF OF THE BUDGET REPORT.
//
// What logged time is worth at the rates snapshotted on the entries
// themselves, in cents. Revenue and cost come back together because the
// margin needs both and one pass over the rows answers both.
//
// SUMMED IN SQL like every other total here, and for a sharper reason than
// the minutes are: the alternative is a service looping tasks and adding
// entries up in JavaScript, which drags a year of a project across the wire
// to produce two numbers.
//
// ROUNDED PER ENTRY, THEN SUMMED. Every entry carries its own snapshot
// rate, so there is no single rate a total could be derived from - and it
// gives the property somebody checking an invoice needs: the total is
// exactly the sum of the lines shown. `minutes` is cast to numeric first so
// the multiply cannot overflow int4 at an implausible rate.
//
// AN UNVALUED HOUR MAKES THE TOTAL NULL, NEVER NOUGHT, and the null is the
// whole design of the function. A non-billable project has nothing to
// charge and an unmodelled cost is unknown; calling either of them zero
// turns "we do not know the margin" into "the margin is 100%", the one
// wrong answer that reads as good news. So unknown PROPAGATES: one entry
// with no snapshot on that side blanks that side's total.
//
// The alternative that lost was letting `sum()` skip the nulls, which
// returns null only when EVERY entry is unvalued. It reports a partial
// total as a whole one - and on the cost side a partial cost against a full
// charge inflates the margin, which is precisely the plausible wrong number
// beside a right one that this module refuses everywhere else. A blank
// says "ask why an hour has no rate"; an understated cost says nothing.
// -------------------------------------------------------------------
export interface ChargeAndCostCents {
  chargeCents: number | null;
  costCents: number | null;
}

// -------------------------------------------------------------------
// HOW MANY ENTRIES BLANKED THE TOTAL, which is the question a null on the
// report cannot answer on its own.
//
// A blank said "not valued" and nothing more, so it read identically for one
// hour logged before somebody's rate existed and for a project where nothing
// had ever been priced. That is the difference between a note to yourself and
// a fault to chase, and the screen had no way to tell them apart - which is
// exactly how a working report came to be reported as broken.
//
// COUNTED PER SIDE, not once. On a non-billable project every charge
// snapshot is null by design, so a single combined count would be permanently
// non-zero there and would cry wolf on the one project where a blank charge
// is the correct answer.
// -------------------------------------------------------------------
export interface UnvaluedEntryCounts {
  unvaluedChargeEntries: number;
  unvaluedCostEntries: number;
}

export interface BudgetGroupChargeAndCostCents extends ChargeAndCostCents {
  // Null is the no-group bucket, for the reason the minutes read returns
  // one: time logged by somebody in no group is still the project's money.
  groupId: string | null;
}

// ===================================================================
// VALUING THE HOURS THAT WERE NEVER VALUED.
//
// THE BUG THIS FIXES, WHICH LOOKED LIKE A BROKEN REPORT. A time entry
// snapshots the cents it was charged at when it is LOGGED, and the budget
// report sums those snapshots. Set somebody's rates after their time is
// already logged - which is the ordinary order of events, because nobody
// prices a person before they have started - and every one of those entries
// carries no snapshot. Nothing filled them in afterwards, so the report read
// "not valued" for the whole project, permanently, however many rates were
// entered.
//
// And it only took ONE such entry. `valuedCents` above propagates unknown on
// purpose: one unvalued hour blanks that side's total, because a partial cost
// against a full charge inflates the margin. That is the right call and it
// made the symptom total rather than partial.
//
// WHY THIS IS NOT REWRITING HISTORY, which is the promise it has to keep.
// The module's rule is that an hour is worth what it was worth when it was
// worked, and `deleteUserRateRepo` and the rate services all say so. COALESCE
// is what keeps it: a column that already holds cents is left exactly as it
// is, on every row, and only a NULL is ever written to. An hour that was
// valued keeps its value. An hour that was never valued gains one, which is
// not a restatement - there was nothing there to restate.
//
// THE RATE IS RESOLVED PER ENTRY, AS AT ITS OWN WORK DATE, by the same rule
// getUserRateAsAtRepo applies: the greatest effective_from on or before the
// date, never a later one. So a rate effective from July values July's hours
// and leaves June's alone - and June stays visibly unvalued rather than being
// quietly priced at a rate that did not exist when it was worked.
//
// THE BAND COMES FROM `project_members`, not from the rate row, because a
// band is a fact about somebody ON A PROJECT: the same person can be
// discounted for one client and standard for another. An entry whose project
// membership has since been removed resolves no band and is left alone, which
// is correct - there is no longer an answer to what that client was charged.
//
// A NON-BILLABLE PROJECT KEEPS A NULL CHARGE and gains a cost, which is the
// same asymmetry resolveRateSnapshot applies at log time: the work costs what
// it costs whether or not anybody is billed for it.
// ===================================================================
export async function valueUnpricedTimeEntriesForUserRepo(
  userId: string,
  db: DBClient = database,
): Promise<number> {
  try {
    // -----------------------------------------------------------------
    // THE RESOLUTION IS A CTE, AND IT HAS TO BE.
    //
    // The obvious shape is one UPDATE ... FROM with a LATERAL subquery
    // picking each entry's rate. Postgres REFUSES it:
    //
    //   invalid reference to FROM-clause entry for table "te"
    //
    // A FROM item in an UPDATE cannot laterally reference the update
    // TARGET - the target is not in scope for the FROM list the way a
    // joined table is. It parses far enough to look right and fails at
    // plan time, which is why this was proven against a database before it
    // shipped rather than after.
    //
    // So the lateral lives in a plain SELECT, where it is legal, and the
    // UPDATE joins to that by id. One statement still: the set being
    // corrected is every unvalued entry a person has across every project,
    // and pulling it back to resolve a rate each would be a query per hour
    // ever logged.
    // -----------------------------------------------------------------
    const result = await sql<{ id: string }>`
      with resolved as (
        select te.id,
               case when p.is_billable then r.charge_rate_cents end as charge_rate_cents,
               r.cost_rate_cents
          from time_entries te
          join project_members pm
            on pm.user_id = te.user_id
           and pm.project_id = te.project_id
          join projects p
            on p.id = te.project_id
          cross join lateral (
                 select ur.charge_rate_cents, ur.cost_rate_cents
                   from user_rates ur
                  where ur.user_id = te.user_id
                    and ur.band    = pm.rate_band
                    and ur.effective_from <= te.work_date
                  order by ur.effective_from desc
                  limit 1
               ) r
         where te.user_id = ${userId}
           -- Only rows with something missing, so an entry that is already
           -- fully valued is not considered at all.
           and (te.charge_rate_cents is null or te.cost_rate_cents is null)
      )
      update time_entries te
         set charge_rate_cents = coalesce(te.charge_rate_cents, resolved.charge_rate_cents),
             cost_rate_cents   = coalesce(te.cost_rate_cents, resolved.cost_rate_cents),
             updated_at        = now()
        from resolved
       where resolved.id = te.id
         -- Only where this would actually CHANGE one of them. Without it, an
         -- entry on a non-billable project with no cost rate is rewritten
         -- with the values it already had on every rate save, bumping
         -- updated_at and inflating the count reported to the person saving.
         and (
               (te.charge_rate_cents is null and resolved.charge_rate_cents is not null)
            or (te.cost_rate_cents   is null and resolved.cost_rate_cents   is not null)
         )
       returning te.id
    `.execute(db);

    return result.rows.length;
  } catch (error) {
    throw handleError("valueUnpricedTimeEntriesForUserRepo", error);
  }
}

// The rate column is a closed union rather than a string, so `sql.raw` here
// cannot be handed anything a caller made up.
function valuedCents(rateColumn: "charge_rate_cents" | "cost_rate_cents") {
  return sql<string | null>`case
      when count(*) filter (where te.${sql.raw(rateColumn)} is null) > 0 then null
      else sum(round(te.minutes::numeric * te.${sql.raw(rateColumn)} / 60))
    end`;
}

// The same `count(*) filter` the case above already evaluates, returned
// rather than only branched on - so the screen can say how many hours blanked
// the total instead of only that it is blank.
function unvaluedCount(rateColumn: "charge_rate_cents" | "cost_rate_cents") {
  return sql<string>`count(*) filter (where te.${sql.raw(rateColumn)} is null)`;
}

// Postgres hands numeric and bigint back as STRINGS, so the conversion
// happens once, here, at the boundary. It has to be guarded: `Number(null)`
// is 0, which would undo the whole point of returning a null.
function centsOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

// -------------------------------------------------------------------
// One project's charge and cost. Null on both sides when no time has been
// logged at all, which the caller reads beside a zero-minute rollup.
// -------------------------------------------------------------------
export async function getChargeAndCostCentsByProjectRepo(
  projectId: string,
  db: DBClient = database,
): Promise<ChargeAndCostCents & UnvaluedEntryCounts> {
  try {
    const row = await db
      .selectFrom("timeEntries as te")
      .select([
        valuedCents("charge_rate_cents").as("chargeCents"),
        valuedCents("cost_rate_cents").as("costCents"),
        unvaluedCount("charge_rate_cents").as("unvaluedChargeEntries"),
        unvaluedCount("cost_rate_cents").as("unvaluedCostEntries"),
      ])
      .where("te.projectId", "=", projectId)
      .executeTakeFirst();

    return {
      chargeCents: centsOrNull(row?.chargeCents ?? null),
      costCents: centsOrNull(row?.costCents ?? null),
      // Postgres returns count() as a bigint, which arrives as a STRING.
      // Zero when there is no row at all, which is a project with no time
      // logged - nothing is unvalued because nothing exists.
      unvaluedChargeEntries: Number(row?.unvaluedChargeEntries ?? 0),
      unvaluedCostEntries: Number(row?.unvaluedCostEntries ?? 0),
    };
  } catch (error) {
    throw handleError("getChargeAndCostCentsByProjectRepo", error);
  }
}

// -------------------------------------------------------------------
// The same two figures per budget group, within one project.
//
// The join is the one `getLoggedMinutesByBudgetGroupRepo` makes, and for
// the same two reasons: LEFT so nobody's hours are dropped for being in no
// group, and on (project_id, user_id) so the unique index holding
// one-group-per-person-per-project stops a person's money being counted
// against two pools.
//
// A group with no time against it is ABSENT rather than present as a pair of
// nulls, matching the minutes read - callers already default a missing group.
// -------------------------------------------------------------------
export async function getChargeAndCostCentsByBudgetGroupRepo(
  projectId: string,
  db: DBClient = database,
): Promise<BudgetGroupChargeAndCostCents[]> {
  try {
    const rows = await db
      .selectFrom("timeEntries as te")
      .leftJoin("projectBudgetGroupMembers as m", (join) =>
        join.onRef("m.userId", "=", "te.userId").onRef("m.projectId", "=", "te.projectId"),
      )
      .select([
        "m.groupId as groupId",
        valuedCents("charge_rate_cents").as("chargeCents"),
        valuedCents("cost_rate_cents").as("costCents"),
      ])
      .where("te.projectId", "=", projectId)
      .groupBy("m.groupId")
      .execute();

    return rows.map((row) => ({
      groupId: row.groupId,
      chargeCents: centsOrNull(row.chargeCents),
      costCents: centsOrNull(row.costCents),
    }));
  } catch (error) {
    throw handleError("getChargeAndCostCentsByBudgetGroupRepo", error);
  }
}

// -------------------------------------------------------------------
// Append one estimate change without touching any estimate.
//
// For the case where the estimate is written by a statement this function
// cannot own - a task edit that sets a new figure outright, through the
// tasks repository. Pass the same `db` to both and they land together.
//
// If what is being recorded is "add these minutes" or "move these minutes
// out of that task", use adjustTaskEstimateRepo or transferTaskEstimateRepo
// instead: those do the arithmetic and the record as one write, so the log
// cannot end up describing a change that did not happen.
// -------------------------------------------------------------------
export async function addEstimateChangeRepo(
  newEstimateChange: NewEstimateChange,
  db: DBClient = database,
): Promise<EstimateChange> {
  try {
    return await db.insertInto("estimateChanges").values(newEstimateChange).returningAll().executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addEstimateChangeRepo", error);
  }
}

// -------------------------------------------------------------------
// One task's estimate history, newest first - BOTH SIDES of it.
//
// A transfer writes ONE row, keyed to the RECEIVER with `from_task_id`
// naming the source. Filtering on `task_id` alone would therefore show the
// receiver a gain and show the SOURCE nothing at all: its estimate would
// have dropped with no line saying who moved the minutes or where they
// went, which is the one question the table exists to answer, and the
// log would stop summing to the difference between the original estimate
// and the current one. So the read matches EITHER end.
//
// `direction` is what tells the two apart - "in" for a row recorded
// against this task, "out" for a row that took minutes from it - and
// `counterpartTaskId` / `counterpartTaskTitle` name the other end whichever
// end this is. A plain adjustment is "in" with no counterpart, because
// nothing was on the other side of it.
//
// `fromTaskId` and `fromTaskTitle` still describe THE ROW - the source the
// minutes came out of, the same answer for both tasks - while `direction`
// and the counterpart pair describe it FROM THE ASKING TASK. Keeping both
// is what lets a caller render one line without working out which task it
// is standing on.
//
// `minutes` STAYS AS STORED: positive out of the source and into the
// receiver. Negating it here for an "out" row would make this type
// disagree with the column it inherits, and would hand out two different
// numbers for one row depending on which task asked. A caller summing a
// task's own history applies `direction` instead, which is what it is for.
//
// All three joins are LEFT joins. `changed_by` and `from_task_id` are both
// ON DELETE SET NULL, and a change whose author or source task has since
// gone is still part of the record - it just has less to say. The receiving
// task is joined leniently for symmetry rather than necessity.
//
// ONE query with an OR rather than two reads merged in JavaScript. Only the
// `task_id` side has an index (idx_estimate_changes_task); a UNION would not
// fix that, since there is no index on `from_task_id` for the other half to
// use either, and the table takes one row per estimate edit on a project.
// -------------------------------------------------------------------
export type EstimateChangeDirection = "in" | "out";

export interface EstimateChangeEntry extends EstimateChange {
  changedByName: string | null;
  fromTaskTitle: string | null;
  direction: EstimateChangeDirection;
  counterpartTaskId: string | null;
  counterpartTaskTitle: string | null;
}

export async function getEstimateChangesForTaskRepo(
  taskId: string,
  db: DBClient = database,
): Promise<EstimateChangeEntry[]> {
  try {
    return await db
      .selectFrom("estimateChanges as ec")
      .leftJoin("users as u", "u.id", "ec.changedBy")
      .leftJoin("tasks as ft", "ft.id", "ec.fromTaskId")
      .leftJoin("tasks as tt", "tt.id", "ec.taskId")
      .selectAll("ec")
      .select((eb) => [
        "u.name as changedByName",
        "ft.title as fromTaskTitle",
        // Both arms are SQL LITERALS rather than bound values, and typed
        // explicitly, because a CASE whose every branch is an untyped
        // parameter leaves Postgres nothing to infer a result type from.
        sql<EstimateChangeDirection>`case when ec.task_id = ${taskId} then 'in'::text else 'out'::text end`.as(
          "direction",
        ),
        // The far end of the row, from the asking task's point of view: the
        // source it came out of, or the task it went into.
        eb
          .case()
          .when("ec.taskId", "=", taskId)
          .then(eb.ref("ec.fromTaskId"))
          .else(eb.ref("ec.taskId"))
          .end()
          .as("counterpartTaskId"),
        eb
          .case()
          .when("ec.taskId", "=", taskId)
          .then(eb.ref("ft.title"))
          .else(eb.ref("tt.title"))
          .end()
          .as("counterpartTaskTitle"),
      ])
      .where((eb) => eb.or([eb("ec.taskId", "=", taskId), eb("ec.fromTaskId", "=", taskId)]))
      .orderBy("ec.createdAt", "desc")
      .execute();
  } catch (error) {
    throw handleError("getEstimateChangesForTaskRepo", error);
  }
}

// -------------------------------------------------------------------
// Change one task's estimate against the project's total, and record it.
//
// `minutes` is SIGNED: positive adds to the estimate, negative reduces it,
// and the same number goes into the log so the history sums to the
// difference between the original figure and the current one. Zero is
// refused by the table's own CHECK.
//
// This is the ADJUSTMENT, not the transfer. Nothing else moves - the
// project's total is now bigger or smaller than it was. If the minutes are
// meant to come out of another task, that is transferTaskEstimateRepo, and
// telling the two apart is the entire reason the log exists.
//
// Undefined means refused: no such task in that project, or a reduction
// larger than the estimate it is being taken from. Read the task back to
// tell which.
// -------------------------------------------------------------------
export interface EstimateAdjustment {
  changeId: string;
  taskId: string;
  // Carried so the write cannot reach a task in another project even if a
  // caller hands over an id it never checked. The service authorises
  // somebody against THIS project; this is what makes that check
  // load-bearing rather than advisory.
  projectId: string;
  minutes: number;
  reason: string | null;
  changedBy: string | null;
}

export async function adjustTaskEstimateRepo(
  adjustment: EstimateAdjustment,
  db: DBClient = database,
): Promise<{ task: Task; change: EstimateChange } | undefined> {
  try {
    return await runInTransaction(db, async (trx) => {
      const task = await trx
        .updateTable("tasks")
        .set({
          estimateMinutes: sql<number>`estimate_minutes + ${adjustment.minutes}`,
          // No trigger stamps updated_at, and an estimate change is a change
          // to the task.
          updatedAt: new Date(),
        })
        .where("id", "=", adjustment.taskId)
        .where("projectId", "=", adjustment.projectId)
        // Reads as "there is enough there to take". For a positive
        // adjustment the right-hand side is negative and the predicate is
        // free; for a negative one it is what stops the estimate going below
        // zero. Refusing here rather than letting
        // tasks_estimate_non_negative fire gives the caller an answer
        // instead of an aborted transaction to interpret.
        .where("estimateMinutes", ">=", -adjustment.minutes)
        .returningAll()
        .executeTakeFirst();

      if (!task) return undefined;

      const change = await trx
        .insertInto("estimateChanges")
        .values({
          id: adjustment.changeId,
          taskId: adjustment.taskId,
          // The project's total went up or down. Nothing was taken out of
          // another task, and that is what the null says.
          fromTaskId: null,
          minutes: adjustment.minutes,
          reason: adjustment.reason,
          changedBy: adjustment.changedBy,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return { task, change };
    });
  } catch (error) {
    throw handleError("adjustTaskEstimateRepo", error);
  }
}

// -------------------------------------------------------------------
// MOVE minutes from one task's estimate onto another's, and record the move.
//
// ONE FUNCTION AND ONE TRANSACTION, because a transfer is three writes that
// are only true together. Left to a service to do in sequence, a failure
// after the first would leave minutes taken off one task and appearing
// nowhere, and a failure after the second would leave a project's budget
// rearranged with no record of who rearranged it. The whole reason
// estimate_changes exists is that when a project goes over, the first
// question is what moved - and a log that is occasionally missing an entry
// cannot answer it.
//
// `minutes` is POSITIVE and reads as "out of fromTask, into toTask". The
// single logged row carries `task_id` = the receiver and `from_task_id` =
// the source, which is how the log tells a transfer from an adjustment.
//
// Undefined means refused AND nothing was written: one of the tasks is not
// in that project, the two are the same task, or the source has fewer
// minutes than are being asked of it.
// -------------------------------------------------------------------
export interface EstimateTransfer {
  changeId: string;
  toTaskId: string;
  fromTaskId: string;
  projectId: string;
  minutes: number;
  reason: string | null;
  changedBy: string | null;
}

export async function transferTaskEstimateRepo(
  transfer: EstimateTransfer,
  db: DBClient = database,
): Promise<{ toTask: Task; fromTask: Task; change: EstimateChange } | undefined> {
  try {
    // A zero or negative transfer is a caller bug rather than a refusal: it
    // would move the minutes the other way while logging the opposite, which
    // is worse than not doing it at all. Zod at the boundary is the real
    // check; this is the backstop that keeps the log honest if a caller is
    // ever added without one.
    if (transfer.minutes <= 0) {
      throw new Error("A transfer must move a positive number of minutes");
    }

    return await runInTransaction(db, async (trx) => {
      // Both rows are read and LOCKED before either is written, which is
      // what makes "refused" and "written" mutually exclusive: after this no
      // concurrent transfer can spend the source's minutes underneath us,
      // and both updates are known to match. The alternative - update, then
      // discover the other task does not exist - has already debited the
      // source by the time it finds out, and would have to unwind by
      // throwing from inside the transaction.
      //
      // Ordered by id so two transfers over the same pair of tasks take
      // their locks in the same order and queue, rather than each holding
      // the row the other is waiting for.
      const locked = await trx
        .selectFrom("tasks")
        .selectAll()
        .where("id", "in", [transfer.fromTaskId, transfer.toTaskId])
        .where("projectId", "=", transfer.projectId)
        .orderBy("id")
        .forUpdate()
        .execute();

      // Two distinct rows in this project, or nothing. This is also what
      // catches a transfer into the task it came from, which returns one row
      // and is a no-op dressed up as an audit entry.
      if (locked.length !== 2) return undefined;

      const source = locked.find((task) => task.id === transfer.fromTaskId);
      if (!source || source.estimateMinutes < transfer.minutes) return undefined;

      const fromTask = await trx
        .updateTable("tasks")
        .set({
          estimateMinutes: sql<number>`estimate_minutes - ${transfer.minutes}`,
          updatedAt: new Date(),
        })
        .where("id", "=", transfer.fromTaskId)
        .returningAll()
        .executeTakeFirstOrThrow();

      const toTask = await trx
        .updateTable("tasks")
        .set({
          estimateMinutes: sql<number>`estimate_minutes + ${transfer.minutes}`,
          updatedAt: new Date(),
        })
        .where("id", "=", transfer.toTaskId)
        .returningAll()
        .executeTakeFirstOrThrow();

      // ONE row for the pair. A credit and a debit would double the apparent
      // movement when the log is summed, and would let half a transfer look
      // like a finished one.
      const change = await trx
        .insertInto("estimateChanges")
        .values({
          id: transfer.changeId,
          taskId: transfer.toTaskId,
          fromTaskId: transfer.fromTaskId,
          minutes: transfer.minutes,
          reason: transfer.reason,
          changedBy: transfer.changedBy,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return { toTask, fromTask, change };
    });
  } catch (error) {
    throw handleError("transferTaskEstimateRepo", error);
  }
}
