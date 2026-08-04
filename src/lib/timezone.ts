import { envClient } from "./env-client";

// -------------------------------------------------------------------
// Application timezone
//
// THE one place the app's timezone is defined. Set NEXT_PUBLIC_APP_TIME_ZONE
// to any IANA zone; everything that formats or compares a local date reads it
// from here.
//
// Why it matters: timestamps are stored in UTC and the server usually runs in
// UTC too, so anything that renders a time, or asks "what day is it today",
// MUST convert explicitly - otherwise it is wrong by the offset, and wrong in a
// way that only shows up either side of midnight.
//
// Two rules follow, and they hold for any date logic added on top of this base:
//
//   - never use `new Date()` to decide what calendar day it is; derive the day
//     in this zone instead (see formatDateTime in format.ts for the pattern),
//   - never hardcode a zone anywhere else. It ended up defined twice once
//     already, and the copies disagreed.
// -------------------------------------------------------------------
export const APP_TIME_ZONE = envClient.NEXT_PUBLIC_APP_TIME_ZONE;
