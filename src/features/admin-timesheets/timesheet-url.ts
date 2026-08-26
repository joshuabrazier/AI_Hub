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
// DEFENSIVE ABOUT `people` AND `billable`, deliberately, even though the type
// says they are always there.
//
// This runs inside a startTransition in the filter controls, and a throw there
// does not surface as an error - it leaves isPending true for ever, and the
// tabs are disabled while pending. So the failure mode of one undefined field
// is a filter bar that looks permanently stuck rather than anything that says
// what went wrong.
//
// The realistic way it happens is a version skew: a page rendered by one build
// being navigated by a client bundle from another, which is ordinary during a
// deploy. Falling back costs nothing and keeps navigation working.
export function appendFilterParams(params: URLSearchParams, filters: TimesheetFiltersDTO): void {
  if (filters.category && filters.category !== ALL_CATEGORIES) params.set("category", filters.category);
  if (filters.client && filters.client !== ALL_CATEGORIES) params.set("client", filters.client);
  if (filters.project && filters.project !== ALL_CATEGORIES) params.set("project", filters.project);

  // `person` is the single-value field every older link used, so it is the
  // fallback when `people` is absent.
  const people = filters.people ?? (filters.person && filters.person !== ALL_CATEGORIES ? [filters.person] : []);
  if (people.length > 0) params.set("person", people.join(","));

  if (filters.billable && filters.billable !== ALL_CATEGORIES) params.set("billable", filters.billable);
}
