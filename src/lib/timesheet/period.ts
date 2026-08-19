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
// A fortnight is anchored to a FIXED epoch Monday rather than to whatever
// Monday the anchor happens to fall in. Without that, stepping back a
// fortnight then forward again could land on a different pair of weeks, and
// two people comparing "this fortnight" would see different spans.
// -------------------------------------------------------------------
const FORTNIGHT_EPOCH = "2024-01-01"; // A Monday.

export function startOfPeriod(granularity: Granularity, anchor: string): string {
  switch (granularity) {
    case "week":
      return mondayOf(anchor);

    case "fortnight": {
      const monday = mondayOf(anchor);
      const epoch = new Date(`${FORTNIGHT_EPOCH}T00:00:00Z`).getTime();
      const current = new Date(`${monday}T00:00:00Z`).getTime();
      const weeksSinceEpoch = Math.floor((current - epoch) / (7 * 24 * 60 * 60 * 1000));
      // Round down to an even number of weeks from the epoch.
      const aligned = weeksSinceEpoch - (((weeksSinceEpoch % 2) + 2) % 2);
      return addDays(FORTNIGHT_EPOCH, aligned * 7);
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
export function resolvePeriod(granularity: Granularity, anchor: string, today: string): ResolvedPeriod {
  // An unusable anchor falls back to today rather than throwing: a stale or
  // hand-edited link should show the current period, not an error page.
  const safeAnchor = isValidDate(anchor) ? anchor : today;

  const start = startOfPeriod(granularity, safeAnchor);
  const end = endOfPeriod(granularity, start);
  const nextStart = step(granularity, start, 1);

  return {
    granularity,
    start,
    end,
    label: labelFor(granularity, start, end),
    previousStart: step(granularity, start, -1),
    nextStart,
    // Only offer the next period once it has actually begun.
    hasNext: nextStart <= today,
    isCurrent: start === startOfPeriod(granularity, today),
  };
}

export function isGranularity(value: unknown): value is Granularity {
  return typeof value === "string" && (GRANULARITIES as readonly string[]).includes(value);
}
