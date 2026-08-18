import { AccountSetupForm } from "./components/account-setup-form";
import { getAccountSetupService } from "./account-setup.service";

// -------------------------------------------------------------------
// First-run account setup.
//
// Everything on this page belongs to the signed-in person, resolved from the
// session inside the service. There is no id in the route and none in the
// form, so there is nothing here that could be pointed at somebody else.
// -------------------------------------------------------------------
export default async function AccountSetupPage() {
  const account = await getAccountSetupService();

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center px-4 py-12">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Welcome</p>
        <h1 className="mt-2 font-heading text-2xl font-bold text-foreground">Set up your account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We have taken your name from your Microsoft account. Check it is right, add anything you would
          like us to know, and you are done - you will not be asked again.
        </p>
      </div>

      <AccountSetupForm account={account} />
    </main>
  );
}
