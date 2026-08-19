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
  // 0-100, or null when nobody has set one.
  billableTargetPercent: number | null;
}

export interface StaffCapacity {
  personId: string;
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

export function measureAgainstTarget(
  capacity: StaffCapacity,
  weekdaysInPeriod: number,
  loggedHours: number,
  billableHours: number,
): StaffPerformance {
  const capacityHours = capacityHoursForPeriod(capacity, weekdaysInPeriod);
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
