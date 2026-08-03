"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormInputField } from "@/components/form/form-input-field";
import { authClient } from "@/lib/auth/auth-client";
import { useSession } from "@/lib/auth/use-session-auth-client";
import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { roleHome } from "@/lib/routes";

import { ChangePasswordForm as ChangePasswordValues, changePasswordSchema } from "../change-password.types";

// -------------------------------------------------------------------
// Change Password Form
// -------------------------------------------------------------------
export function ChangePasswordForm() {
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();
  const { user } = useSession();

  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    mode: "onChange",
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    },
  });

  // -------------------------------------------------------------------
  // On Submit
  // -------------------------------------------------------------------
  const onSubmit = async (values: ChangePasswordValues) => {
    try {
      if (isPending) return;

      await authClient.changePassword(
        {
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
          // Sign out other devices when the password changes
          revokeOtherSessions: true,
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
            toast.success(MESSAGES.PASSWORD_CHANGED_SUCCESSFULL);
            // roleHome already sends an unknown or empty role to the least
            // privileged area, so a missing session needs no special case -
            // and must not fall back to the admin dashboard.
            router.push(roleHome(user?.role ?? ""));
          },
          onError: (ctx) => {
            // The new password is validated client-side, so a 400 here means the
            // current password was rejected; treat anything else as unexpected.
            if (ctx.error.status === 400) {
              toast.error(MESSAGES.CURRENT_PASSWORD_INCORRECT);
              return;
            }

            toast.error(MESSAGES.SOMETHING_WENT_WRONG);
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
    <Card className="w-full">
      {/* Card Header */}
      <CardHeader className="space-y-1">
        <CardTitle className="text-xl">Change password</CardTitle>

        <CardDescription>Enter your current password and choose a new one.</CardDescription>
      </CardHeader>

      {/* Card Content */}
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Current Password */}
          <FormInputField
            control={form.control}
            name="currentPassword"
            label="Current password"
            type="password"
            autoComplete="current-password"
            disabled={isPending}
          />

          {/* New Password */}
          <FormInputField
            control={form.control}
            name="newPassword"
            label="New password"
            type="password"
            autoComplete="new-password"
            disabled={isPending}
          />

          {/* Confirm New Password */}
          <FormInputField
            control={form.control}
            name="confirmNewPassword"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            disabled={isPending}
          />

          {/* Submit Button */}
          <Button type="submit" className="w-full" disabled={isPending || !form.formState.isValid} loading={isPending}>
            {isPending ? "Saving..." : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
