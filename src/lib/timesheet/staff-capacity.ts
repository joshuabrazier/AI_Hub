// -------------------------------------------------------------------
// Staff capacity and targets
//
// Turns a person's contracted arrangement into the capacity a period is
// measured against, and compares what they logged with what was expected.
//
// Pure, like the rest of the engine: dates in, numbers out, no clock and no
// I/O. The reason this exists at all is that a single company-wide "7.5h times
// five days" makes anyone on a part-time arrangement look like they are
// failing. Somebody contracted to three days who works three full days is at
// 100%, not 60%, and a dashboard that says otherwise gets ignored.
// -------------------------------------------------------------------

const MINUTES_PER_HOUR = 60;
const DAYS_PER_FULL_WEEK = 5;

// Days are stored in tenths and hours in minutes, both integers. See migration
// 003 for why nothing here is NUMERIC.
export const DEFAULT_WORKING_DAYS_TENTHS = 50;
export const DEFAULT_MINUTES_PER_DAY = 450;

export interface StaffTargetInput {
  personId: string;
  personName?: string | null;
  workingDaysTenths: number;
  minutesPerDay: number;
  // ISO weekday numbers, 1 = Monday through 7 = Sunday. Null when only a count
  // is recorded, which is the state every row started in.
  workingWeekdays?: number[] | null;
  // 0-100, or null when nobody has set one.
  billableTargetPercent: number | null;
}

export interface StaffCapacity {
  personId: string;
  // WHICH days they work, as ISO weekday numbers, or null when nobody has said.
  //
  // Null is the honest default and the engine falls back to prorating a count
  // across every weekday - see capacityHoursForRange. It is null rather than
  // an empty array on purpose: an empty array would mean "works no days",
  // which is a real and very different arrangement.
  workingWeekdays: number[] | null;
  // Contracted days per week, as a readable number: 3, 4.5, 5.
  workingDaysPerWeek: number;
  hoursPerDay: number;
  // Their full week if they worked every contracted day.
  weeklyHours: number;
  billableTargetPercent: number | null;
  // True when no row exists and the company default is standing in. Shown in
  // the UI so an assumed target is never mistaken for an agreed one.
  isDefault: boolean;
}

export function toStaffCapacity(target: StaffTargetInput | null, personId: string): StaffCapacity {
  const workingDaysTenths = target?.workingDaysTenths ?? DEFAULT_WORKING_DAYS_TENTHS;
  const minutesPerDay = target?.minutesPerDay ?? DEFAULT_MINUTES_PER_DAY;

  const workingDaysPerWeek = workingDaysTenths / 10;
  const hoursPerDay = minutesPerDay / MINUTES_PER_HOUR;

  return {
    personId,
    workingWeekdays: target?.workingWeekdays?.length ? [...target.workingWeekdays].sort((a, b) => a - b) : null,
    workingDaysPerWeek,
    hoursPerDay,
    weeklyHours: round(workingDaysPerWeek * hoursPerDay),
    billableTargetPercent: target?.billableTargetPercent ?? null,
    isDefault: target === null,
  };
}

// -------------------------------------------------------------------
// Capacity for a period, prorated by the working days it contains.
//
// A month is not a whole number of weeks, so the weekly figure cannot simply
// be multiplied. Capacity is the period's weekday count scaled by the share of
// a full week the person actually works: somebody on 3 days has 3/5 of the
// capacity of each weekday in the period.
//
// Weekdays are counted rather than calendar days, so a month with 21 working
// days does not credit somebody with capacity for its weekends.
// -------------------------------------------------------------------
export function capacityHoursForPeriod(capacity: StaffCapacity, weekdaysInPeriod: number): number {
  if (weekdaysInPeriod <= 0) return 0;
  const share = capacity.workingDaysPerWeek / DAYS_PER_FULL_WEEK;
  return round(weekdaysInPeriod * share * capacity.hoursPerDay);
}

export interface StaffPerformance {
  loggedHours: number;
  capacityHours: number;
  // logged / capacity. Null when there is no capacity to measure against -
  // somebody contracted to zero days, or a period with no working days.
  utilisation: number | null;
  billableHours: number;
  // billable / logged. Null when nothing was logged, which is not the same as
  // nought per cent billable.
  billableShare: number | null;
  billableTargetPercent: number | null;
  // Percentage points above or below the billable target. Null when no target
  // is set or nothing was logged. Positive is ahead.
  billableVariance: number | null;
  // True when a target exists and has been met.
  meetsBillableTarget: boolean | null;
}

// Takes a WEEKDAY COUNT, so it can only ever prorate. Kept for callers that
// have a count and no dates; anything holding a real date range should use
// measureAgainstCapacity with capacityHoursForRange, which can place a
// part-timer's hours on the days they actually work.
export function measureAgainstTarget(
  capacity: StaffCapacity,
  weekdaysInPeriod: number,
  loggedHours: number,
  billableHours: number,
): StaffPerformance {
  return measureAgainstCapacity(
    capacity,
    capacityHoursForPeriod(capacity, weekdaysInPeriod),
    loggedHours,
    billableHours,
  );
}

// The same measurement against a capacity the caller has already worked out.
export function measureAgainstCapacity(
  capacity: StaffCapacity,
  capacityHours: number,
  loggedHours: number,
  billableHours: number,
): StaffPerformance {
  const billableShare = loggedHours > 0 ? round(billableHours / loggedHours) : null;

  const billableVariance =
    capacity.billableTargetPercent !== null && billableShare !== null
      ? round(billableShare * 100 - capacity.billableTargetPercent)
      : null;

  return {
    loggedHours: round(loggedHours),
    capacityHours,
    utilisation: capacityHours > 0 ? round(loggedHours / capacityHours) : null,
    billableHours: round(billableHours),
    billableShare,
    billableTargetPercent: capacity.billableTargetPercent,
    billableVariance,
    // Strictly "reached or exceeded". A target of 90% met at exactly 90% has
    // been met, so this is >= rather than >.
    meetsBillableTarget: billableVariance === null ? null : billableVariance >= 0,
  };
}

// Count the Monday-to-Friday days in an inclusive 'YYYY-MM-DD' range.
//
// UTC arithmetic on date-only values: there is no wall clock involved, so
// there is no offset to get wrong. Parsing in a local zone is what shifts a
// month boundary by a day.
export function countWeekdays(from: string, to: string): number {
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return 0;

  let weekdays = 0;
  while (cursor.getTime() <= end.getTime()) {
    const day = cursor.getUTCDay();
    if (day >= 1 && day <= 5) weekdays += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return weekdays;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

// -------------------------------------------------------------------
// Capacity for an actual DATE RANGE rather than a count of weekdays.
//
// WHEN THE WORKING DAYS ARE KNOWN this counts the person's own days inside the
// range: somebody on Monday, Tuesday and Wednesday has capacity on exactly
// those dates, and none at all in a week they do not work. That is a better
// answer than prorating in every case, and a much better one at short ranges -
// over a single week, three fifths of a day on five days is a figure that can
// never be the actual.
//
// WHEN THEY ARE NOT KNOWN it falls back to capacityHoursForPeriod, which
// spreads the contracted count across every weekday exactly as before. Nothing
// in this system knows which days somebody works until they say so, and an
// average is the honest answer to an unanswered question.
//
// Half days live in the tenths, not in the list: an arrangement of 4.5 days
// keeps prorating even with days chosen, because a list of whole weekdays
// cannot express a half. See migration 009.
// -------------------------------------------------------------------
export function capacityHoursForRange(capacity: StaffCapacity, from: string, to: string): number {
  const days = capacity.workingWeekdays;

  // A whole number of contracted days is the case a day list can express
  // exactly. Anything else keeps the prorated answer.
  const wholeDays = Number.isInteger(capacity.workingDaysPerWeek);

  if (days && days.length > 0 && wholeDays) {
    return round(countWeekdaysMatching(from, to, days) * capacity.hoursPerDay);
  }

  return capacityHoursForPeriod(capacity, countWeekdays(from, to));
}

// -------------------------------------------------------------------
// How many days in an inclusive range fall on one of the given ISO weekdays.
//
// UTC arithmetic on date-only strings, the same reasoning as countWeekdays
// above: these values carry no wall clock, so parsing them in a local zone is
// what moves a Monday onto the previous Sunday.
// -------------------------------------------------------------------
export function countWeekdaysMatching(from: string, to: string, isoWeekdays: number[]): number {
  const wanted = new Set(isoWeekdays);
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return 0;

  let count = 0;

  while (cursor.getTime() <= end.getTime()) {
    // getUTCDay is 0 = Sunday; ISO is 7 = Sunday.
    const iso = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay();
    if (wanted.has(iso)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return count;
}

// The weekdays a person works, in an inclusive range, as dates. The forecast
// needs the actual days rather than a count so it can price each at the rate in
// force on it.
export function workingDatesInRange(capacity: StaffCapacity, from: string, to: string): string[] {
  const days = capacity.workingWeekdays;
  if (!days || days.length === 0) return [];

  const wanted = new Set(days);
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return dates;

  while (cursor.getTime() <= end.getTime()) {
    const iso = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay();
    if (wanted.has(iso)) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

export const ISO_WEEKDAY_LABELS: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};
