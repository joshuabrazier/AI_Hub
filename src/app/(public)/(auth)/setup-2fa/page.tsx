import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session-auth-server";
import { roleHome, ROUTES } from "@/lib/routes";
import { STAFF_ROLES, type UserRole } from "@/lib/data/kysely-database-types";
import { SetupTwoFactorPage } from "@/features/two-factor/setup-two-factor-page";

// Mandatory 2FA setup for staff. Only staff who have not enrolled belong here:
// unauthenticated visitors go to sign-in, and anyone else (members, or staff
// who already have 2FA) is sent to their own home.
export default async function SetupTwoFactor() {
  const session = await getSession();
  if (!session) redirect(ROUTES.PUBLIC_AUTH_SIGN_IN);

  const user = session.user;
  const isStaff = (STAFF_ROLES as readonly UserRole[]).includes(user.role as UserRole);
  const twoFactorEnabled = Boolean((user as { twoFactorEnabled?: boolean }).twoFactorEnabled);

  if (!isStaff || twoFactorEnabled) redirect(roleHome(user.role));

  return <SetupTwoFactorPage />;
}
