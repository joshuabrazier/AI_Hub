import { format, parseISO, startOfWeek } from "date-fns";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// -------------------------------------------------------------------
// Normalise any date to that week's Monday ('YYYY-MM-DD').
//
// THE one definition of "which week is this", shared by every screen that shows
// a week, so two of them cannot answer it differently.
//
// The date usually arrives from a query string, so it can be anything. Two
// fallbacks matter: a value of the wrong shape, and one of the right shape that
// is not a real date ('2026-13-45'), which parseISO turns into an Invalid Date
// and format renders as "Invalid Date" - silently emptying the screen.
//
// Both fall back to `todayIso`, which callers pass as the app-zone calendar day
// (todayInAppZone). Anchoring on `new Date()` instead would let a server
// running in UTC open a different week than the rest of the app is showing.
// -------------------------------------------------------------------
export function toMondayIso(dateIso: string | undefined, todayIso: string): string {
  const candidate = dateIso !== undefined && ISO_DATE_RE.test(dateIso) ? parseISO(dateIso) : new Date(NaN);
  const anchor = Number.isNaN(candidate.getTime()) ? parseISO(todayIso) : candidate;

  return format(startOfWeek(anchor, { weekStartsOn: 1 }), "yyyy-MM-dd");
}
