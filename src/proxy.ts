import { NextRequest, NextResponse } from "next/server";
import { getSession } from "./lib/auth/session-auth-server";
import { isAdminRoute, isManageRoute, isPortalRoute, roleHome, ROUTES } from "./lib/routes";
import { STAFF_ROLES, USER_ROLES, type UserRole } from "./lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Proxy (middleware) - runs on every request matched by the config below.
//
// It enforces AREA-level access by role only:
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

  const role = session.user.role as UserRole;
  const home = roleHome(role);

  const isStaff = (STAFF_ROLES as readonly UserRole[]).includes(role);

  // -------------------------------------------------------------------
  // NO 2FA ENROLMENT GATE HERE, and that is the second half of "sign-in is
  // Microsoft only".
  //
  // Entra owns credentials AND MFA. The app's own 2FA enrolment screens went
  // when passwords did, so there is no /setup-2fa page left to send anybody
  // to - a gate here could only ever redirect staff to a 404, locking every
  // admin out of the area it was meant to protect. Nothing sets
  // users.two_factor_enabled either, since only those screens ever did.
  //
  // The twoFactor plugin stays registered in auth.ts so the capability and
  // its table survive for a project that wants to bring the enrolment screens
  // back. If one does, this check belongs here again - and the screen has to
  // exist before the redirect does.
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
