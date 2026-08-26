import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth, SESSION_ABSOLUTE_MAX_SECONDS } from "./auth";
import { ROUTES, roleHome } from "../routes";

import { NonNullSession, SessionUser, UserRoleSchema } from "./auth.types";

import { USER_ROLES, type UserRole } from "../data/kysely-database-types";
import {
  getManagedTeamIdsForUserRepo,
  getTeamIdsForUserRepo,
} from "../data/repositories/team-members.repository";
import { deleteSessionByIdRepo } from "../data/repositories/sessions.repository";
import { getSessionTwoFactorRepo } from "../data/repositories/session-two-factor.repository";
import { getUserByUserIdRepo } from "../data/repositories/users.repository";
import { envServer } from "../env-server";

// -------------------------------------------------------------------
// Base Session
//
// THE ABSOLUTE LIFETIME CAP IS ENFORCED HERE, and this is the right place
// for it precisely because it is the lowest one: the proxy, every guard
// below, and every route handler all read a session through this function.
// A cap applied in one of the guards instead would leave the route handlers
// - which serve recordings and attachments - honouring a session the rest
// of the app had already given up on.
//
// Better Auth's own `expiresIn` is a SLIDING window: each request pushes it
// out again, so a session in daily use never reaches it. That is the
// behaviour you want for somebody working, and it is also why it cannot be
// the only limit - without a ceiling, one sign-in lasts forever.
//
// A session past the ceiling is DELETED rather than just refused. Refusing
// it would leave the row there to be re-read and re-refused on every
// subsequent request, and would leave a live-looking session in the table
// for anybody auditing it.
//
// MEMOISED PER REQUEST, and the distinction matters more here than anywhere
// else in the app. React's cache() is scoped to a single request: two calls
// inside one share an answer, and the next request starts with nothing. That
// is the only kind of caching a session may ever have. A module-level Map
// would be shared by every visitor to the server and would hand one person's
// session to another - never replace this with one.
//
// Why it is needed: the guards compose. requireUserRole calls requireUser
// calls resolveSessionUser calls requireSession calls this, and a page plus
// its services calls a guard several times over. Each call was two queries,
// so one overview render asked the database who was signed in five times.
//
// MEMOISING A FUNCTION WITH A SIDE EFFECT is safe here, and is in fact the
// point: the expired-session DELETE now happens once per request instead of
// once per guard that happened to ask. The cap itself is unaffected, because
// the memo lasts exactly one request and the next one re-reads and re-checks.
// -------------------------------------------------------------------
export const getSession = cache(async function getSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) return null;

  const startedAt = new Date(session.session.createdAt).getTime();

  // A row with an unreadable createdAt is left alone rather than treated as
  // ancient. Signing everybody out over a parsing failure would be a much
  // worse outcome than the one this check exists to prevent.
  if (Number.isNaN(startedAt)) return session;

  const ageSeconds = (Date.now() - startedAt) / 1000;

  if (ageSeconds > SESSION_ABSOLUTE_MAX_SECONDS) {
    await deleteSessionByIdRepo(session.session.id);

    // Null, so every caller treats it as signed out through the path it
    // already has. Nothing needs to know the difference between "expired"
    // and "never signed in", and the sign-in page is the same either way.
    return null;
  }

  return session;
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
// The signed-in person, plus the two things the gates below need that the
// session object alone does not carry: the SESSION id (two-factor state is
// per session, not per user) and whether they have enrolled at all.
//
// `profileCompletedAt` and `twoFactorEnabled` are both read from the
// database rather than the session. The session is issued at sign-in and
// would keep saying "incomplete" for the rest of its life, trapping
// somebody on a setup screen they had already finished.
//
// NOT EXPORTED, and deliberately so: it performs no gate at all. Everything
// outside this module goes through one of the guards below.
// -------------------------------------------------------------------
type ResolvedSession = {
  user: SessionUser;
  sessionId: string;
  twoFactorEnrolled: boolean;
};

// Request-scoped for the same reason as getSession above, and keyed by id so
// it stays correct if a request ever resolves more than one user. Read fresh
// on the next request, which is what keeps profileCompletedAt and
// twoFactorEnabled honest the moment either of them changes.
const getCachedUserRow = cache(async function getCachedUserRow(userId: string) {
  return getUserByUserIdRepo(userId);
});

async function resolveSessionUser(): Promise<ResolvedSession> {
  const session = await requireSession();

  const parsed = UserRoleSchema.safeParse(session.user.role);

  if (!parsed.success) {
    redirect(ROUTES.ERROR_FORBIDDEN);
  }

  const row = await getCachedUserRow(session.user.id);

  return {
    user: {
      ...session.user,
      role: parsed.data,
      profileCompletedAt: row?.profileCompletedAt ?? null,
    },
    sessionId: session.session.id,
    twoFactorEnrolled: row?.twoFactorEnabled ?? false,
  };
}

// -------------------------------------------------------------------
// Has this session cleared the second factor?
//
// Three states, and the middle one is the easy mistake:
//
//   feature off        -> satisfied, always. Nothing changes for a
//                         deployment that has not turned this on.
//   on, not enrolled   -> NOT satisfied. Somebody who has never set up an
//                         authenticator is sent to enrol, not waved
//                         through - otherwise turning the flag on would
//                         protect only the people who had already opted in.
//   on, enrolled       -> satisfied only once THIS session has verified.
//
// The state lives on the session row and cascades with it, so signing out
// discards it and a second device verifies on its own.
// -------------------------------------------------------------------
export async function isTwoFactorSatisfied(
  sessionId: string,
  twoFactorEnrolled: boolean,
): Promise<boolean> {
  if (!envServer.APP_TWO_FACTOR_ENABLED) return true;

  if (!twoFactorEnrolled) return false;

  const state = await getSessionTwoFactorRepo(sessionId);

  return Boolean(state?.verifiedAt);
}

// -------------------------------------------------------------------
// Require Auth User (normalised)
//
// The choke point for BOTH unskippable steps, in this order:
//
//   1. the second factor, and
//   2. first-run profile setup.
//
// Two-factor goes first because it is the security control: somebody who
// has not proved a second factor should not be writing anything, even their
// own name. Putting both here rather than in the three area layouts means
// neither can be skipped by reaching a route that happens not to have its
// own check.
//
// A page that must be reachable DURING either step uses the narrower guards
// below, or it will redirect to itself.
// -------------------------------------------------------------------
export async function requireUser(): Promise<SessionUser> {
  const { user, sessionId, twoFactorEnrolled } = await resolveSessionUser();

  if (!(await isTwoFactorSatisfied(sessionId, twoFactorEnrolled))) {
    redirect(ROUTES.PUBLIC_AUTH_TWO_FACTOR);
  }

  if (!user.profileCompletedAt) {
    redirect(ROUTES.ACCOUNT_SETUP);
  }

  return user;
}

// -------------------------------------------------------------------
// The same, WITHOUT the profile-setup redirect but still behind the second
// factor.
//
// Only for the setup screen itself and anything that must work while an
// account is half-configured. Everything else wants requireUser.
// -------------------------------------------------------------------
export async function requireSessionUserAllowingSetup(): Promise<SessionUser> {
  const { user, sessionId, twoFactorEnrolled } = await resolveSessionUser();

  if (!(await isTwoFactorSatisfied(sessionId, twoFactorEnrolled))) {
    redirect(ROUTES.PUBLIC_AUTH_TWO_FACTOR);
  }

  return user;
}

// -------------------------------------------------------------------
// The same again, WITHOUT either gate.
//
// EXISTS FOR EXACTLY ONE CALLER: the two-factor screen, which has to be
// reachable by somebody who has not yet passed two-factor - every other
// guard would redirect it to itself. It still requires a valid session, so
// an anonymous visitor gets nothing.
//
// Do not reach for this anywhere else. A page that uses it is a page with
// no second factor in front of it.
// -------------------------------------------------------------------
export async function requireSessionUserForTwoFactor(): Promise<ResolvedSession> {
  return resolveSessionUser();
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
// The session for a ROUTE HANDLER, or null.
//
// WHY THIS EXISTS AND WHY EVERY ROUTE HANDLER MUST USE IT.
//
// The proxy matcher covers /admin, /manage and /portal only. Route handlers
// are not matched by it and have no area layout above them, so their own
// session check is the outer gate - which means a two-factor gate written
// only into requireUser would leave /api/ai-chat/stream,
// /api/ai-chat/attachments and /api/transcription/[id]/media serving
// transcripts, uploads and recordings to a session that never presented a
// second factor. Those are the exact files this feature exists to protect.
//
// So this is getSession() with the same gate requireUser applies, and it
// answers null in both cases - no session, or a session that has not
// verified. Handlers already treat null as 401, which is the right answer
// here too: a fetch() cannot follow a redirect to a verification screen and
// would receive HTML where it expected JSON.
//
// Authorization is still the service's. This is the outer gate only.
// -------------------------------------------------------------------
export async function getVerifiedApiSession(): Promise<NonNullSession | null> {
  const session = await getSession();

  if (!session) return null;

  if (!envServer.APP_TWO_FACTOR_ENABLED) return session;

  // The memoised read, so an API route that also resolves the caller through
  // a guard does not ask for the same row twice.
  const row = await getCachedUserRow(session.user.id);

  const satisfied = await isTwoFactorSatisfied(session.session.id, row?.twoFactorEnabled ?? false);

  return satisfied ? session : null;
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
