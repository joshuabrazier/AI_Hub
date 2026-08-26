import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "./auth";
import { ROUTES, roleHome } from "../routes";

import { NonNullSession, SessionUser, UserRoleSchema } from "./auth.types";

import { USER_ROLES, type UserRole } from "../data/kysely-database-types";
import {
  getManagedTeamIdsForUserRepo,
  getTeamIdsForUserRepo,
} from "../data/repositories/team-members.repository";
import { getUserByUserIdRepo } from "../data/repositories/users.repository";

// -------------------------------------------------------------------
// Base Session
//
// MEMOISED PER REQUEST, and the distinction matters more here than anywhere
// else in the app. React's cache() is scoped to a single render pass: two
// calls inside one request share an answer, and the next request starts with
// nothing. That is the only kind of caching a session may ever have. A
// module-level Map would be shared by every visitor to the server and would
// hand one person's session to another - never replace this with one.
//
// Why it is needed: the guards compose. requireUserRole calls requireUser
// calls requireSessionUserAllowingSetup calls requireSession calls this, and
// a page plus its services calls a guard several times over. Each call was
// two queries (session, then the user behind it), so one overview render
// asked the database who was signed in five separate times.
// -------------------------------------------------------------------
export const getSession = cache(async function getSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
});

// -------------------------------------------------------------------
// Require Session
// -------------------------------------------------------------------
export async function requireSession(): Promise<NonNullSession> {
  const session = await getSession();

  if (!session) {
    redirect(ROUTES.ERROR_FORBIDDEN);
  }

  return session;
}

// -------------------------------------------------------------------
// Require Auth User (normalised)
//
// Also the choke point for FIRST-RUN SETUP. An account is created from what
// Entra asserts - a name and an address - and nothing else, so a new person
// is sent to the setup screen until they have confirmed it. Putting that
// here rather than in the three area layouts means it cannot be skipped by
// reaching a route that happens not to have its own check.
//
// A page that must be reachable DURING setup has to use
// requireSessionUserAllowingSetup below, or it will redirect to itself.
// -------------------------------------------------------------------
export async function requireUser(): Promise<SessionUser> {
  const user = await requireSessionUserAllowingSetup();

  if (!user.profileCompletedAt) {
    redirect(ROUTES.ACCOUNT_SETUP);
  }

  return user;
}

// -------------------------------------------------------------------
// The same normalisation WITHOUT the setup redirect.
//
// Only for the setup screen itself and anything that must work while an
// account is half-configured. Everything else wants requireUser.
//
// `profileCompletedAt` is read from the database rather than the session:
// the session is issued at sign-in and would still say "incomplete" for the
// rest of its life, trapping somebody on the setup screen after they had
// finished it.
// -------------------------------------------------------------------
// Request-scoped for the same reason as getSession above, and keyed by id so
// it stays correct if a request ever resolves more than one user. Read fresh
// on the next request, which is what keeps profileCompletedAt honest the
// moment somebody finishes setup.
const getCachedUserRow = cache(async function getCachedUserRow(userId: string) {
  return getUserByUserIdRepo(userId);
});

export async function requireSessionUserAllowingSetup(): Promise<SessionUser> {
  const session = await requireSession();

  const parsed = UserRoleSchema.safeParse(session.user.role);

  if (!parsed.success) {
    redirect(ROUTES.ERROR_FORBIDDEN);
  }

  const row = await getCachedUserRow(session.user.id);

  return {
    ...session.user,
    role: parsed.data,
    profileCompletedAt: row?.profileCompletedAt ?? null,
  };
}

// -------------------------------------------------------------------
// Require User Role Guard
// Answers "what role is the caller", and nothing about scope. For anything
// team-scoped, use the team guards below instead: a role alone stopped being
// a complete authorization answer once membership became many-to-many.
// -------------------------------------------------------------------
export async function requireUserRole(allowedRoles: readonly UserRole[]): Promise<SessionUser> {
  const user = await requireUser();

  if (!allowedRoles.includes(user.role)) {
    redirect(ROUTES.ERROR_FORBIDDEN);
  }

  return user;
}

// -------------------------------------------------------------------
// Team scope
//
// The security boundary of the app. Everything here resolves the caller's
// teams from the SESSION user id. Never accept a team id from a URL, a form
// field or an action argument as proof of access - pass it to
// requireTeamAccess / requireTeamManagement and let these check it.
//
// All of these return arrays because membership is many-to-many. Do not
// "simplify" any of them to a single id.
// -------------------------------------------------------------------

/** Every team the signed-in user belongs to, in any role. */
export async function getSessionTeamIds(): Promise<string[]> {
  const user = await requireUser();
  return getTeamIdsForUserRepo(user.id);
}

/** Every team the signed-in user MANAGES. Admins are not implicitly members. */
export async function getSessionManagedTeamIds(): Promise<string[]> {
  const user = await requireUser();
  return getManagedTeamIdsForUserRepo(user.id);
}

export type TeamScope = {
  user: SessionUser;
  /** Teams the caller may act on. Empty means they may act on none. */
  teamIds: string[];
  /** True when the caller is an admin, whose scope is every team. */
  isUnrestricted: boolean;
};

// -------------------------------------------------------------------
// The scope a caller has for READING team data.
// Admins are unrestricted. Everyone else is limited to their memberships.
// -------------------------------------------------------------------
export async function requireTeamScope(): Promise<TeamScope> {
  const user = await requireUser();

  if (user.role === USER_ROLES.ADMIN) {
    return { user, teamIds: [], isUnrestricted: true };
  }

  return { user, teamIds: await getTeamIdsForUserRepo(user.id), isUnrestricted: false };
}

// -------------------------------------------------------------------
// The scope a caller has for MANAGING team data (adding members, and whatever
// else a project hangs off a team). Admins are unrestricted; managers get only
// the teams an admin assigned them to; members get nothing.
// -------------------------------------------------------------------
export async function requireManagementScope(): Promise<TeamScope> {
  const user = await requireUser();

  if (user.role === USER_ROLES.ADMIN) {
    return { user, teamIds: [], isUnrestricted: true };
  }

  if (user.role !== USER_ROLES.MANAGER) {
    redirect(ROUTES.ERROR_FORBIDDEN);
  }

  return { user, teamIds: await getManagedTeamIdsForUserRepo(user.id), isUnrestricted: false };
}

// -------------------------------------------------------------------
// Assert the caller may READ this specific team, and return their scope.
//
// A team outside the caller's scope answers NOT FOUND, not "forbidden".
//
// That distinction is deliberate. A role failure ("you are a member, this is
// the admin area") can say so plainly, because the caller learns nothing they
// did not already know. A SCOPE failure is different: replying "forbidden" to
// a guessed team id confirms that the team exists, which turns this route into
// an oracle for enumerating other teams. Answering exactly as we would for an
// id that does not exist leaks nothing either way.
// -------------------------------------------------------------------
export async function requireTeamAccess(teamId: string): Promise<TeamScope> {
  const scope = await requireTeamScope();

  if (!scope.isUnrestricted && !scope.teamIds.includes(teamId)) {
    notFound();
  }

  return scope;
}

// -------------------------------------------------------------------
// Assert the caller may MANAGE this specific team, and return their scope.
// Answers NOT FOUND when out of scope, for the reason above.
// -------------------------------------------------------------------
export async function requireTeamManagement(teamId: string): Promise<TeamScope> {
  const scope = await requireManagementScope();

  if (!scope.isUnrestricted && !scope.teamIds.includes(teamId)) {
    notFound();
  }

  return scope;
}

// -------------------------------------------------------------------
// Redirect If Authenticated
// For public entry points (landing page, sign in): if the visitor already has
// an active session, send them straight to their role's home rather than
// showing the marketing or login page. A session only survives to a return
// visit if the user chose "Remember me" and did not sign out.
// -------------------------------------------------------------------
export async function redirectIfAuthenticated(): Promise<void> {
  const session = await getSession();

  if (session) {
    redirect(roleHome(session.user.role));
  }
}
