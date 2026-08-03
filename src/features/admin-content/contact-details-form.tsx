"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { FormInputField } from "@/components/form/form-input-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useForm } from "react-hook-form";
import { SITE_CONTENT_KEYS } from "@/lib/data/kysely-database-types";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import { updateContactDetailsAction } from "./admin-content.actions";
import {
  SITE_CONTENT_LABELS,
  UpdateContactDetailsSchema,
  type ContactDetailsResponseDTO,
  type UpdateContactDetailsRequestDTO,
} from "./admin-content.types";
import { IgnoredValueNotice } from "./ignored-value-notice";
import { schemaResolver } from "./schema-resolver";

// -------------------------------------------------------------------
// Contact details
//
// Structured fields rather than rich text, because this block is read back as
// data: the email is the address public enquiries are delivered to. It is
// validated with the same schema the enquiry service parses it through, so a
// value that would silently fall back to the default cannot be saved.
// -------------------------------------------------------------------
export function ContactDetailsForm({ contact }: { contact: ContactDetailsResponseDTO }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const form = useForm<UpdateContactDetailsRequestDTO>({
    resolver: schemaResolver(UpdateContactDetailsSchema),
    mode: "onChange",
    defaultValues: contact.details,
  });

  const onSubmit = (values: UpdateContactDetailsRequestDTO) => {
    startTransition(async () => {
      try {
        const response = await updateContactDetailsAction(values);

        if (!response.success) {
          if (response.fieldErrors) {
            Object.entries(response.fieldErrors).forEach(([field, errors]) => {
              form.setError(field as keyof UpdateContactDetailsRequestDTO, {
                type: "server",
                message: errors[0],
              });
            });
          }
          toast.error(response.formError ?? "Could not save changes");
          return;
        }

        form.reset(values);
        toast.success(`${SITE_CONTENT_LABELS[SITE_CONTENT_KEYS.CONTACT]} saved`);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  const isDirty = form.formState.isDirty;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-xl">{SITE_CONTENT_LABELS[SITE_CONTENT_KEYS.CONTACT]}</CardTitle>
        <CardDescription>
          Shown on <span className="font-medium text-primary">{ROUTES.PUBLIC_CONTACT}</span> ·{" "}
          {contact.updatedAt ? `Updated ${formatUpdated(contact.updatedAt)}` : "Not yet edited"}
        </CardDescription>
      </CardHeader>

      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-(--card-spacing)">
        <CardContent className="grid gap-5 sm:grid-cols-2">
          {contact.isIgnored && (
            <div className="sm:col-span-2">
              <IgnoredValueNotice
                title="These details were ignored"
                description="The saved value could not be read, so the site is using the built-in defaults - including the address public enquiries are delivered to. The fields below are those defaults - save them to replace the stored value."
              />
            </div>
          )}
          <FormInputField
            control={form.control}
            name="email"
            id="contact-email"
            type="email"
            label="Email"
            description="Where enquiries from the public form are delivered."
            placeholder="hello@example.com"
            disabled={isPending}
          />
          <FormInputField
            control={form.control}
            name="phone"
            id="contact-phone"
            label="Phone"
            placeholder="Optional"
            disabled={isPending}
          />
          <FormInputField
            control={form.control}
            name="location"
            id="contact-location"
            label="Location"
            placeholder="Optional"
            disabled={isPending}
          />
          <FormInputField
            control={form.control}
            name="hours"
            id="contact-hours"
            label="Hours"
            placeholder="e.g. Mon to Fri, 9am to 5pm"
            disabled={isPending}
          />
        </CardContent>

        <CardFooter className="justify-end gap-3 border-t">
          <span
            className={isDirty ? "text-sm text-muted-foreground" : "text-sm text-transparent"}
            aria-hidden={!isDirty}
          >
            Unsaved changes
          </span>
          {/*
            Unreadable details can be saved without being edited. The form is
            seeded with the same defaults the notice above tells the admin to
            save, so it is never dirty - gating on isDirty alone would leave the
            enquiry address stuck on the default with no way back.
          */}
          <Button type="submit" disabled={!isDirty && !contact.isIgnored} loading={isPending}>
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function formatUpdated(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}
