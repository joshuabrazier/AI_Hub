import { requireUser } from "@/lib/auth/session-auth-server";
import { SettingsPage } from "@/features/settings/settings.page";

// -------------------------------------------------------------------
// /settings
//
// requireUser, NOT getSession plus a redirect, and the difference is not
// stylistic.
//
// This route sat outside both gates that every other signed-in screen goes
// through. The proxy matcher covers /admin, /manage and /portal only, so
// nothing in front of this page checks anything - and `getSession()` returns
// a session without asking whether it has satisfied the app-level second
// factor (`isTwoFactorSatisfied`, inside requireUser) or whether the person
// has finished first-run setup. So with APP_TWO_FACTOR_ENABLED on, a session
// that had presented one factor could reach this page; and an account with
// `profile_completed_at` still NULL could skip /welcome by coming here.
//
// requireUser answers all three - signed in, second factor satisfied, profile
// complete - and redirects for each. It is the same call every guarded page
// makes, which is the point: a route with its own bespoke check is a route
// that stops matching the others the next time one of them changes.
// -------------------------------------------------------------------
export default async function Settings() {
  await requireUser();

  return <SettingsPage />;
}
