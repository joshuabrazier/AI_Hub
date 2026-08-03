import { redirect } from "next/navigation";

import LandingPage from "@/features/landing/landing-page";
import { getSession } from "@/lib/auth/session-auth-server";
import { STAFF_ROLES, type UserRole } from "@/lib/data/kysely-database-types";
import { roleHome } from "@/lib/routes";

export default async function Home() {
  const session = await getSession();

  // A signed-in visitor normally skips the landing page and goes straight to
  // their portal (e.g. returning with "Remember me"). The one exception is
  // staff who have not set up their mandatory 2FA yet: forwarding them to the
  // portal only bounces (the middleware sends them on to /setup-2fa), which
  // makes the "Back" and logo links on the setup page look broken. Let them
  // view the public landing instead - the admin area stays gated by the
  // middleware regardless.
  if (session) {
    const { role } = session.user;
    const isStaff = (STAFF_ROLES as readonly UserRole[]).includes(role as UserRole);
    const twoFactorEnabled = Boolean((session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled);
    const staffNeedingTwoFactor = isStaff && !twoFactorEnabled;

    if (!staffNeedingTwoFactor) {
      redirect(roleHome(role));
    }
  }

  return <LandingPage />;
}
