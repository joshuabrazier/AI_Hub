import { MAX_TIMESHEET_ADDED_ROWS } from "../delivery.types";

// -------------------------------------------------------------------
// ===================================================================
// THE EMPTY ROWS SOMEBODY ADDED TO A WEEK, HELD BY THE BROWSER
// ===================================================================
//
// A row added to a timesheet and not yet typed into is a piece of somebody's
// screen rather than a fact about the business, and addTimesheetRowService
// writes NOTHING. Its comment sets out the three places such a row could
// live and why this is the one: there is no `timesheet_week_rows` table, and
// a zero-minute time entry is refused by the database (and would be wrong
// even if it were not - it would carry a rate snapshot and appear on a
// client's budget report as work).
//
// So the browser holds the ids and hands them back to the week read as
// `addedTaskIds`, where EVERY ONE IS RE-AUTHORISED against that person's own
// membership. Nothing here is trusted by anything: a tampered store gets a
// week with fewer rows in it, not a row it should not have.
//
// LOCAL RATHER THAN SESSION STORAGE. The requirement is that a row survives
// a page reload, and both do that - but sessionStorage is per TAB, so
// closing the tab at lunchtime would lose the rows somebody set up in the
// morning, which is the ordinary way this screen is used. The cost is that
// the store outlives the week it belongs to, which is what the pruning below
// is for.
//
// KEYED BY USER AND BY WEEK. A shared machine must not show one person's
// added rows on another's timesheet - the ids would be refused by the
// service, so it is a tidiness matter rather than a leak, but a row that
// silently disappears is worse than one that was never offered.
// -------------------------------------------------------------------

// Versioned, so a change of shape is a new key rather than a parse of
// something that no longer means what it says.
const STORAGE_KEY = "delivery.timesheet.added-rows.v1";

// -------------------------------------------------------------------
// How many weeks are kept per person before the oldest are dropped.
//
// The store is furniture and nothing reads a week that has gone by, so this
// is only about not growing without limit on a machine somebody uses every
// day for a year. Eight is roughly two months, which covers going back to
// last month's timesheet and finding it as it was left.
// -------------------------------------------------------------------
const MAX_WEEKS_KEPT = 8;

type AddedRowStore = Record<string, Record<string, string[]>>;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

// -------------------------------------------------------------------
// Read the store, or an empty one.
//
// EVERY LAYER IS CHECKED rather than cast. This is a value out of a store
// the app does not control: another tab, an older version of this file or
// somebody with the console open can leave anything at all in it, and a
// `JSON.parse` result asserted as the type would put a number where the
// grid expects a task id and crash the screen.
// -------------------------------------------------------------------
function readStore(): AddedRowStore {
  if (!isBrowser()) return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

    const store: AddedRowStore = {};

    for (const [userId, weeks] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof weeks !== "object" || weeks === null || Array.isArray(weeks)) continue;

      const byWeek: Record<string, string[]> = {};

      for (const [weekStart, taskIds] of Object.entries(weeks as Record<string, unknown>)) {
        if (!Array.isArray(taskIds)) continue;

        byWeek[weekStart] = taskIds.filter((taskId): taskId is string => typeof taskId === "string");
      }

      store[userId] = byWeek;
    }

    return store;
  } catch {
    // A quota error, a private-browsing refusal, or JSON somebody else wrote.
    // An empty store means the week opens with the rows that have time on
    // them, which is a working screen rather than a broken one.
    return {};
  }
}

function writeStore(store: AddedRowStore): void {
  if (!isBrowser()) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage is full or refused. The rows already on screen stay; they just
    // will not come back after a reload. Nothing to say to somebody about it
    // that they could act on.
  }
}

/**
 * The empty rows this person added to this week, capped as the service caps
 * them so a stale store cannot make the request bigger than the read will
 * accept.
 */
export function readAddedRows(userId: string, weekStart: string): string[] {
  return (readStore()[userId]?.[weekStart] ?? []).slice(0, MAX_TIMESHEET_ADDED_ROWS);
}

// -------------------------------------------------------------------
// Replace the list for one week.
//
// The caller passes the WHOLE list rather than a delta, for the same reason
// project membership is posted as a set: the grid always knows the complete
// answer - it is the rows on screen with no time on them - and a delta that
// fails to apply leaves the store describing a screen nobody is looking at.
//
// Old weeks are pruned on the way past. Week starts are 'YYYY-MM-DD', so
// they sort lexicographically and the newest are the last ones.
// -------------------------------------------------------------------
export function writeAddedRows(userId: string, weekStart: string, taskIds: readonly string[]): void {
  const store = readStore();
  const weeks = { ...(store[userId] ?? {}) };

  const unique = [...new Set(taskIds)].slice(0, MAX_TIMESHEET_ADDED_ROWS);

  if (unique.length === 0) delete weeks[weekStart];
  else weeks[weekStart] = unique;

  const keptWeeks = Object.keys(weeks).sort().slice(-MAX_WEEKS_KEPT);

  const pruned: Record<string, string[]> = {};

  for (const keptWeek of keptWeeks) pruned[keptWeek] = weeks[keptWeek];

  writeStore({ ...store, [userId]: pruned });
}
