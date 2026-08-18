"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth-client";
import { MESSAGES } from "@/lib/constants";
import { ROUTES } from "@/lib/routes";

// -------------------------------------------------------------------
// Continue with Microsoft.
//
// Used on both the sign-in page and the accept-invite page. The two flows
// look identical from here and, importantly, ARE identical on the server:
// signing in and accepting an invitation both end in Better Auth deciding
// whether a user row may exist, and that decision is made in one place
// (account-creation-policy.ts) rather than per page.
//
// So this button cannot be the thing that lets somebody in. Somebody who
// clicks it without an invitation completes the Microsoft round trip and is
// then refused at account creation - which is the correct order, because the
// alternative is this app deciding who is allowed before Microsoft has
// established who they are.
//
// Rendered only when Entra is configured; the caller passes that down from
// the server rather than the client guessing, so no client bundle needs to
// know anything about the provider's configuration.
// -------------------------------------------------------------------
export function MicrosoftSignInButton({ callbackURL = ROUTES.PUBLIC_HOME }: { callbackURL?: string }) {
  const [isPending, setIsPending] = useState(false);

  const signIn = async () => {
    setIsPending(true);

    try {
      await authClient.signIn.social({
        provider: "microsoft",
        // Where Better Auth sends the browser once the round trip completes.
        // A relative path, so it cannot be turned into an open redirect by
        // anything that reaches this component.
        callbackURL,
        // Where a refusal lands. The account-creation gate throws for an
        // uninvited or out-of-domain address, and without this the person
        // would be dropped on a bare Better Auth error page.
        errorCallbackURL: ROUTES.PUBLIC_AUTH_SIGN_IN,
      });

      // No navigation happens here on success - the call above redirects to
      // Microsoft - so reaching this line at all means the redirect did not
      // occur and the spinner should stop.
    } catch (error) {
      console.error(error);
      toast.error(MESSAGES.SOMETHING_WENT_WRONG);
      setIsPending(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={isPending}
      loading={isPending}
      onClick={() => void signIn()}
    >
      {/* The Microsoft four-square mark. Inline SVG rather than a remote
          image so it needs no external request and no CSP allowance. */}
      <svg width="16" height="16" viewBox="0 0 23 23" aria-hidden="true" className="shrink-0">
        <path fill="#f35325" d="M0 0h11v11H0z" />
        <path fill="#81bc06" d="M12 0h11v11H12z" />
        <path fill="#05a6f0" d="M0 12h11v11H0z" />
        <path fill="#ffba08" d="M12 12h11v11H12z" />
      </svg>
      {isPending ? "Redirecting to Microsoft" : "Continue with Microsoft"}
    </Button>
  );
}

// -------------------------------------------------------------------
// The "or" rule between the Microsoft button and the password form.
// -------------------------------------------------------------------
export function AuthMethodDivider() {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
