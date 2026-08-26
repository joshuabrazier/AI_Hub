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
  ADMIN_TIMESHEETS_REVIEW: "/admin/timesheets/review",
  ADMIN_TIMESHEETS_EXPORT: "/admin/timesheets/export",

  // Manager area. Every one of these is scoped server-side to the teams the
  // signed-in manager has been assigned to; the team id in the URL is for
  // routing only and is always re-checked against membership.
  MANAGE: "/manage",
  MANAGE_TEAMS: "/manage/teams",
  MANAGE_AI_CHAT: "/manage/ai-chat",
  MANAGE_TRANSCRIPTION: "/manage/transcription",
  manageTeam: (teamId: string) => `/manage/teams/${teamId}`,

  // Member portal
  PORTAL: "/portal",
  PORTAL_AI_CHAT: "/portal/ai-chat",
  PORTAL_TRANSCRIPTION: "/portal/transcription",
  PORTAL_ACCOUNT: "/portal/account",

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
  ];
  if (chromelessRoutes.includes(pathname)) return true;

  // Auth pages render standalone in the AuthShell.
  const chromelessPrefixes = [ROUTES.PUBLIC_AUTH_SIGN_IN, "/accept-invite"];
  return chromelessPrefixes.some((prefix) => pathname.startsWith(prefix));
}
