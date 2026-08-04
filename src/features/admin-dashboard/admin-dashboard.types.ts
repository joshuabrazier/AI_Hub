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
  activeTeams: number;
  // A de-identified account is excluded as well as a deactivated one: its
  // personal data is gone, so it is a retained row rather than a person still
  // using the product.
  activeMembers: number;
  // Admins and managers with a usable account.
  activeStaff: number;
  // Invitations sent and not yet accepted, so an admin can see at a glance
  // that people are waiting to be onboarded.
  pendingInvitations: number;
};

// One team on the side column, with how many people are in it.
export type DashboardTeamDTO = {
  id: string;
  name: string;
  memberCount: number;
};

// A message that has been sent. Titles only: the stored body is rich text and
// is rendered (sanitised) on the notifications page, so none of it reaches
// this one.
export type DashboardBroadcastDTO = {
  id: string;
  title: string;
  // Who it went to. Broadcasts store a display label; when one is missing the
  // audience type's own label stands in, so this is never blank.
  audienceLabel: string;
  createdAt: Date;
};

export type AdminDashboardDTO = {
  // What to greet the admin by, taken from the session. Null when their
  // account has no usable name.
  firstName: string | null;
  stats: DashboardStatsDTO;
  // Capped for display; `stats.activeTeams` is the true total.
  teams: DashboardTeamDTO[];
  broadcasts: DashboardBroadcastDTO[];
};
