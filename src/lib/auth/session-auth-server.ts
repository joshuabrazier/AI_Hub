import "server-only";

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

// -------------------------------------------------------------------
// Base Session
// -------------------------------------------------------------------
export async function getSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
}

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
// -------------------------------------------------------------------
export async function requireUser(): Promise<SessionUser> {
  const session = await requireSession();

  const parsed = UserRoleSchema.safeParse(session.user.role);

  if (!parsed.success) {
    redirect(ROUTES.ERROR_FORBIDDEN);
  }

  return {
    ...session.user,
    role: parsed.data,
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
