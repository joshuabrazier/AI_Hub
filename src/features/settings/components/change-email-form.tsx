"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormInputField } from "@/components/form/form-input-field";
import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { changeEmailAction } from "../change-email.actions";
import { ChangeEmailForm as ChangeEmailValues, changeEmailSchema } from "../change-email.types";

// -------------------------------------------------------------------
// Change Email Form
// -------------------------------------------------------------------
export function ChangeEmailForm() {
  const [isPending, setIsPending] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  const form = useForm<ChangeEmailValues>({
    resolver: zodResolver(changeEmailSchema),
    mode: "onChange",
    defaultValues: {
      currentPassword: "",
      newEmail: "",
      confirmNewEmail: "",
    },
  });

  // -------------------------------------------------------------------
  // On Submit
  // -------------------------------------------------------------------
  const onSubmit = async (values: ChangeEmailValues) => {
    try {
      if (isPending) return;
      setIsPending(true);

      const response = await changeEmailAction({
        currentPassword: values.currentPassword,
        newEmail: values.newEmail,
      });

      if (!response.success) {
        toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
        return;
      }

      form.reset();
      setVerificationSent(true);
      toast.success(MESSAGES.CHANGE_EMAIL_VERIFICATION_SENT);
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
        <CardTitle className="text-xl">Change email</CardTitle>

        <CardDescription>Update the email address on your account.</CardDescription>
      </CardHeader>

      {/* Card Content */}
      <CardContent>
        {verificationSent ? (
          <p className="text-sm text-muted-foreground">
            A confirmation link has been sent to your new email address. Click it to finish changing your email.
          </p>
        ) : (
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Current Password */}
            <FormInputField
              control={form.control}
              name="currentPassword"
              label="Current password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={isPending}
            />

            {/* New Email */}
            <FormInputField
              control={form.control}
              name="newEmail"
              label="New email"
              type="email"
              placeholder="name@example.com"
              autoComplete="email"
              disabled={isPending}
            />

            {/* Confirm New Email */}
            <FormInputField
              control={form.control}
              name="confirmNewEmail"
              label="Confirm new email"
              type="email"
              placeholder="name@example.com"
              autoComplete="email"
              disabled={isPending}
            />

            {/* Submit Button */}
            <Button type="submit" className="w-full" disabled={isPending || !form.formState.isValid} loading={isPending}>
              {isPending ? "Saving..." : "Change email"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
