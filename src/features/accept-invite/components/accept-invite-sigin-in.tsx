"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AuthMethodDivider, MicrosoftSignInButton } from "@/components/auth/microsoft-sign-in-button";
import { Button } from "@/components/ui/button";
import { FormInputField } from "@/components/form/form-input-field";
import { useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { AcceptInviteAndSignUpRequestDTO, AcceptInviteAndSignUpSchema } from "../accept-invite.types";
import { acceptInviteAndSignUpAction } from "../accept-invite.actions";
import { Path, useForm } from "react-hook-form";
import { BRAND } from "@/lib/brand";
import { MESSAGES } from "@/lib/constants";
import { roleHome } from "@/lib/routes";

type AcceptInviteSignInProps = {
  // Whether Entra is configured on this deployment.
  microsoftEnabled?: boolean;
  inviteToken: string;
  name: string;
  email: string;
  role: string;
};

type FormValues = AcceptInviteAndSignUpRequestDTO;

// -------------------------------------------------------------------
// Accept Invite Sign In
// -------------------------------------------------------------------
export function AcceptInviteSignIn({
  inviteToken,
  name,
  email,
  role,
  microsoftEnabled = false,
}: AcceptInviteSignInProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const form = useForm<FormValues>({
    resolver: zodResolver(AcceptInviteAndSignUpSchema),
    // onTouched so validation errors only appear after a field is touched/blurred,
    // not while the user is still typing their first entry.
    mode: "onTouched",
    defaultValues: {
      inviteToken: inviteToken,
      password: "",
      confirmPassword: "",
    },
  });

  // -------------------------------------------------------------------
  // On Submit
  // -------------------------------------------------------------------
  const onSubmit = async (values: FormValues) => {
    startTransition(async () => {
      try {
        const response = await acceptInviteAndSignUpAction(values);

        if (!response.success) {
          if (response.fieldErrors) {
            Object.entries(response.fieldErrors).forEach(([field, errors]) => {
              if (errors && errors.length > 0) {
                form.setError(field as Path<FormValues>, {
                  type: "server",
                  message: errors[0],
                });
              }
            });
          }

          if (response.formError) {
            toast.error(response.formError);
          }

          return;
        }

        toast.success(MESSAGES.SIGN_IN_SUCCESSFULL);

        // Land in the area their role belongs to. roleHome is the single
        // answer to that question, and it sends an unrecognised role to the
        // least privileged area rather than the most.
        router.replace(roleHome(role));
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  // -------------------------------------------------------------------
  // View
  // -------------------------------------------------------------------
  return (
    <div className="w-full">
      <h1 className="font-heading text-3xl font-bold text-foreground">Welcome {name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Set a password to finish setting up your {BRAND.name} account.
      </p>

      {/* The address the invitation was sent to. Shown because it becomes the
          sign-in name and cannot be changed here - if it is wrong, the person
          needs a new invitation rather than a different password. */}
      <p className="mt-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
        {email}
      </p>

      {/* Accepting the invitation with Microsoft. The invitation is still
          the gate: this button completes an Entra sign-in, and the account
          is only created if the address Microsoft asserts has a usable
          invitation of its own. Somebody cannot accept a colleague's invite
          with their own Microsoft account, because the check is against the
          verified address rather than the token in the link. */}
      {microsoftEnabled && (
        <div className="mt-8 space-y-5">
          <MicrosoftSignInButton />
          <AuthMethodDivider />
        </div>
      )}

      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={microsoftEnabled ? "space-y-5" : "mt-8 space-y-5"}
      >
        {/* Password */}
        <FormInputField
          control={form.control}
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
        />
        {/* Confirm Password */}
        <FormInputField
          control={form.control}
          name="confirmPassword"
          label="Confirm Password"
          type="password"
          autoComplete="current-password"
        />
        {/* Submit Button */}
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
