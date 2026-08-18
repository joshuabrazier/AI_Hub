"use client";

import { AuthMethodDivider, MicrosoftSignInButton } from "@/components/auth/microsoft-sign-in-button";
import { BRAND } from "@/lib/brand";

type SignInPageProps = {
  // Whether Entra is configured on this deployment. Comes from the server
  // route rather than a NEXT_PUBLIC variable, so nothing about the provider's
  // configuration is duplicated into the client bundle.
  microsoftEnabled?: boolean;
  // Set when Better Auth bounced somebody back here after refusing to create
  // their account - an address outside the allowed domains, or a guest.
  refused?: boolean;
};

// -------------------------------------------------------------------
// Sign in.
//
// ONE WAY IN. Microsoft is the only method: there is no password form,
// because `emailAndPassword` is disabled server-side. A form here would be
// a control that cannot work.
//
// The consequence is worth stating where somebody will see it: if the Entra
// app registration breaks or its client secret expires, nobody can sign in
// at all - including admins - and the fix is in Azure rather than in this
// app. See docs/deployment.md.
//
// `microsoftEnabled` false means the deployment has no Entra configuration,
// which is a misconfiguration rather than a state to design around; the page
// says so plainly instead of showing a button that leads nowhere.
// -------------------------------------------------------------------
export function SignInPage({ microsoftEnabled = false, refused = false }: SignInPageProps) {
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

      {microsoftEnabled ? (
        <div className="mt-8">
          <MicrosoftSignInButton />
        </div>
      ) : (
        <div className="mt-8 rounded-lg border border-border bg-muted/40 px-3 py-3">
          <p className="text-sm font-medium text-foreground">Sign-in is not configured</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This environment has no Microsoft sign-in configured, so there is no way to sign in. An
            administrator needs to set it up.
          </p>
        </div>
      )}

      <AuthMethodDivider />

      <p className="text-center text-xs text-muted-foreground">
        Trouble signing in? Contact your administrator.
      </p>
    </div>
  );
}
