"use client";

import Link from "next/link";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthMethodDivider, MicrosoftSignInButton } from "@/components/auth/microsoft-sign-in-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FormInputField } from "@/components/form/form-input-field";
import { SignInForm, signInSchema } from "./sign-in.types";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth/auth-client";
import { toast } from "sonner";
import { ROUTES, roleHome } from "@/lib/routes";
import { STAFF_ROLES, type UserRole } from "@/lib/data/kysely-database-types";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { MESSAGES } from "@/lib/constants";

// -------------------------------------------------------------------
// Sign In Page
// -------------------------------------------------------------------
type SignInPageProps = {
  // Shown after a user confirms an email change (they're signed out and sent here)
  emailChanged?: boolean;
  // Whether Entra is configured. Comes from the server route rather than a
  // NEXT_PUBLIC variable, so nothing about the provider's configuration has
  // to be duplicated into the client bundle to decide whether to show a
  // button.
  microsoftEnabled?: boolean;
};

export function SignInPage({ emailChanged = false, microsoftEnabled = false }: SignInPageProps) {
  const [isPending, setIsPending] = useState<boolean>(false);

  const form = useForm<SignInForm>({
    resolver: zodResolver(signInSchema),
    mode: "onChange",
    defaultValues: {
      email: "",
      password: "",
      rememberMe: false,
    },
  });

  // -------------------------------------------------------------------
  // After an email change, sessions are revoked server-side. The signed
  // session-cookie cache can still serve a stale session on this device,
  // so clear it here to force a fresh sign in with the new email.
  // -------------------------------------------------------------------
  useEffect(() => {
    if (emailChanged) {
      authClient.signOut();
    }
  }, [emailChanged]);

  // -------------------------------------------------------------------
  // On Submit
  // -------------------------------------------------------------------
  const onSubmit = async (values: SignInForm) => {
    try {
      if (isPending) return;

      await authClient.signIn.email(
        {
          email: values.email,
          password: values.password,
          //Don't delete session on browser close
          rememberMe: values.rememberMe,
        },
        {
          onRequest: () => {
            setIsPending(true);
          },
          onSuccess: (ctx) => {
            // 2FA is on for this account: the password was accepted but no full
            // session is created yet - send them to the verification step.
            if ((ctx.data as { twoFactorRedirect?: boolean })?.twoFactorRedirect) {
              // Hard navigation, like the two branches below. Better Auth sets a
              // short-lived two-factor cookie on THIS response, and the challenge
              // page needs it. A client push renders before that cookie is in
              // play, so the challenge page decides there is nothing to verify
              // and bounces back to sign-in - intermittently, which is worse than
              // failing outright.
              window.location.assign(ROUTES.PUBLIC_AUTH_TWO_FACTOR);
              return;
            }

            const user = ctx.data?.user;
            const role = user?.role ?? "";

            // Staff who reach this point have NO 2FA yet: a 2FA-enabled staff
            // account takes the twoFactorRedirect branch above and never gets
            // here. 2FA is mandatory for staff, so send them straight to setup
            // with a hard navigation. Previously we pushed them to the dashboard
            // and let the middleware redirect on to /setup-2fa; that client push
            // racing the redirect is what left the broken "page couldn't load"
            // screen (a manual refresh fixed it).
            if ((STAFF_ROLES as readonly UserRole[]).includes(role as UserRole)) {
              window.location.assign(ROUTES.SETUP_TWO_FACTOR);
              return;
            }

            toast.success(MESSAGES.SIGN_IN_SUCCESSFULL);
            // Land them directly in their own area rather than bouncing through
            // another page. roleHome is exhaustive, so an unexpected role goes to
            // the least privileged area rather than the admin one.
            //
            // A HARD navigation, for the same reason the staff branch above uses
            // one. The session cookie was only just set by this response, and
            // every authenticated area is gated by middleware that has to read
            // it. A client-side router.push starts rendering before that cookie
            // is in play, and the router.refresh that used to follow it raced
            // the push and cancelled it, leaving the user sitting on the sign-in
            // page with no error - the credentials were accepted and nothing
            // said so.
            window.location.assign(roleHome(role));
          },
          onError: (ctx) => {
            form.reset();
            // 401 = invalid email or password - show a clear message and stop
            if (ctx.error.status === 401) {
              toast.error(MESSAGES.INVALID_CREDENTIALS);
              return;
            }

            // 403 = Forbidden - User Inactive
            if (ctx.error.status === 403) {
              toast.error(ctx.error.message);
              return;
            }

            handleFrontendErrorWithToast(ctx.error);
          },
        },
      );
    } catch (error) {
      handleFrontendErrorWithToast(error);
    } finally {
      setIsPending(false);
    }
  };

  // -------------------------------------------------------------------
  // View
  // -------------------------------------------------------------------
  return (
    <div className="w-full">
      <h1 className="font-heading text-3xl font-bold text-foreground">Welcome back</h1>
      <p className="mt-2 text-sm text-muted-foreground">Sign in to continue</p>

      {/* Email change confirmation */}
      {emailChanged && (
        <p role="status" className="mt-6 rounded-md bg-muted p-3 text-sm text-muted-foreground">
          {MESSAGES.EMAIL_CHANGED_SIGN_IN_AGAIN}
        </p>
      )}

      {/* Microsoft first: for an organisation using Entra it is the path
          almost everyone takes, and the password form below is the fallback
          for accounts not yet linked to a Microsoft identity. */}
      {microsoftEnabled && (
        <div className="mt-8 space-y-5">
          <MicrosoftSignInButton />
          <AuthMethodDivider />
        </div>
      )}

      <form onSubmit={form.handleSubmit(onSubmit)} className={microsoftEnabled ? "space-y-5" : "mt-8 space-y-5"}>
        <FormInputField
          control={form.control}
          name="email"
          label="Email"
          type="email"
          placeholder="name@example.com"
          autoComplete="email"
        />

        <FormInputField
          control={form.control}
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Controller
              control={form.control}
              name="rememberMe"
              render={({ field }) => (
                <Checkbox
                  id="rememberMe"
                  aria-label="Remember me"
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
              )}
            />

            <Label htmlFor="rememberMe">Remember me</Label>
          </div>

          <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
            Forgot password?
          </Link>
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={isPending || !form.formState.isValid}
          loading={isPending}
        >
          {isPending ? "Logging In..." : "Login"}
        </Button>
      </form>
    </div>
  );
}
