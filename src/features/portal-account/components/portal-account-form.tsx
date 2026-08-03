"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Bell, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import IconBadge from "@/components/icon-badge";
import { FormInputField } from "@/components/form/form-input-field";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { updatePortalAccountAction } from "../portal-account.actions";
import {
  PortalAccountResponseDTO,
  UpdatePortalAccountRequestDTO,
  UpdatePortalAccountSchema,
} from "../portal-account.types";

// -------------------------------------------------------------------
// Account details form
//
// A member edits their own name, preferred name, phone and notification
// preferences. Email and password are managed from Settings, so neither
// appears here.
//
// The form sends no id: the account it saves is whichever one the session
// belongs to, decided on the server.
// -------------------------------------------------------------------
export function PortalAccountForm({ account }: { account: PortalAccountResponseDTO }) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const form = useForm<UpdatePortalAccountRequestDTO>({
    resolver: zodResolver(UpdatePortalAccountSchema),
    mode: "onChange",
    defaultValues: {
      name: account.name,
      preferredName: account.preferredName,
      phoneNumber: account.phoneNumber,
      // One entry per active type. Preferences are opt-out, so a key that has
      // never been stored starts out checked.
      notificationPreferences: Object.fromEntries(
        account.notificationTypes.map((type) => [type.key, account.notificationPreferences[type.key] !== false]),
      ),
    },
  });

  const onSubmit = async (values: UpdatePortalAccountRequestDTO) => {
    if (isPending) return;
    setIsPending(true);

    try {
      const response = await updatePortalAccountAction(values);

      if (!response.success) {
        if (response.fieldErrors) {
          Object.entries(response.fieldErrors).forEach(([field, errors]) => {
            form.setError(field as keyof UpdatePortalAccountRequestDTO, { type: "server", message: errors[0] });
          });
        }
        toast.error(response.formError ?? "Could not save your details");
        return;
      }

      toast.success("Details updated");
      // Reset to the submitted values so the form is clean again and the save
      // button goes back to disabled until something else changes.
      form.reset(values);
      router.refresh();
    } catch (error) {
      handleFrontendErrorWithToast(error);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <IconBadge icon={UserRound} variant="soft" />
            <div className="space-y-0.5">
              <CardTitle className="font-heading text-xl">Your details</CardTitle>
              <CardDescription>How we address you and how we reach you.</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <FormInputField
            control={form.control}
            name="name"
            label="Full name"
            autoComplete="name"
            disabled={isPending}
          />

          <FormInputField
            control={form.control}
            name="preferredName"
            label="Preferred name"
            description="Optional. What we call you around the app."
            placeholder="What should we call you?"
            autoComplete="nickname"
            disabled={isPending}
          />

          <FormInputField
            control={form.control}
            name="phoneNumber"
            label="Phone number"
            description="Optional. Used only if we need to reach you about a session."
            type="tel"
            autoComplete="tel"
            placeholder="e.g. 0400 000 000"
            disabled={isPending}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <IconBadge icon={Bell} variant="soft" />
            <div className="space-y-0.5">
              <CardTitle className="font-heading text-xl">Email notifications</CardTitle>
              <CardDescription>Choose which emails you would like to receive.</CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {account.notificationTypes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              There are no notification types set up yet. Nothing to choose between for now.
            </p>
          ) : (
            <Controller
              control={form.control}
              name="notificationPreferences"
              render={({ field }) => {
                const preferences = field.value ?? {};

                return (
                  <fieldset className="space-y-3">
                    <legend className="sr-only">Email notifications</legend>

                    {account.notificationTypes.map((type) => (
                      <Label
                        key={type.key}
                        htmlFor={`notification-${type.key}`}
                        className="flex items-start gap-3 font-normal"
                      >
                        <Checkbox
                          id={`notification-${type.key}`}
                          checked={preferences[type.key] !== false}
                          onCheckedChange={(checked) =>
                            field.onChange({ ...preferences, [type.key]: checked === true })
                          }
                          disabled={isPending}
                          className="mt-0.5"
                        />
                        <span className="space-y-0.5">
                          <span className="block text-foreground">{type.name}</span>
                          {type.description && (
                            <span className="block text-xs text-muted-foreground">{type.description}</span>
                          )}
                        </span>
                      </Label>
                    ))}
                  </fieldset>
                );
              }}
            />
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={isPending || !form.formState.isValid || !form.formState.isDirty}
          loading={isPending}
        >
          {isPending ? "Saving" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
