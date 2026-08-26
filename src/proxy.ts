import { NextRequest, NextResponse } from "next/server";
import { getSession } from "./lib/auth/session-auth-server";
import { isAdminRoute, isManageRoute, isPortalRoute, roleHome, ROUTES } from "./lib/routes";
import { STAFF_ROLES, USER_ROLES, type UserRole } from "./lib/data/kysely-database-types";
import { getSessionTwoFactorRepo } from "./lib/data/repositories/session-two-factor.repository";
import { getUserByUserIdRepo } from "./lib/data/repositories/users.repository";
import { envServer } from "./lib/env-server";

// -------------------------------------------------------------------
// Proxy (middleware) - runs on every request matched by the config below.
//
// It enforces the SECOND FACTOR and AREA-level access by role:
//   /admin/*   admins
//   /manage/*  managers (and admins, who can see everything)
//   /portal/*  members
// A user in the wrong area is redirected to their own role's home.
//
// This is the outer gate, not the whole story. WHICH teams a manager may act
// on is decided in the service layer from the session, never here and never
// from a URL parameter - the middleware cannot safely make that call because
// it would have to trust the path. Every area also re-checks the role in its
// layout, so neither layer is load-bearing on its own.
//
// Keep this on the Node runtime: it transitively imports the Kysely client.
// Do not add `export const runtime = "edge"`.
// -------------------------------------------------------------------
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const session = await getSession();

  // Not authenticated, so send them to sign in.
  if (!session) {
    return NextResponse.redirect(new URL(ROUTES.PUBLIC_AUTH_SIGN_IN, request.url));
  }

  // -------------------------------------------------------------------
  // THE SECOND FACTOR, GATED HERE AND NOT ONLY IN THE LAYOUTS.
  //
  // requireUser already redirects an unverified session, and that remains
  // the load-bearing check - it covers every server component, action and
  // route handler, including ones no matcher reaches. This is not a
  // replacement for it.
  //
  // It exists because of WHEN the layout check happens. The root layout
  // renders the navbar and sidebar before the area layout has awaited its
  // guard, so the browser paints the whole application shell - with the
  // admin navigation in it - and then redirects. No protected data is ever
  // sent, because the area layout throws its redirect before any page
  // renders and no service is called. But it does show somebody who has
  // passed only the FIRST factor their role and the shape of the product,
  // and it looks alarming enough that people reasonably assume worse.
  //
  // Redirecting at the edge means nothing renders at all.
  //
  // THE FLAG IS READ FRESH, not taken from the session. Better Auth
  // snapshots the user into the session at sign-in, so its copy still says
  // "not enrolled" immediately after somebody enrols - and trusting it here
  // would bounce them straight back to the screen they just completed,
  // forever.
  // -------------------------------------------------------------------
  if (envServer.APP_TWO_FACTOR_ENABLED) {
    const [row, twoFactor] = await Promise.all([
      getUserByUserIdRepo(session.user.id),
      getSessionTwoFactorRepo(session.session.id),
    ]);

    const satisfied = Boolean(row?.twoFactorEnabled) && Boolean(twoFactor?.verifiedAt);

    if (!satisfied) {
      return NextResponse.redirect(new URL(ROUTES.PUBLIC_AUTH_TWO_FACTOR, request.url));
    }
  }

  const role = session.user.role as UserRole;
  const home = roleHome(role);

  const isStaff = (STAFF_ROLES as readonly UserRole[]).includes(role);

  // -------------------------------------------------------------------
  // NO 2FA CHECK HERE, and unlike the role check above that is not an
  // omission - it is where the gate lives instead.
  //
  // App-level two-factor (APP_TWO_FACTOR_ENABLED) is enforced inside
  // requireUser, and for route handlers inside getVerifiedApiSession, both
  // in session-auth-server.ts. That is deliberately NOT the arrangement the
  // role check uses. The role gate is duplicated here and in each area
  // layout because a route that stopped being matched would lose its only
  // gate; the two-factor gate is in the function every guarded page and
  // every route handler already calls, so it cannot be lost by a matcher
  // change - and repeating it here would cost two more database queries on
  // every request for no extra safety.
  //
  // It also could not live here safely. The matcher covers /admin, /manage
  // and /portal only, so a check here would leave /api/ai-chat/stream and
  // /api/transcription/[id]/media - the routes that actually serve
  // transcripts and recordings - with no second factor in front of them.
  //
  // /two-factor is not matched, so there is no redirect loop to worry about.
  // -------------------------------------------------------------------

  if (isAdminRoute(pathname)) {
    if (role !== USER_ROLES.ADMIN) {
      return NextResponse.redirect(new URL(home, request.url));
    }
    return NextResponse.next();
  }

  if (isManageRoute(pathname)) {
    if (!isStaff) {
      return NextResponse.redirect(new URL(home, request.url));
    }
    return NextResponse.next();
  }

  if (isPortalRoute(pathname)) {
    // Staff have their own areas; send them there rather than showing them an
    // empty member portal.
    if (role !== USER_ROLES.MEMBER) {
      return NextResponse.redirect(new URL(home, request.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

// -------------------------------------------------------------------
// Matcher
//
// `/admin/:path*` also matches bare `/admin` (the trailing group is
// zero-or-more), and the same holds for the other two areas.
//
// /settings, /welcome and the other standalone pages are deliberately NOT
// listed: each guards itself server-side with requireUser. Adding them here
// would mean a second session lookup per request for no extra safety.
// -------------------------------------------------------------------
export const config = {
  matcher: ["/admin/:path*", "/manage/:path*", "/portal/:path*"],
};
