import { USER_ROLES, type UserRole } from "@/lib/data/kysely-database-types";

// -----------------------------------------------------------------
// Routes
//
// Three authenticated areas, each with its own layout and nav:
//   /admin   - admins. Everything.
//   /manage  - managers. Scoped to the teams they have been assigned to.
//   /portal  - members. Their own teams, AI chat and account.
//
// The member portal deliberately carries NO id in its path. The previous
// design namespaced it as /client/[clientId], which had to be checked against
// the session on every request to stop one account reading another's. Keying
// off the session alone removes that whole class of mistake: there is no id in
// the URL to tamper with.
// -----------------------------------------------------------------
export const ROUTES = {
  // Public
  PUBLIC_HOME: "/",
  PUBLIC_ABOUT: "/about",
  PUBLIC_CONTACT: "/contact",
  PUBLIC_PRIVACY_POLICY: "/privacy-policy",
  PUBLIC_TERMS_AND_CONDITIONS: "/terms-and-conditions",

  // Auth
  PUBLIC_AUTH_SIGN_IN: "/sign-in",
  // First-run setup. Signed-in but pre-profile, so it sits outside the three
  // area groups - their layouts enforce a role, and somebody mid-setup has
  // not been placed in one yet.
  ACCOUNT_SETUP: "/welcome",
  PUBLIC_AUTH_TWO_FACTOR: "/two-factor", // second sign-in step (TOTP or backup code)
  PUBLIC_AUTH_FORGOT_PASSWORD: "/forgot-password",
  PUBLIC_AUTH_RESET_PASSWORD: "/reset-password",
  // Mandatory 2FA setup for staff who have not enrolled yet (enforced in the proxy).
  SETUP_TWO_FACTOR: "/setup-2fa",
  PUBLIC_AUTH_SIGN_IN_INVITE_ALREADY_COMPLETE: "/sign-in?invite-complete=true",
  PUBLIC_AUTH_SIGN_IN_EMAIL_CHANGED: "/sign-in?email-changed=true",
  PUBLIC_ACCEPT_INVITE: "/accept-invite/{inviteToken}",

  // Shared by every signed-in user
  SETTINGS: "/settings",

  // Admin area
  ADMIN: "/admin",
  ADMIN_DASHBOARD: "/admin/dashboard",
  ADMIN_USERS: "/admin/users",
  ADMIN_TEAMS: "/admin/teams",
  ADMIN_AI_CHAT: "/admin/ai-chat",
  ADMIN_TRANSCRIPTION: "/admin/transcription",
  // The in-meeting prompt as its own window. Top level and outside the three
  // areas on purpose: it is opened with window.open and has to OUTLIVE the
  // page that opened it, so it cannot be a route under one of them.
  MEETING_PROMPT: "/meeting-prompt",
  ADMIN_SUMMARIES: "/admin/summaries",
  ADMIN_CONTENT: "/admin/content",
  ADMIN_HOME_PAGE: "/admin/home-page",
  ADMIN_EMAILS: "/admin/emails",
  ADMIN_CONFIGURATIONS: "/admin/configurations",
  ADMIN_ACTIVITY: "/admin/activity",
  ADMIN_AI_CHAT_LOG: "/admin/ai-chat-log",
  ADMIN_DATA_RETENTION: "/admin/data-retention",
  // SharePoint inventory. Read-only: which document libraries are being
  // catalogued, and whether the last crawl of each one finished.
  ADMIN_SHAREPOINT: "/admin/sharepoint",
  // Time and billing. Four views over one aggregation: the entries, the book
  // of work, the people, and the data-quality findings kept out of the way of
  // all three.
  ADMIN_TIMESHEETS: "/admin/timesheets",
  ADMIN_TIMESHEETS_ENTRIES: "/admin/timesheets/entries",
  ADMIN_TIMESHEETS_CLIENTS: "/admin/timesheets/clients",
  ADMIN_TIMESHEETS_STAFF: "/admin/timesheets/staff",
  // R&D Tax Incentive split: core, supporting and everything else.
  ADMIN_TIMESHEETS_RND: "/admin/timesheets/rnd",
  ADMIN_TIMESHEETS_OUTSTANDING: "/admin/timesheets/outstanding",
  ADMIN_TIMESHEETS_EXPORT: "/admin/timesheets/export",
  // Delivery. Clients are admin-only, so they live here and nowhere else;
  // projects are mounted in all three areas because the left-hand nav is
  // "my projects" and every signed-in person can be on one.
  ADMIN_CLIENTS: "/admin/clients",
  ADMIN_PROJECTS: "/admin/projects",
  // Creating a project. `new` is a STATIC segment under the projects root,
  // which Next resolves ahead of the dynamic one, so /admin/projects/new is
  // the form and /admin/projects/<id> is a board. Ids are generated, so
  // nothing can ever own the word "new" and make that ambiguous.
  ADMIN_PROJECT_NEW: "/admin/projects/new",
  // One project's board, and one project's setup. Ids are encoded even
  // though every one of them is a uuid: a helper is called with whatever
  // the caller has, encoding a uuid is a no-op, and the alternative is a
  // path that is right until the first id that is not one.
  adminProject: (projectId: string) => `/admin/projects/${encodeURIComponent(projectId)}`,
  adminProjectSetup: (projectId: string) => `/admin/projects/${encodeURIComponent(projectId)}/setup`,
  // Effective-dated charge and cost rates. Admin-only and admin-only ONLY:
  // a charge rate is a client's price and a cost rate is a pay proxy, so
  // unlike projects there is no /manage or /portal counterpart to keep in
  // step. Named here rather than written as a string in the service, so the
  // revalidation and the page cannot disagree about the path.
  ADMIN_RATES: "/admin/rates",
  // One person's rate history. The id is a routing parameter and nothing
  // more - getUserRateHistoryService guards on admin and answers notFound()
  // for an id that resolves to nobody.
  adminUserRates: (userId: string) => `/admin/rates/${encodeURIComponent(userId)}`,
  // The timesheet WEEK, singular, and deliberately not under /projects: it
  // is one person's week across every project they are on, so it has no
  // project in its path. Distinct from ADMIN_TIMESHEETS above, which is the
  // Jira-era reporting screen over a different table.
  ADMIN_TIMESHEET: "/admin/timesheet",
  // -----------------------------------------------------------------
  // The delivery budget report, which is PER PROJECT and takes its project
  // as a QUERY PARAMETER rather than a path segment.
  //
  // That is not a style choice. There is no cross-project budget read to
  // build an index page from: `getProjectBudgetReportService` takes one
  // project id, and delivery-rates.service.ts says at length why the
  // across-projects view is not there and names the two repository
  // functions it would need. A path segment would announce a list that does
  // not exist. A query parameter says what is true - one report, opened for
  // one project, the same way the transcription and chat pages take the row
  // they open.
  // -----------------------------------------------------------------
  ADMIN_DELIVERY_BUDGET: "/admin/delivery-budget",
  adminDeliveryBudgetForProject: (projectId: string) =>
    `/admin/delivery-budget?projectId=${encodeURIComponent(projectId)}`,

  // Manager area. Every one of these is scoped server-side to the teams the
  // signed-in manager has been assigned to; the team id in the URL is for
  // routing only and is always re-checked against membership.
  MANAGE: "/manage",
  MANAGE_TEAMS: "/manage/teams",
  MANAGE_AI_CHAT: "/manage/ai-chat",
  MANAGE_TRANSCRIPTION: "/manage/transcription",
  MANAGE_SUMMARIES: "/manage/summaries",
  MANAGE_PROJECTS: "/manage/projects",
  MANAGE_TIMESHEET: "/manage/timesheet",
  manageTeam: (teamId: string) => `/manage/teams/${teamId}`,
  manageProject: (projectId: string) => `/manage/projects/${encodeURIComponent(projectId)}`,

  // Member portal
  PORTAL: "/portal",
  PORTAL_AI_CHAT: "/portal/ai-chat",
  PORTAL_TRANSCRIPTION: "/portal/transcription",
  PORTAL_SUMMARIES: "/portal/summaries",
  PORTAL_PROJECTS: "/portal/projects",
  PORTAL_TIMESHEET: "/portal/timesheet",
  PORTAL_ACCOUNT: "/portal/account",
  // The one id in the portal's path, and it is a PROJECT id rather than a
  // person's: membership is the boundary here, so the row named in the URL
  // is re-checked against `project_members` on every read and a project the
  // caller is not on answers notFound(). The rule the portal was built on
  // stands - nothing in this path identifies the actor, who still comes
  // from the session.
  portalProject: (projectId: string) => `/portal/projects/${encodeURIComponent(projectId)}`,

  // Errors
  ERROR_FORBIDDEN: "/forbidden",
};

// -----------------------------------------------------------------
// Area guards
//
// All three use exact-or-slash matching rather than a bare startsWith. A bare
// prefix test would match sibling paths that merely begin with the same
// letters (/administrators, /portal-status), which is how a route ends up
// unguarded without anyone noticing.
// -----------------------------------------------------------------
function isInArea(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function isAdminRoute(pathname: string) {
  return isInArea(pathname, ROUTES.ADMIN);
}

export function isManageRoute(pathname: string) {
  return isInArea(pathname, ROUTES.MANAGE);
}

export function isPortalRoute(pathname: string) {
  return isInArea(pathname, ROUTES.PORTAL);
}

// -----------------------------------------------------------------
// Role home
// The area a user lands in for their role.
//
// This is an exhaustive switch on purpose. The previous version was a ternary
// whose else-branch was the admin dashboard, so any unrecognised or empty role
// fell through into the admin area. An unknown role must land in the least
// privileged place, not the most.
// -----------------------------------------------------------------
export function roleHome(role: string): string {
  switch (role as UserRole) {
    case USER_ROLES.ADMIN:
      return ROUTES.ADMIN_DASHBOARD;
    case USER_ROLES.MANAGER:
      return ROUTES.MANAGE;
    case USER_ROLES.MEMBER:
      return ROUTES.PORTAL;
    default:
      return ROUTES.PORTAL;
  }
}

// -----------------------------------------------------------------
// Where THIS role reaches a feature that is mounted in all three areas.
//
// Needed because the proxy does not just fail closed on the wrong area, it
// REDIRECTS: a non-member landing on /portal/* is sent to their role home.
// So a link built for one role and followed by another does not show an
// error, it silently lands somewhere else entirely - which is what a push
// notification opening the wrong page looks like.
//
// Exhaustive switch and a least-privileged default, matching roleHome.
// -----------------------------------------------------------------
export function transcriptionHomeForRole(role: string): string {
  switch (role as UserRole) {
    case USER_ROLES.ADMIN:
      return ROUTES.ADMIN_TRANSCRIPTION;
    case USER_ROLES.MANAGER:
      return ROUTES.MANAGE_TRANSCRIPTION;
    case USER_ROLES.MEMBER:
      return ROUTES.PORTAL_TRANSCRIPTION;
    default:
      return ROUTES.PORTAL_TRANSCRIPTION;
  }
}

// -----------------------------------------------------------------
// The same question for delivery, which is mounted in all three areas for
// the same reason transcription is: MEMBERSHIP decides what somebody sees,
// not their role, so an admin, a manager and a member all need the feature
// and each needs it in their own area.
//
// These exist because the SCREENS have to build links to each other. A
// project list links to a board, a board links back to a week, and a
// component that assembles `/admin/projects/${id}` by hand is one that
// sends a member to a path the proxy redirects away from - silently, to
// their role home, which reads as a link that does nothing. Several
// screens link to each other across this module, and every hand-rolled
// prefix is another chance to get that wrong in a way nobody sees.
//
// Exhaustive switches and a least-privileged default, matching roleHome.
// -----------------------------------------------------------------
export function projectHomeForRole(role: string): string {
  switch (role as UserRole) {
    case USER_ROLES.ADMIN:
      return ROUTES.ADMIN_PROJECTS;
    case USER_ROLES.MANAGER:
      return ROUTES.MANAGE_PROJECTS;
    case USER_ROLES.MEMBER:
      return ROUTES.PORTAL_PROJECTS;
    default:
      return ROUTES.PORTAL_PROJECTS;
  }
}

/** One project's board, in the area this role is allowed to be in. */
export function projectBoardForRole(role: string, projectId: string): string {
  switch (role as UserRole) {
    case USER_ROLES.ADMIN:
      return ROUTES.adminProject(projectId);
    case USER_ROLES.MANAGER:
      return ROUTES.manageProject(projectId);
    case USER_ROLES.MEMBER:
      return ROUTES.portalProject(projectId);
    default:
      return ROUTES.portalProject(projectId);
  }
}

export function timesheetHomeForRole(role: string): string {
  switch (role as UserRole) {
    case USER_ROLES.ADMIN:
      return ROUTES.ADMIN_TIMESHEET;
    case USER_ROLES.MANAGER:
      return ROUTES.MANAGE_TIMESHEET;
    case USER_ROLES.MEMBER:
      return ROUTES.PORTAL_TIMESHEET;
    default:
      return ROUTES.PORTAL_TIMESHEET;
  }
}

// -----------------------------------------------------------------
// Chromeless routes
// Routes that render standalone (full page) without the app navbar and
// sidebar - the public marketing pages and the auth flows.
// -----------------------------------------------------------------
export function isChromelessRoute(pathname: string) {
  const chromelessRoutes = [
    ROUTES.PUBLIC_HOME,
    ROUTES.PUBLIC_ABOUT,
    ROUTES.PUBLIC_CONTACT,
    ROUTES.PUBLIC_PRIVACY_POLICY,
    ROUTES.PUBLIC_TERMS_AND_CONDITIONS,
    ROUTES.PUBLIC_AUTH_FORGOT_PASSWORD,
    ROUTES.PUBLIC_AUTH_RESET_PASSWORD,
    ROUTES.PUBLIC_AUTH_TWO_FACTOR,
    ROUTES.SETUP_TWO_FACTOR,
    ROUTES.MEETING_PROMPT,
  ];
  if (chromelessRoutes.includes(pathname)) return true;

  // Auth pages render standalone in the AuthShell.
  const chromelessPrefixes = [ROUTES.PUBLIC_AUTH_SIGN_IN, "/accept-invite"];
  return chromelessPrefixes.some((prefix) => pathname.startsWith(prefix));
}
