import { addDays, format, getDay, parseISO } from "date-fns";

import type { ClassScheduleDay, SessionInput } from "./admin-classes.types";

// date-fns getDay(): 0 = Sunday ... 6 = Saturday
const DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

// A class cannot run forever: this bounds the loop below so a mistyped end date
// (year 2999) produces a refusable list rather than hanging the dialog. 400
// weeks is about seven and a half years of one weekday.
const MAX_OCCURRENCES_PER_DAY = 400;

// -------------------------------------------------------------------
// Every occurrence of `dayOfWeek` between a class's start and end date
// (inclusive), as 'YYYY-MM-DD'. [] for an unknown day or an inverted range.
//
// The range is the CLASS's own start/end dates. Terms are gone: a class carries
// the window it runs in, so nothing outside it decides when its sessions fall.
// -------------------------------------------------------------------
export function generateWeeklySessionDates(
  startDateIso: string,
  endDateIso: string,
  dayOfWeek: string,
): string[] {
  const target = DAY_INDEX[dayOfWeek];
  if (target === undefined) return [];

  const start = parseISO(startDateIso);
  const end = parseISO(endDateIso);
  if (start > end) return [];

  // Step forward to the first matching weekday on or after the start date.
  const offset = (target - getDay(start) + 7) % 7;
  let cursor = addDays(start, offset);

  const dates: string[] = [];
  let guard = 0;
  while (cursor <= end && guard < MAX_OCCURRENCES_PER_DAY) {
    dates.push(format(cursor, "yyyy-MM-dd"));
    cursor = addDays(cursor, 7);
    guard += 1;
  }

  return dates;
}

// -------------------------------------------------------------------
// Build the session list for a class's per-day schedule: every day's weekly
// occurrences across the class's date range, each carrying that day's times.
// Sorted by date then start time. Used by the class dialog's live preview.
// -------------------------------------------------------------------
export function buildScheduleSessions(
  startDateIso: string,
  endDateIso: string,
  schedule: ClassScheduleDay[],
): SessionInput[] {
  const sessions = schedule.flatMap((slot) =>
    generateWeeklySessionDates(startDateIso, endDateIso, slot.day).map((date) => ({
      sessionDate: date,
      sessionStart: slot.startTime,
      sessionEnd: slot.endTime,
    })),
  );

  // Dates are 'YYYY-MM-DD' and times 'HH:MM', so both sort lexicographically -
  // no Date conversion, and no timezone to get wrong.
  return sessions.sort((a, b) =>
    a.sessionDate === b.sessionDate
      ? a.sessionStart.localeCompare(b.sessionStart)
      : a.sessionDate.localeCompare(b.sessionDate),
  );
}
