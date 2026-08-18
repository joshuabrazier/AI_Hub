"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormInputField } from "@/components/form/form-input-field";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import { completeAccountSetupAction } from "../account-setup.actions";
import {
  CompleteAccountSetupSchema,
  type AccountSetupDTO,
  type CompleteAccountSetupRequestDTO,
} from "../account-setup.types";

// -------------------------------------------------------------------
// The one-time setup form.
//
// Email is rendered as read-only text and is NOT a form field. It is the
// link to the Microsoft identity and the value the domain allowlist is
// checked against, so it is not editable here and is not in the submitted
// shape at all - there is nothing to strip server-side because the schema
// cannot express it.
// -------------------------------------------------------------------
export function AccountSetupForm({ account }: { account: AccountSetupDTO }) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const form = useForm<CompleteAccountSetupRequestDTO>({
    resolver: zodResolver(CompleteAccountSetupSchema),
    mode: "onChange",
    defaultValues: {
      name: account.name,
      preferredName: account.preferredName,
      phoneNumber: account.phoneNumber,
    },
  });

  const onSubmit = async (values: CompleteAccountSetupRequestDTO) => {
    if (isPending) return;
    setIsPending(true);

    try {
      const response = await completeAccountSetupAction(values);

      if (!response.success) {
        if (response.fieldErrors) {
          Object.entries(response.fieldErrors).forEach(([field, errors]) => {
            form.setError(field as keyof CompleteAccountSetupRequestDTO, {
              type: "server",
              message: errors[0],
            });
          });
        }
        toast.error(response.formError ?? "Could not save your details");
        setIsPending(false);
        return;
      }

      // Straight to the app. The role decides where that is, and the server
      // works it out - this lands on the root, which routes by role.
      router.replace(ROUTES.PUBLIC_HOME);
      router.refresh();
    } catch (error) {
      handleFrontendErrorWithToast(error);
      setIsPending(false);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="mt-8 space-y-5">
      {/* Read-only, and shown so it is obvious which Microsoft account this
          is - useful for anybody who has more than one. */}
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Signed in as
        </p>
        <p className="mt-0.5 truncate text-sm font-medium text-foreground">{account.email}</p>
      </div>

      <FormInputField
        control={form.control}
        name="name"
        label="Full name"
        placeholder="e.g. Alex Taylor"
        autoComplete="name"
        disabled={isPending}
      />

      <FormInputField
        control={form.control}
        name="preferredName"
        label="Preferred name"
        description="What colleagues actually call you. Optional."
        placeholder="e.g. Alex"
        autoComplete="nickname"
        disabled={isPending}
      />

      <FormInputField
        control={form.control}
        name="phoneNumber"
        label="Phone"
        description="Optional."
        type="tel"
        autoComplete="tel"
        placeholder="e.g. 0400 000 000"
        disabled={isPending}
      />

      <Button type="submit" className="w-full" disabled={isPending || !form.formState.isValid} loading={isPending}>
        {isPending ? "Saving" : "Continue"}
      </Button>
    </form>
  );
}
