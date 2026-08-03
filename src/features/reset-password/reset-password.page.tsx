"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormInputField } from "@/components/form/form-input-field";
import { authClient } from "@/lib/auth/auth-client";
import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import { ResetPasswordForm, resetPasswordSchema } from "./reset-password.types";

// -------------------------------------------------------------------
// Reset Password Page
// -------------------------------------------------------------------
export function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const error = searchParams.get("error");
  const [isPending, setIsPending] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  const form = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
    mode: "onChange",
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  const hasValidToken = !!token && !error;

  // -------------------------------------------------------------------
  // On Submit
  // -------------------------------------------------------------------
  const onSubmit = async (values: ResetPasswordForm) => {
    try {
      if (isPending || !token) return;

      await authClient.resetPassword(
        {
          newPassword: values.password,
          token,
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
            setIsComplete(true);
            toast.success(MESSAGES.PASSWORD_RESET_SUCCESSFULL);
          },
          onError: () => {
            toast.error(MESSAGES.SOMETHING_WENT_WRONG);
          },
        },
      );
    } catch (resetError) {
      handleFrontendErrorWithToast(resetError);
    } finally {
      setIsPending(false);
    }
  };

  // -------------------------------------------------------------------
  // View
  // -------------------------------------------------------------------
  return (
    <div className="w-full">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold text-foreground">Reset password</h1>
        <p className="text-muted-foreground">Choose a new password for your account.</p>
      </div>

      <div className="mt-8">
        {/* Invalid or expired token */}
        {!hasValidToken && (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              This reset link is invalid or has expired. Please request a new password reset link.
            </p>

            <Button size="lg" className="w-full" asChild>
              <Link href={ROUTES.PUBLIC_AUTH_FORGOT_PASSWORD}>Request new link</Link>
            </Button>
          </div>
        )}

        {/* Reset complete */}
        {hasValidToken && isComplete && (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">Your password has been reset. You can now sign in.</p>

            <Button size="lg" className="w-full" asChild>
              <Link href={ROUTES.PUBLIC_AUTH_SIGN_IN}>Back to sign in</Link>
            </Button>
          </div>
        )}

        {/* Reset password form */}
        {hasValidToken && !isComplete && (
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* New Password */}
            <FormInputField
              control={form.control}
              name="password"
              label="New password"
              type="password"
              autoComplete="new-password"
              disabled={isPending}
            />

            {/* Confirm Password */}
            <FormInputField
              control={form.control}
              name="confirmPassword"
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              disabled={isPending}
            />

            {/* Submit Button */}
            <Button type="submit" size="lg" className="w-full" disabled={isPending || !form.formState.isValid} loading={isPending}>
              {isPending ? "Saving..." : "Reset password"}
            </Button>

            {/* Back to sign in */}
            <Button variant="ghost" className="w-full" asChild>
              <Link href={ROUTES.PUBLIC_AUTH_SIGN_IN}>
                <ArrowLeft className="h-4 w-4" />
                Back to sign in
              </Link>
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
