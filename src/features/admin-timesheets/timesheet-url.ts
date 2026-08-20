import { ALL_CATEGORIES, type TimesheetFiltersDTO } from "./admin-timesheets.types";

// -------------------------------------------------------------------
// The filter half of a timesheet URL.
//
// ITS OWN MODULE, WITH NO "use client", and that is not tidiness. Both the
// client filter controls and the server-rendered shell need this function. A
// plain function exported from a "use client" module becomes a CLIENT
// REFERENCE when a Server Component imports it, and calling it on the server
// throws at request time - something the type checker cannot see. So it lives
// where both sides may genuinely call it.
//
// One implementation, used by both, because two builders writing the same
// params separately is how a filter comes to survive a dropdown change and
// then vanish when you step the period.
//
// Defaults are left out entirely, so a plain link stays short rather than
// carrying "&category=all&project=all&person=all".
//
// PEOPLE serialise as a comma list into the existing `person` parameter, so
// every link already in somebody's history keeps working and a single
// selection still reads as `?person=<id>`.
// -------------------------------------------------------------------
export function appendFilterParams(params: URLSearchParams, filters: TimesheetFiltersDTO): void {
  if (filters.category !== ALL_CATEGORIES) params.set("category", filters.category);
  if (filters.project !== ALL_CATEGORIES) params.set("project", filters.project);
  if (filters.people.length > 0) params.set("person", filters.people.join(","));
  if (filters.billable !== ALL_CATEGORIES) params.set("billable", filters.billable);
}
