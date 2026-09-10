import PortalAccountPage from "@/features/portal-account/portal-account.page";
import { USER_ROLES, USER_ROLE_LABELS } from "@/lib/data/kysely-database-types";

// One feature page, mounted in all three areas. Nothing here is scoped by
// role - the account read and written is always the session's own - so the
// only thing that differs between the three mounts is the eyebrow.
export default async function AdminAccount() {
  return <PortalAccountPage eyebrow={USER_ROLE_LABELS[USER_ROLES.ADMIN]} />;
}
