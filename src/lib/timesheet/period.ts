import { addDays, mondayOf } from "./daily-series";

// -------------------------------------------------------------------
// Reporting periods.
//
// One control drives the whole screen. Before this, the month drove the tables
// and the week drove the chart, so the two halves of a page could describe
// different spans of time and nothing said so.
//
// Pure: a granularity and an anchor date in, bounds and labels out. No clock -
// "today" is passed in where it is needed, because a function that read the
// machine clock could not be tested and would be wrong on a server in UTC.
// -------------------------------------------------------------------

export const GRANULARITIES = ["week", "fortnight", "month", "year"] as const;

export type Granularity = (typeof GRANULARITIES)[number];

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  week: "Week",
  fortnight: "Fortnight",
  month: "Month",
  year: "Year",
};

// How the chart buckets its bars for each granularity. A year of daily bars
// would be 365 slivers nobody can read or hover; a week of monthly bars would
// be one.
export function bucketFor(granularity: Granularity): "day" | "month" {
  return granularity === "year" ? "month" : "day";
}

export interface ResolvedPeriod {
  granularity: Granularity;
  // Inclusive bounds, 'YYYY-MM-DD'.
  start: string;
  end: string;
  // The first date actually covered: `start`, or the history floor when that
  // falls later. `start` stays the calendar truth because it is what the URL
  // carries, what the label is built from and what stepping works on - only
  // the RANGE moves. Everything that queries or measures capacity uses this.
  from: string;
  // True when `from` had to move, so a screen can say "August 2026" and still
  // admit it is only showing part of it.
  clipped: boolean;
  // False when the previous period lies entirely before the history floor, so
  // the back arrow can stop rather than walking into empty months forever.
  hasPrevious: boolean;
  // True when the whole period predates the records. Only reachable by editing
  // the URL, since hasPrevious blocks navigating there.
  beforeHistory: boolean;
  // "17-23 Aug 2026", "August 2026", "2026"
  label: string;
  // Anchors for the previous and next period of the same granularity.
  previousStart: string;
  nextStart: string;
  // False when the next period has not begun yet, so the arrow can be disabled
  // rather than walking forever into empty future periods.
  hasNext: boolean;
  // True when this IS the period containing today, so a "this week" control can
  // disable itself rather than looking like it does nothing.
  isCurrent: boolean;
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// The last day of the month containing `date`.
function endOfMonth(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  // Day 0 of the NEXT month is the last day of this one, and the Date
  // constructor rolls December into the following January on its own.
  const last = new Date(Date.UTC(year, month, 0));
  return last.toISOString().slice(0, 10);
}

function addMonths(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const shifted = new Date(Date.UTC(year, month - 1 + months, 1));
  return shifted.toISOString().slice(0, 10);
}

// -------------------------------------------------------------------
// Snap an anchor to the start of its period.
//
// Weeks and fortnights start on a Monday; months on the 1st; years on 1 Jan.
// Snapping means any date in a period resolves to the same period, so a link
// carrying the 15th and a link carrying the 20th both open the same month.
//
// A FORTNIGHT ENDS WITH THE CURRENT WEEK: "this fortnight" is this week and
// last week, never this week and next week.
//
// That is what somebody means when they ask for a fortnight - a look back over
// two weeks of work. It was previously aligned to a fixed epoch Monday, which
// partitioned the calendar consistently but put today in the FIRST half half
// the time, so the current fortnight showed a week that had not happened yet.
//
// The alignment reference is therefore the week containing `today` rather than
// a constant: boundaries fall every 14 days counting back from the start of
// last week. Within one request that is still a clean partition, and snapping
// is still idempotent - both weeks of a fortnight resolve to its start, and
// resolving a start returns itself. Stepping back and forward lands where it
// began.
//
// THE COST, and it is a real one: the partition is relative to the current
// week, so it shifts by seven days each week. A fortnight URL bookmarked today
// will show a span one week over in a fortnight's time. Saved reports are
// unaffected - they snapshot their own period label and start - but a shared
// link is not a stable identifier for a fortnight the way it is for a month.
// -------------------------------------------------------------------
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export function startOfPeriod(granularity: Granularity, anchor: string, today: string = anchor): string {
  switch (granularity) {
    case "week":
      return mondayOf(anchor);

    case "fortnight": {
      // The current fortnight starts at the Monday of LAST week, so it ends on
      // the Sunday of this one.
      const base = addDays(mondayOf(isValidDate(today) ? today : anchor), -7);

      const weeksFromBase = Math.round(
        (new Date(`${mondayOf(anchor)}T00:00:00Z`).getTime() - new Date(`${base}T00:00:00Z`).getTime()) /
          MS_PER_WEEK,
      );

      // Floor to an even number of weeks from that base, which is what makes a
      // date in either week of a fortnight resolve to the same start.
      const aligned = weeksFromBase - (((weeksFromBase % 2) + 2) % 2);

      return addDays(base, aligned * 7);
    }

    case "month":
      return `${anchor.slice(0, 7)}-01`;

    case "year":
      return `${anchor.slice(0, 4)}-01-01`;
  }
}

export function endOfPeriod(granularity: Granularity, start: string): string {
  switch (granularity) {
    case "week":
      return addDays(start, 6);
    case "fortnight":
      return addDays(start, 13);
    case "month":
      return endOfMonth(start);
    case "year":
      return `${start.slice(0, 4)}-12-31`;
  }
}

function labelFor(granularity: Granularity, start: string, end: string): string {
  if (granularity === "year") return start.slice(0, 4);

  if (granularity === "month") {
    return `${MONTH_LONG[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}`;
  }

  // Week and fortnight read as a span. The month is only repeated when the
  // span crosses one, so the common case stays short.
  const startDay = Number(start.slice(8, 10));
  const endDay = Number(end.slice(8, 10));
  const startMonth = MONTH_LABELS[Number(start.slice(5, 7)) - 1];
  const endMonth = MONTH_LABELS[Number(end.slice(5, 7)) - 1];
  const year = end.slice(0, 4);

  return start.slice(0, 7) === end.slice(0, 7)
    ? `${startDay}-${endDay} ${endMonth} ${year}`
    : `${startDay} ${startMonth}-${endDay} ${endMonth} ${year}`;
}

function step(granularity: Granularity, start: string, direction: 1 | -1): string {
  switch (granularity) {
    case "week":
      return addDays(start, 7 * direction);
    case "fortnight":
      return addDays(start, 14 * direction);
    case "month":
      return addMonths(start, direction);
    case "year":
      return `${Number(start.slice(0, 4)) + direction}-01-01`;
  }
}

// -------------------------------------------------------------------
// Resolve a granularity and anchor into a period.
//
// `today` decides only whether the next period is offered, and is passed in
// rather than read from the clock.
// -------------------------------------------------------------------
export function resolvePeriod(
  granularity: Granularity,
  anchor: string,
  today: string,
  // The first day with records, 'YYYY-MM-DD'. Optional, and undefined means no
  // floor at all - a project with no such date shows everything, which is the
  // only honest default when nobody has said when the records begin.
  historyStart?: string,
): ResolvedPeriod {
  // An unusable anchor falls back to today rather than throwing: a stale or
  // hand-edited link should show the current period, not an error page.
  const safeAnchor = isValidDate(anchor) ? anchor : today;

  const start = startOfPeriod(granularity, safeAnchor, today);
  const end = endOfPeriod(granularity, start);
  const nextStart = step(granularity, start, 1);
  const previousStart = step(granularity, start, -1);

  // A malformed floor is ignored rather than throwing. Dates are compared
  // lexicographically throughout - see the note in kysely-database-client.ts
  // about why these stay strings.
  const floor = historyStart && isValidDate(historyStart) ? historyStart : undefined;

  const beforeHistory = floor !== undefined && end < floor;

  // Never past `end`, or a period entirely before the floor would produce an
  // inverted range and a query that means nothing.
  const from = floor !== undefined && floor > start ? (floor > end ? end : floor) : start;

  return {
    granularity,
    start,
    end,
    from,
    clipped: from !== start,
    beforeHistory,
    label: labelFor(granularity, start, end),
    previousStart,
    nextStart,
    // Only offer the next period once it has actually begun.
    hasNext: nextStart <= today,
    // Symmetrical: only offer the previous one if any of it is on record. The
    // period containing the floor is the last one you can step back to.
    hasPrevious: floor === undefined || endOfPeriod(granularity, previousStart) >= floor,
    isCurrent: start === startOfPeriod(granularity, today, today),
  };
}

export function isGranularity(value: unknown): value is Granularity {
  return typeof value === "string" && (GRANULARITIES as readonly string[]).includes(value);
}
