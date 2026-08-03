"use client";

import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

import { FormInputField } from "@/components/form/form-input-field";
import { FormSelectField } from "@/components/form/form-select-field";
import { FormTextareaField } from "@/components/form/form-textarea-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { cn } from "@/lib/utils";

import { submitEnquiryAction } from "./enquiry.actions";
import { EnquiryRequestDTO, EnquirySchema, WEEK_DAYS } from "./enquiry.types";

type CategoryOption = { value: string; label: string };

const defaultValues: EnquiryRequestDTO = {
  name: "",
  phone: "",
  email: "",
  category: "",
  preferredDays: [],
  message: "",
  company: "",
};

export function EnquiryForm({ categoryOptions }: { categoryOptions: CategoryOption[] }) {
  const [isPending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<EnquiryRequestDTO>({
    resolver: zodResolver(EnquirySchema),
    // onChange so formState.isValid tracks live and can gate the submit button.
    mode: "onChange",
    defaultValues,
  });

  const onSubmit = (values: EnquiryRequestDTO) => {
    startTransition(async () => {
      try {
        // Milliseconds since the page loaded - the server's time-trap drops
        // near-instant (bot) submits. Read at submit (event time), not render.
        const res = await submitEnquiryAction({ ...values, elapsedMs: Math.round(performance.now()) });

        if (!res.success) {
          if (res.fieldErrors) {
            Object.entries(res.fieldErrors).forEach(([field, errors]) => {
              if (field in values) {
                form.setError(field as keyof EnquiryRequestDTO, { type: "server", message: errors[0] });
              } else {
                toast.error(errors[0]);
              }
            });
          }
          if (res.formError) toast.error(res.formError);
          return;
        }

        setSubmitted(true);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border p-8 text-center sm:p-10">
        <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 size={28} aria-hidden="true" />
        </span>
        <h2 className="font-heading text-2xl font-bold text-foreground">Enquiry sent</h2>
        <p className="max-w-md text-muted-foreground">
          Thanks for reaching out. We&apos;ve received your enquiry and will be in touch soon.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            form.reset(defaultValues);
            setSubmitted(false);
          }}
        >
          Send another enquiry
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-7" noValidate>
      <FormInputField
        control={form.control}
        name="name"
        label="Your name"
        placeholder="e.g. Jamie Smith"
        disabled={isPending}
        className="h-11"
      />

      <div className="grid gap-x-6 gap-y-7 sm:grid-cols-2">
        <FormInputField
          control={form.control}
          name="email"
          label="Email"
          type="email"
          placeholder="you@example.com"
          disabled={isPending}
          className="h-11"
        />
        <FormInputField
          control={form.control}
          name="phone"
          label="Phone"
          type="tel"
          placeholder="0400 000 000"
          disabled={isPending}
          className="h-11"
        />
      </div>

      {/* The category list is admin-managed and can legitimately be empty on a
          fresh install. Rendering an empty dropdown would look broken, so the
          field is dropped entirely rather than shown with nothing to pick. */}
      {categoryOptions.length > 0 && (
        <FormSelectField
          control={form.control}
          name="category"
          label="What is your enquiry about?"
          placeholder="Select an option"
          options={categoryOptions}
          disabled={isPending}
          // The trigger's height comes from its data-size variant, so match
          // the h-11 inputs by overriding that variant (plain h-11 loses to it).
          className="data-[size=default]:h-11"
        />
      )}

      <Controller
        control={form.control}
        name="preferredDays"
        render={({ field }) => (
          <div className="grid gap-2">
            <Label>Preferred days</Label>
            <div className="flex flex-wrap gap-2">
              {WEEK_DAYS.map((day) => {
                const active = field.value.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={active}
                    disabled={isPending}
                    onClick={() =>
                      field.onChange(active ? field.value.filter((d) => d !== day) : [...field.value, day])
                    }
                    className={cn(
                      "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary hover:text-foreground",
                    )}
                  >
                    {day.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      />

      <FormTextareaField
        control={form.control}
        name="message"
        label="Short message"
        placeholder="Tell us anything else that helps, like what you're after, your availability, or questions."
        rows={4}
        disabled={isPending}
      />

      {/* Honeypot - hidden from people, catches bots. */}
      <div aria-hidden="true" className="hidden">
        <label htmlFor="company">Company</label>
        <input id="company" type="text" tabIndex={-1} autoComplete="off" {...form.register("company")} />
      </div>

      <div className="flex justify-center pt-2">
        <Button
          type="submit"
          size="lg"
          loading={isPending}
          disabled={isPending || !form.formState.isValid}
          className="px-10"
        >
          {isPending ? "Sending..." : "Send enquiry"}
        </Button>
      </div>
    </form>
  );
}
