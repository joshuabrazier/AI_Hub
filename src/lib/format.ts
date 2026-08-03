import { format, parseISO } from "date-fns";

import { APP_TIME_ZONE } from "./timezone";

// -------------------------------------------------------------------
// Shared display formatters
// One home for the small date and time helpers that would otherwise be copied
// across table columns and dialogs.
// -------------------------------------------------------------------

// Timestamps are stored in UTC (Postgres timestamptz) and the server usually
// runs in UTC too, so a plain date-fns format() renders UTC - a 5:22 PM action
// would display as 7:52 AM. Convert explicitly to the app zone so activity and
// audit times read correctly wherever the server or the viewer is. Intl handles
// the daylight-saving switch.
//
// The zone comes from src/lib/timezone.ts, which reads it from the environment.
// Do not hardcode a zone here - that is how it ended up defined twice.
const appDateTimeFormat = new Intl.DateTimeFormat("en-AU", {
  timeZone: APP_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

// Format a timestamp (Date or ISO string) in the app's timezone, e.g.
// "20 Jul 2026, 5:22 PM". Returns the raw input if it cannot be parsed.
export function formatDateTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  const parts = appDateTimeFormat.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}

// Format a 'YYYY-MM-DD' string, e.g. "20 Jul 2026". Falls back to the raw
// string if it cannot be parsed.
export function formatIsoDate(isoDate: string, dateFormat = "d MMM yyyy"): string {
  try {
    return format(parseISO(isoDate), dateFormat);
  } catch {
    return isoDate;
  }
}

// Format a 24-hour time string ("HH:MM" or "HH:MM:SS") as 12-hour "9:00 AM".
// Falls back to the raw string if it cannot be parsed.
export function formatTime(time: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return time;
  const hour = Number(match[1]);
  if (hour > 23) return time;
  const period = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${match[2]} ${period}`;
}

// Format a start/end pair as "9:00 AM to 9:30 AM".
export function formatTimeRange(start: string, end: string): string {
  return `${formatTime(start)} to ${formatTime(end)}`;
}

// Format a start/end date pair as "20 Jul 2026 to 25 Sep 2026". A class carries
// its own date range now that terms are gone, so this is shown often.
export function formatDateRange(startIsoDate: string, endIsoDate: string): string {
  return `${formatIsoDate(startIsoDate)} to ${formatIsoDate(endIsoDate)}`;
}
