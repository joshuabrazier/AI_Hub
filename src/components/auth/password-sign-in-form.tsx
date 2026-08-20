"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormInputField } from "@/components/form/form-input-field";
import { authClient } from "@/lib/auth/auth-client";
import { PASSWORD_INVALID_MESSAGE, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

// -------------------------------------------------------------------
// Password sign-in - LOCAL DEVELOPMENT ONLY.
//
// Rendered only when the server says password sign-in is registered
// (isPasswordSignInEnabled), passed down as a prop rather than read here, so
// no client bundle has to know anything about how that is decided. In any
// real environment this component never renders.
//
// There is no "forgot password" link and no sign-up link, because neither
// flow exists: a local account comes from scripts/create-dev-user.mjs. A link
// to a surface that is not there is worse than no link.
//
// The bounds below are the CLIENT half of the same rule Better Auth enforces
// server-side from PASSWORD_MIN_LENGTH / PASSWORD_MAX_LENGTH. They are here
// to give a useful message before a round trip, not to be the check.
// -------------------------------------------------------------------
const PasswordSignInSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(PASSWORD_MIN_LENGTH, PASSWORD_INVALID_MESSAGE).max(PASSWORD_MAX_LENGTH, PASSWORD_INVALID_MESSAGE),
});

type PasswordSignInValues = z.infer<typeof PasswordSignInSchema>;

export function PasswordSignInForm() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const form = useForm<PasswordSignInValues>({
    resolver: zodResolver(PasswordSignInSchema),
    mode: "onSubmit",
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: PasswordSignInValues) => {
    if (isPending) return;
    setIsPending(true);

    try {
      const { data, error } = await authClient.signIn.email({
        email: values.email,
        password: values.password,
      });

      if (error) {
        // Deliberately not distinguishing "no such account" from "wrong
        // password": the same answer for both is what stops the form being
        // used to find out which addresses have accounts. A local-only form
        // hardly needs that, but the habit is worth keeping.
        toast.error("Those details did not match an account.");
        setIsPending(false);
        return;
      }

      // 2FA is enrolled per user and the verification step has no page in
      // this app, so a user who has turned it on cannot finish signing in
      // here. Say so rather than silently landing them nowhere.
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        toast.error("That account has two-factor enabled, which password sign-in cannot complete.");
        setIsPending(false);
        return;
      }

      // The root routes by role, the same landing the Microsoft button uses.
      router.replace(ROUTES.PUBLIC_HOME);
      router.refresh();
    } catch (error) {
      handleFrontendErrorWithToast(error);
      setIsPending(false);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <FormInputField
        control={form.control}
        name="email"
        label="Email"
        type="email"
        autoComplete="username"
        placeholder="you@example.com"
        disabled={isPending}
      />

      <FormInputField
        control={form.control}
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        disabled={isPending}
      />

      <Button type="submit" className="w-full" disabled={isPending} loading={isPending}>
        Sign in
      </Button>
    </form>
  );
}
