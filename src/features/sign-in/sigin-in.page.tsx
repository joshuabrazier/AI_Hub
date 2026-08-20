"use client";

import { AuthMethodDivider, MicrosoftSignInButton } from "@/components/auth/microsoft-sign-in-button";
import { PasswordSignInForm } from "@/components/auth/password-sign-in-form";
import { BRAND } from "@/lib/brand";

type SignInPageProps = {
  // Whether Entra is configured on this deployment. Comes from the server
  // route rather than a NEXT_PUBLIC variable, so nothing about the provider's
  // configuration is duplicated into the client bundle.
  microsoftEnabled?: boolean;
  // Whether password sign-in is registered - local development only, and
  // decided by the server for the same reason as above.
  passwordEnabled?: boolean;
  // Set when Better Auth bounced somebody back here after refusing to create
  // their account - an address outside the allowed domains, or a guest.
  refused?: boolean;
};

// -------------------------------------------------------------------
// Sign in.
//
// ONE WAY IN, in any environment that matters. Microsoft is the method, and
// what renders here is decided entirely by what the server has actually
// registered - a control that cannot work is worse than no control.
//
// The password form is the one exception and it is a LOCAL DEVELOPMENT one:
// it appears only when DEV_PASSWORD_SIGN_IN is set and MODE is not
// production, so that the app can be run before an Entra app registration
// exists. It is labelled as such on screen, because a second front door that
// looks like a normal feature is how it ends up somewhere it should not be.
//
// The consequence of the single door is worth stating where somebody will see
// it: if the Entra app registration breaks or its client secret expires,
// nobody can sign in at all - including admins - and the fix is in Azure
// rather than in this app. See docs/deployment.md.
//
// Neither method configured means the deployment is misconfigured rather than
// in a state to design around; the page says so plainly instead of showing a
// button that leads nowhere.
// -------------------------------------------------------------------
export function SignInPage({
  microsoftEnabled = false,
  passwordEnabled = false,
  refused = false,
}: SignInPageProps) {
  const nothingConfigured = !microsoftEnabled && !passwordEnabled;

  return (
    <div className="w-full">
      <h1 className="font-heading text-2xl font-bold text-foreground">Sign in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Use your {BRAND.name} Microsoft account.
      </p>

      {refused && (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-foreground"
        >
          That account cannot be used to sign in here. If you believe it should be, speak to an
          administrator.
        </div>
      )}

      {microsoftEnabled && (
        <div className="mt-8">
          <MicrosoftSignInButton />
        </div>
      )}

      {nothingConfigured && (
        <div className="mt-8 rounded-lg border border-border bg-muted/40 px-3 py-3">
          <p className="text-sm font-medium text-foreground">Sign-in is not configured</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This environment has no Microsoft sign-in configured, so there is no way to sign in. An
            administrator needs to set it up.
          </p>
        </div>
      )}

      {passwordEnabled && (
        <>
          {microsoftEnabled && (
            <div className="mt-6">
              <AuthMethodDivider />
            </div>
          )}

          <div className={microsoftEnabled ? "mt-2" : "mt-8"}>
            {/* Stated on screen, not just in a comment. Anybody who sees this
                on a deployed environment is looking at a misconfiguration. */}
            <p className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Password sign-in is enabled for local development only.
            </p>

            <PasswordSignInForm />
          </div>
        </>
      )}

      <div className="mt-8">
        <AuthMethodDivider />
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Trouble signing in? Contact your administrator.
      </p>
    </div>
  );
}
