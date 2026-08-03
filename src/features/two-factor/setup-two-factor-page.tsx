"use client";

import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth/auth-client";
import { ROUTES } from "@/lib/routes";

import { TwoFactorSetup } from "./two-factor-setup";

// -------------------------------------------------------------------
// Mandatory 2FA setup for staff who haven't enrolled. The middleware sends
// admins/trainers without 2FA here and won't let them into the admin area
// until it's on. A sign-out escape hatch avoids trapping them.
// -------------------------------------------------------------------
export function SetupTwoFactorPage() {
  const router = useRouter();

  return (
    <div className="w-full">
      <h1 className="font-heading text-3xl font-bold text-foreground">Set up two-factor authentication</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Two-factor authentication is required for staff accounts. Set it up with an authenticator app to continue.
      </p>

      <div className="mt-8">
        <TwoFactorSetup
          onEnabled={() => {
            // Hard navigation (not router.push + refresh) so the request re-runs
            // the middleware with 2FA now enabled. A client-side push + refresh
            // raced the middleware redirect and left a broken "This page couldn't
            // load" screen until a manual reload.
            window.location.assign(ROUTES.ADMIN_DASHBOARD);
          }}
        />
      </div>

      <button
        type="button"
        className="mt-6 text-sm font-medium text-muted-foreground hover:underline"
        onClick={async () => {
          await authClient.signOut();
          router.push(ROUTES.PUBLIC_AUTH_SIGN_IN);
        }}
      >
        Sign out
      </button>
    </div>
  );
}
