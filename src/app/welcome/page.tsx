import AccountSetupPage from "@/features/account-setup/account-setup.page";

// -------------------------------------------------------------------
// /welcome - first-run account setup.
//
// Deliberately outside the (admin) / (manage) / (portal) groups: their
// layouts enforce a role, and somebody mid-setup has not been placed in an
// area yet. The service applies its own guard, which is the only gate here.
//
// Never cached: whether setup is still needed is per-request state.
// -------------------------------------------------------------------
export const dynamic = "force-dynamic";

export default async function Page() {
  return <AccountSetupPage />;
}
