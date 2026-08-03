import CenteredTopLayout from "@/features/layout/centered-top-layout";
import { requireUserRole } from "@/lib/auth/session-auth-server";
import { USER_ROLES } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Manager area shell
//
// Defence in depth behind the proxy, which applies the same role check on
// /manage. Keep BOTH: a route that falls out of the proxy matcher would
// otherwise be left with no gate at all.
//
// The roles are listed explicitly rather than taken from STAFF_ROLES so that
// adding a third internal role later cannot silently widen this area - a new
// role has to be admitted here on purpose.
//
// This says only "you may see the manager area". It says nothing about WHICH
// teams: that is resolved from the session by requireManagementScope /
// requireTeamManagement inside every service the area calls, never from the
// team id in the URL.
// -------------------------------------------------------------------
export default async function ManageLayout({ children }: { children: React.ReactNode }) {
  await requireUserRole([USER_ROLES.ADMIN, USER_ROLES.MANAGER]);

  return <CenteredTopLayout>{children}</CenteredTopLayout>;
}
