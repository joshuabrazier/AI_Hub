import PortalAccountPage from "@/features/portal-account/portal-account.page";

// One feature page, mounted in all three areas. Nothing here is scoped by
// role - the account read and written is always the session's own - so the
// only thing that differs between the three mounts is the eyebrow.
export default async function PortalAccount() {
  return <PortalAccountPage eyebrow="Your portal" />;
}
