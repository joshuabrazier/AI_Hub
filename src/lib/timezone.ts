import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

import { envClient } from "./env-client";

// -------------------------------------------------------------------
// Application timezone
//
// THE one place the app's timezone is defined. Set NEXT_PUBLIC_APP_TIME_ZONE
// to any IANA zone; everything that formats or compares a local date reads it
// from here.
//
// Why it matters: session times are stored as wall-clock values (a DATE plus a
// TIME with no zone) while the server usually runs in UTC. So any comparison of
// a stored session time against "now", and any question of "what day is it
// today", MUST convert explicitly - otherwise it is wrong by the offset, and
// wrong in a way that only shows up either side of midnight. date-fns-tz
// handles daylight saving automatically.
// -------------------------------------------------------------------
export const APP_TIME_ZONE = envClient.NEXT_PUBLIC_APP_TIME_ZONE;

// The true UTC instant of a session that starts at the given local wall-clock
// date ("yyyy-MM-dd") and time ("HH:MM" or "HH:MM:SS"). Compare this against
// `new Date()` for correct "how long until / has it started" logic on any server.
export function sessionStartsAt(date: string, start: string): Date {
  return fromZonedTime(`${date}T${start}`, APP_TIME_ZONE);
}

// Today's calendar date in the app zone as "yyyy-MM-dd", regardless of the
// server's zone. Use this rather than `format(new Date(), "yyyy-MM-dd")` for
// any day comparison.
export function todayInAppZone(): string {
  return formatInTimeZone(new Date(), APP_TIME_ZONE, "yyyy-MM-dd");
}

// The current instant expressed as an app-zone wall-clock Date, so date-fns
// helpers that read local fields (startOfDay, getMonth, getDate) reflect the
// app zone rather than the server's clock.
export function nowInAppZone(): Date {
  return toZonedTime(new Date(), APP_TIME_ZONE);
}
