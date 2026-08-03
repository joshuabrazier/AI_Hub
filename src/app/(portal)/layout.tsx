import CenteredTopLayout from "@/features/layout/centered-top-layout";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Member portal shell
//
// Defence in depth behind the proxy, which applies the same role check on
// /portal. Keep BOTH.
//
// The portal carries no id in its path: every page under it reads the signed-in
// user from the session, so there is nothing in the URL to tamper with and
// nothing to compare a URL id against.
// -------------------------------------------------------------------
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  await requireUserRole([USER_ROLES.MEMBER]);

  return <CenteredTopLayout>{children}</CenteredTopLayout>;
}
