"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormInputField } from "@/components/form/form-input-field";
import { authClient } from "@/lib/auth/auth-client";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import { MESSAGES } from "@/lib/constants";

import { ForgotPasswordForm, forgotPasswordSchema } from "./forgot-password.types";

// -------------------------------------------------------------------
// Forgot Password Page
// -------------------------------------------------------------------
export function ForgotPasswordPage() {
  const [isPending, setIsPending] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const form = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: "onChange",
    defaultValues: {
      email: "",
    },
  });

  // -------------------------------------------------------------------
  // On Submit
  // -------------------------------------------------------------------
  const onSubmit = async (values: ForgotPasswordForm) => {
    try {
      if (isPending) return;

      await authClient.requestPasswordReset(
        {
          email: values.email,
          redirectTo: new URL(ROUTES.PUBLIC_AUTH_RESET_PASSWORD, window.location.origin).toString(),
        },
        {
          onRequest: () => {
            setIsPending(true);
          },
          onResponse: () => {
            setIsPending(false);
          },
          onSuccess: () => {
            form.reset();
            setHasSubmitted(true);
            toast.success(MESSAGES.PASSWORD_RESET_LINK_SENT);
          },
          onError: () => {
            setHasSubmitted(true);
            toast.success(MESSAGES.PASSWORD_RESET_LINK_SENT);
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
      <h1 className="font-heading text-3xl font-bold text-foreground">Forgot password</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter your email address and we will send you a link to reset your password.
      </p>

      <form onSubmit={form.handleSubmit(onSubmit)} className="mt-8 space-y-6">
        {/* Email */}
        <FormInputField
          control={form.control}
          name="email"
          label="Email"
          type="email"
          placeholder="name@example.com"
          autoComplete="email"
          disabled={isPending}
        />

        {/* Success message */}
        {hasSubmitted && <p className="text-sm text-muted-foreground">{MESSAGES.PASSWORD_RESET_LINK_SENT}</p>}

        {/* Submit Button */}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={isPending || !form.formState.isValid}
          loading={isPending}
        >
          {isPending ? "Sending..." : "Send reset link"}
        </Button>

        {/* Back to sign in */}
        <Button variant="ghost" className="w-full" asChild>
          <Link href={ROUTES.PUBLIC_AUTH_SIGN_IN}>
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </Button>
      </form>
    </div>
  );
}
