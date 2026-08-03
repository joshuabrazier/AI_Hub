import CenteredTopLayout from "@/features/layout/centered-top-layout";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Admin area shell
//
// The proxy already refuses /admin to anyone who is not an admin. This guard
// is deliberately the same check again: the proxy runs on the matcher in
// proxy.ts, and a route that stops being matched (a rename, a new matcher)
// would lose its only gate. Keep BOTH - neither is load-bearing alone.
//
// Role only. WHICH teams an admin may act on is not a question here: admins
// are unrestricted, and every narrower scope is resolved from the session
// inside the service that needs it.
// -------------------------------------------------------------------
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireUserRole([USER_ROLES.ADMIN]);

  return <CenteredTopLayout>{children}</CenteredTopLayout>;
}
