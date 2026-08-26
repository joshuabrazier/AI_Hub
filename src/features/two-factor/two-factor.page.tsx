import { TwoFactorEnrol } from "./components/two-factor-enrol";
import { TwoFactorVerifyForm } from "./components/two-factor-verify-form";
import { getTwoFactorScreenService } from "./two-factor.service";

// -------------------------------------------------------------------
// The second factor.
//
// One route, two screens, chosen by whether this account has a VERIFIED
// secret - see two-factor.types.ts for why that is the discriminator and
// not `users.two_factor_enabled`.
//
// Everything on this page belongs to the signed-in person, resolved from
// the session inside the service. There is no id in the route and none in
// either form.
// -------------------------------------------------------------------
export default async function TwoFactorPage() {
  const screen = await getTwoFactorScreenService();

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-lg flex-col justify-center px-4 py-12">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Security</p>
        <h1 className="mt-2 font-heading text-2xl font-bold text-foreground">
          {screen.mode === "enrol" ? "Set up two-factor authentication" : "Confirm it is you"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {screen.mode === "enrol"
            ? "This portal holds meeting recordings and chat transcripts, so it asks for a second factor on top of your Microsoft sign-in. It takes a minute and you only do it once."
            : "Enter the code from your authenticator app to continue. We ask once per sign-in, on each device."}
        </p>
      </div>

      {screen.mode === "enrol" ? (
        <TwoFactorEnrol email={screen.email} />
      ) : (
        <TwoFactorVerifyForm />
      )}
    </main>
  );
}
