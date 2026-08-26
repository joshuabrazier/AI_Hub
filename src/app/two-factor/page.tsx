import TwoFactorPage from "@/features/two-factor/two-factor.page";

// -------------------------------------------------------------------
// /two-factor - the second factor, both enrolment and verification.
//
// Deliberately outside the (admin) / (manage) / (portal) groups, for the
// same reason /welcome is: their layouts enforce a role, and this has to be
// reachable by anybody signed in, before they have been let into an area.
//
// The service applies its own guard, which is the only gate here - and it
// is the one guard that does NOT redirect on an unverified second factor,
// because every other one redirects here.
//
// Never cached: whether verification is still needed is per-request state,
// and a cached "please verify" page shown after verifying would look like
// the code had not worked.
// -------------------------------------------------------------------
export const dynamic = "force-dynamic";

export default async function Page() {
  return <TwoFactorPage />;
}
