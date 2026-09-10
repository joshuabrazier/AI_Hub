// -------------------------------------------------------------------
// Admin dashboard DTOs
//
// The dashboard is read-only, so there are no request schemas here - nothing
// on this page takes an argument. Every figure below is counted server-side
// from the whole database: the page is admin-only, and an admin's scope is
// every team. A team-scoped overview is the manager's /manage area, which
// resolves its own scope from the session rather than reusing these.
// -------------------------------------------------------------------

// The headline counts across the top of the page.
export type DashboardStatsDTO = {
  // A de-identified account is excluded as well as a deactivated one: its
  // personal data is gone, so it is a retained row rather than a person still
  // using the product.
  activeMembers: number;
  // Admins and managers with a usable account.
  activeStaff: number;
  // -----------------------------------------------------------------
  // Projects at status 'active' - the work actually in flight.
  //
  // THIS TILE USED TO BE PENDING INVITATIONS, and it was reporting on a door
  // nobody comes through. Sign-in is Microsoft only and the app
  // AUTO-PROVISIONS anyone on an allowed domain, so an invitation is no
  // longer a gate - it is a ROLE pre-assignment for somebody who has not
  // signed in yet, and this deployment does not use them. A headline count
  // that is structurally zero teaches people to stop reading the row it
  // sits in.
  //
  // 'active' specifically, not "not archived": on hold and completed are
  // both live rows and neither is work in flight. Archived is the module's
  // soft delete.
  // -----------------------------------------------------------------
  activeProjects: number;
};

export type AdminDashboardDTO = {
  // What to greet the admin by, taken from the session. Null when their
  // account has no usable name.
  firstName: string | null;
  stats: DashboardStatsDTO;
};
