import { PersonDayTotal } from "./timesheet.types";

// -------------------------------------------------------------------
// Daily series: capacity against what was actually booked.
//
// Pure, like the rest of the engine. No I/O, no clock - the period bounds and
// the working week are passed in, because a function that decided for itself
// what "today" or "a working day" meant could not be tested and would be wrong
// on any server not in Adelaide.
//
// The point of the series is the COMPARISON. A bar chart of logged hours alone
// says nothing about whether a day was full; drawn against capacity, a short
// day is visibly short. That is why every working day in the period gets a
// slot, including the ones with nothing booked - those are the days the chart
// exists to show.
// -------------------------------------------------------------------

const SECONDS_PER_HOUR = 3600;

// Monday to Friday. Weekends appear only when somebody actually worked one:
// drawing five weekday slots plus two empty weekend slots every week would
// make every chart 28% empty space and imply Saturday was a missed target.
const DEFAULT_WORKING_WEEKDAYS = [1, 2, 3, 4, 5];

export interface DailyPoint {
  // 'YYYY-MM-DD'
  date: string;
  // Mon, Tue, ...
  weekdayLabel: string;
  dayOfMonth: number;
  isWorkingDay: boolean;
  billableHours: number;
  nonBillableHours: number;
  // Booked, but nobody has said whether it bills. Its own band, because
  // folding it into either of the others would state something nobody has
  // decided.
  unsetHours: number;
  loggedHours: number;
  // The full day this is measured against. Zero on a non-working day, so a
  // Saturday's bar is not judged against a target nobody set.
  capacityHours: number;
}

export interface DailySeries {
  points: DailyPoint[];
  // The tallest thing the chart has to fit, so the y-axis can be sized once.
  maxHours: number;
  capacityHours: number;
  totals: {
    billableHours: number;
    nonBillableHours: number;
    unsetHours: number;
    loggedHours: number;
    // Working days in the period times a full day.
    availableHours: number;
    workingDays: number;
    // logged / available. Null when the period contains no working days.
    utilisation: number | null;
    // billable / logged. Null when nothing was logged - which is not the same
    // as nought per cent billable.
    billableShare: number | null;
  };
}

// Every date from `from` to `to` inclusive, as 'YYYY-MM-DD'.
//
// Built by stepping a UTC date and formatting it back to a string. UTC is safe
// here BECAUSE the values are date-only: there is no wall clock involved, so
// there is no offset to get wrong. The alternative - parsing in a local zone -
// is what shifts a month boundary by a day.
function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  // A malformed range yields nothing rather than looping forever.
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return dates;

  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// -------------------------------------------------------------------
// Week helpers. Pure string arithmetic on 'YYYY-MM-DD', done in UTC because
// the values are date-only - there is no wall clock, so there is no offset to
// get wrong. Parsing in a local zone is what shifts a week boundary by a day.
// -------------------------------------------------------------------

// The Monday of the week containing `date`. ISO weeks, so a Sunday belongs to
// the week that started six days earlier, not the one about to begin.
export function mondayOf(date: string): string {
  const cursor = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime())) return date;

  const weekday = cursor.getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  cursor.setUTCDate(cursor.getUTCDate() - daysSinceMonday);

  return cursor.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const cursor = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime())) return date;
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

export function buildDailySeries(
  personDays: PersonDayTotal[],
  options: {
    from: string;
    to: string;
    capacityHours: number;
    workingWeekdays?: number[];
    // Keep weekend slots even when nothing was booked on them. A week view
    // shows Monday to Sunday because the shape of the week is the point; a
    // month view drops empty weekends so the chart is not a third blank.
    includeNonWorkingDays?: boolean;
    // The contracted capacity for the whole window, when it differs from
    // "every weekday is a full day".
    //
    // Somebody on three days a week has 22.5h available in a week, not 37.5h,
    // and measuring them against five days reports 60% when they have worked a
    // full week. Which three days they choose is not recorded and does not
    // matter: the per-day track still shows what a full day looks like, while
    // the WEEK total is what their utilisation is measured against.
    availableHoursOverride?: number;
  },
): DailySeries {
  const { from, to, capacityHours } = options;
  const workingWeekdays = options.workingWeekdays ?? DEFAULT_WORKING_WEEKDAYS;
  const includeNonWorkingDays = options.includeNonWorkingDays ?? false;

  // Several people can share a date once the view is not filtered to one
  // person, so the day totals are summed per date rather than assumed unique.
  const byDate = new Map<string, { billable: number; nonBillable: number; unset: number }>();

  for (const day of personDays) {
    const existing = byDate.get(day.workDate) ?? { billable: 0, nonBillable: 0, unset: 0 };
    existing.billable += day.split.billableSeconds;
    existing.nonBillable += day.split.nonBillableSeconds;
    existing.unset += day.split.unsetSeconds;
    byDate.set(day.workDate, existing);
  }

  const points: DailyPoint[] = [];

  for (const date of eachDate(from, to)) {
    const booked = byDate.get(date);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const isWorkingDay = workingWeekdays.includes(weekday);

    // A weekend with nothing booked is skipped unless the caller wants the
    // full week. A weekend with time on it is always kept, because somebody
    // worked it.
    if (!isWorkingDay && !booked && !includeNonWorkingDays) continue;

    const billableHours = (booked?.billable ?? 0) / SECONDS_PER_HOUR;
    const nonBillableHours = (booked?.nonBillable ?? 0) / SECONDS_PER_HOUR;
    const unsetHours = (booked?.unset ?? 0) / SECONDS_PER_HOUR;

    points.push({
      date,
      weekdayLabel: WEEKDAY_LABELS[weekday],
      dayOfMonth: Number(date.slice(8, 10)),
      isWorkingDay,
      billableHours,
      nonBillableHours,
      unsetHours,
      loggedHours: billableHours + nonBillableHours + unsetHours,
      capacityHours: isWorkingDay ? capacityHours : 0,
    });
  }

  const workingDays = points.filter((point) => point.isWorkingDay).length;
  const billable = points.reduce((total, point) => total + point.billableHours, 0);
  const nonBillable = points.reduce((total, point) => total + point.nonBillableHours, 0);
  const unset = points.reduce((total, point) => total + point.unsetHours, 0);
  const logged = billable + nonBillable + unset;
  const available = options.availableHoursOverride ?? workingDays * capacityHours;

  // The y-axis has to clear both the tallest bar and the capacity line, or an
  // over-capacity day would be drawn outside the plot.
  const maxLogged = points.reduce((max, point) => Math.max(max, point.loggedHours), 0);

  return {
    points,
    maxHours: Math.max(maxLogged, capacityHours),
    capacityHours,
    totals: {
      billableHours: round(billable),
      nonBillableHours: round(nonBillable),
      unsetHours: round(unset),
      loggedHours: round(logged),
      availableHours: round(available),
      workingDays,
      utilisation: available > 0 ? round(logged / available) : null,
      billableShare: logged > 0 ? round(billable / logged) : null,
    },
  };
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
