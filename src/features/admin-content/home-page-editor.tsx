"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { FormInputField } from "@/components/form/form-input-field";
import { FormTextareaField } from "@/components/form/form-textarea-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  landingCtaSchema,
  landingFeaturesSchema,
  landingHeroSchema,
  landingHighlightsSchema,
  type LandingCta,
  type LandingFeatures,
  type LandingHero,
  type LandingHighlight,
  type LandingHighlights,
} from "@/features/site-content/landing-content.types";
import { SITE_CONTENT_KEYS } from "@/lib/data/kysely-database-types";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";

import { updateLandingBlockAction } from "./admin-content.actions";
import {
  SITE_CONTENT_LABELS,
  type LandingContentKey,
  type LandingContentResponseDTO,
  type UpdateLandingBlockRequestDTO,
} from "./admin-content.types";
import { IgnoredValueNotice } from "./ignored-value-notice";
import { LandingIconPicker } from "./landing-icon-picker";
import { schemaResolver } from "./schema-resolver";

// -------------------------------------------------------------------
// Home page editor
//
// One form per block, each saving on its own so a half-finished edit to the
// features never blocks a one-word fix to the headline.
//
// Every form validates with the SAME schema the public page reads the block
// back through. That is the whole point: a value the page cannot render is
// rejected here instead of being stored and then silently ignored in favour of
// the shipped default, which looks from the admin's side like the save did
// nothing at all.
// -------------------------------------------------------------------

const EMPTY_HIGHLIGHT: LandingHighlight = { icon: "sparkles", title: "", body: "" };
const EMPTY_FEATURE: LandingFeatures["items"][number] = { icon: "sparkles", title: "", description: "" };

// react-hook-form needs an object at the top level; the highlights block is a
// bare array. Wrapping the shared schema keeps one set of rules rather than a
// second, looser copy of them.
const highlightsFormSchema = z.object({ items: landingHighlightsSchema });
type HighlightsFormValues = z.infer<typeof highlightsFormSchema>;

// -------------------------------------------------------------------
// How many rows a block allows.
//
// Read off the shared schema rather than repeated as a number here, so the Add
// button and the validation cannot drift apart. If the schema ever stops
// carrying a max, this returns undefined and Add simply stays enabled - the
// schema still refuses the save, so the failure mode is a clear error rather
// than a silently wrong cap.
// -------------------------------------------------------------------
function arrayMaxLength(schema: { def: { checks?: readonly unknown[] } }): number | undefined {
  for (const check of schema.def.checks ?? []) {
    const def = (check as { _zod?: { def?: { check?: string; maximum?: number } } })._zod?.def;
    if (def?.check === "max_length" && typeof def.maximum === "number") return def.maximum;
  }
  return undefined;
}

const MAX_HIGHLIGHTS = arrayMaxLength(landingHighlightsSchema);
const MAX_FEATURES = arrayMaxLength(landingFeaturesSchema.shape.items);

function canAddRow(count: number, max: number | undefined): boolean {
  return max === undefined || count < max;
}

// -------------------------------------------------------------------
// Save one block. The form has already validated against the same schema the
// action uses, so a field error coming back means the two disagreed - show it
// as it is rather than pinning it to a field whose name may not line up with
// the server's path.
// -------------------------------------------------------------------
async function saveBlock(request: UpdateLandingBlockRequestDTO): Promise<boolean> {
  const response = await updateLandingBlockAction(request);
  if (response.success) return true;

  const firstFieldError = Object.values(response.fieldErrors ?? {})[0]?.[0];
  toast.error(response.formError ?? firstFieldError ?? "Could not save changes");
  return false;
}

export function AdminHomePageEditor({ content }: { content: LandingContentResponseDTO }) {
  const isIgnored = (key: LandingContentKey) => content.invalidKeys.includes(key);

  return (
    <div className="space-y-6">
      <HeroSection hero={content.hero} isIgnored={isIgnored(SITE_CONTENT_KEYS.LANDING_HERO)} />
      <HighlightsSection
        highlights={content.highlights}
        isIgnored={isIgnored(SITE_CONTENT_KEYS.LANDING_HIGHLIGHTS)}
      />
      <FeaturesSection features={content.features} isIgnored={isIgnored(SITE_CONTENT_KEYS.LANDING_FEATURES)} />
      <CtaSection cta={content.cta} isIgnored={isIgnored(SITE_CONTENT_KEYS.LANDING_CTA)} />
    </div>
  );
}

// -------------------------------------------------------------------
// Shared card shell
// -------------------------------------------------------------------
function BlockCard({
  contentKey,
  description,
  isIgnored,
  isDirty,
  isPending,
  onSubmit,
  children,
}: {
  contentKey: LandingContentKey;
  description: string;
  isIgnored: boolean;
  isDirty: boolean;
  isPending: boolean;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-xl">{SITE_CONTENT_LABELS[contentKey]}</CardTitle>
        <CardDescription>
          Shown on <span className="font-medium text-primary">{ROUTES.PUBLIC_HOME}</span> · {description}
        </CardDescription>
      </CardHeader>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-(--card-spacing)">
        <CardContent className="space-y-5">
          {isIgnored && (
            <IgnoredValueNotice
              title="This block was ignored"
              description="The saved value could not be read, so the home page is showing the built-in default. The fields below are that default - save them to replace the stored value."
            />
          )}
          {children}
        </CardContent>

        <CardFooter className="justify-end gap-3 border-t">
          <span
            className={isDirty ? "text-sm text-muted-foreground" : "text-sm text-transparent"}
            aria-hidden={!isDirty}
          >
            Unsaved changes
          </span>
          {/*
            An ignored block can be saved without being edited. Its form is
            seeded with the very default the notice above tells the admin to
            save, so it is never dirty - gating on isDirty alone would leave the
            only way out of a corrupt row disabled.
          */}
          <Button type="submit" disabled={!isDirty && !isIgnored} loading={isPending}>
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

// -------------------------------------------------------------------
// A repeatable row: number, reorder and remove controls, then its fields.
// -------------------------------------------------------------------
function RepeatableRow({
  label,
  index,
  count,
  disabled,
  onMoveUp,
  onMoveDown,
  onRemove,
  children,
}: {
  label: string;
  index: number;
  count: number;
  disabled: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  const position = `${label} ${index + 1}`;

  return (
    <li className="rounded-xl border border-border bg-muted/40 p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">{position}</span>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled || index === 0}
            onClick={onMoveUp}
            aria-label={`Move ${position} up`}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled || index === count - 1}
            onClick={onMoveDown}
            aria-label={`Move ${position} down`}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            onClick={onRemove}
            aria-label={`Remove ${position}`}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4">{children}</div>
    </li>
  );
}

function AddRowButton({
  label,
  disabled,
  atLimit,
  max,
  onClick,
}: {
  label: string;
  disabled: boolean;
  atLimit: boolean;
  max: number | undefined;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Button type="button" variant="outline" size="lg" disabled={disabled || atLimit} onClick={onClick}>
        <Plus aria-hidden="true" />
        {label}
      </Button>
      {atLimit && max !== undefined && (
        <p className="text-sm text-muted-foreground">The home page shows at most {max}.</p>
      )}
    </div>
  );
}

// -------------------------------------------------------------------
// Hero
// -------------------------------------------------------------------
function HeroSection({ hero, isIgnored }: { hero: LandingHero; isIgnored: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const form = useForm<LandingHero>({
    resolver: schemaResolver(landingHeroSchema),
    mode: "onChange",
    defaultValues: hero,
  });

  const secondaryCta = useWatch({ control: form.control, name: "secondaryCta" });

  const onSubmit = (values: LandingHero) => {
    startTransition(async () => {
      try {
        if (!(await saveBlock({ contentName: SITE_CONTENT_KEYS.LANDING_HERO, value: values }))) return;
        form.reset(values);
        toast.success(`${SITE_CONTENT_LABELS[SITE_CONTENT_KEYS.LANDING_HERO]} saved`);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  return (
    <BlockCard
      contentKey={SITE_CONTENT_KEYS.LANDING_HERO}
      description="The headline a first-time visitor reads."
      isIgnored={isIgnored}
      isDirty={form.formState.isDirty}
      isPending={isPending}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <FormInputField
        control={form.control}
        name="eyebrow"
        id="hero-eyebrow"
        label="Eyebrow"
        description="The small label above the heading. Leave it blank to hide it."
        placeholder="e.g. Portal"
        disabled={isPending}
      />

      <FormInputField
        control={form.control}
        name="heading"
        id="hero-heading"
        label="Heading"
        placeholder="e.g. Everything your people need, in one place"
        disabled={isPending}
      />

      <FormTextareaField
        control={form.control}
        name="subheading"
        id="hero-subheading"
        label="Subheading"
        rows={3}
        placeholder="One sentence on what the portal does."
        disabled={isPending}
      />

      <fieldset className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
        <legend className="px-1 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Primary button
        </legend>
        <FormInputField
          control={form.control}
          name="primaryCta.label"
          id="hero-primary-label"
          label="Label"
          placeholder="e.g. Get in touch"
          disabled={isPending}
        />
        <FormInputField
          control={form.control}
          name="primaryCta.href"
          id="hero-primary-href"
          label="Link"
          description="A path on this site, or a mailto: / tel: link."
          placeholder="/contact"
          disabled={isPending}
        />
      </fieldset>

      <fieldset className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
        <legend className="px-1 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Secondary button
        </legend>

        {secondaryCta ? (
          <>
            <FormInputField
              control={form.control}
              name="secondaryCta.label"
              id="hero-secondary-label"
              label="Label"
              placeholder="e.g. Sign in"
              disabled={isPending}
            />
            <FormInputField
              control={form.control}
              name="secondaryCta.href"
              id="hero-secondary-href"
              label="Link"
              description="A path on this site, or a mailto: / tel: link."
              placeholder="/sign-in"
              disabled={isPending}
            />
            <div className="sm:col-span-2">
              <Button
                type="button"
                variant="ghost"
                size="lg"
                disabled={isPending}
                className="text-muted-foreground hover:text-destructive"
                onClick={() =>
                  form.setValue("secondaryCta", undefined, { shouldDirty: true, shouldValidate: true })
                }
              >
                <Trash2 aria-hidden="true" />
                Remove secondary button
              </Button>
            </div>
          </>
        ) : (
          <div className="sm:col-span-2 flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">The hero has one button. Add a second if you need it.</p>
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={isPending}
              className="self-start"
              onClick={() =>
                form.setValue(
                  "secondaryCta",
                  { label: "", href: "" },
                  { shouldDirty: true, shouldValidate: true },
                )
              }
            >
              <Plus aria-hidden="true" />
              Add secondary button
            </Button>
          </div>
        )}
      </fieldset>
    </BlockCard>
  );
}

// -------------------------------------------------------------------
// Highlights
// -------------------------------------------------------------------
function HighlightsSection({ highlights, isIgnored }: { highlights: LandingHighlights; isIgnored: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const form = useForm<HighlightsFormValues>({
    resolver: schemaResolver(highlightsFormSchema),
    mode: "onChange",
    defaultValues: { items: highlights },
  });

  const { fields, append, remove, move } = useFieldArray({ control: form.control, name: "items" });
  const rowsError = form.formState.errors.items?.root?.message ?? form.formState.errors.items?.message;

  const onSubmit = (values: HighlightsFormValues) => {
    startTransition(async () => {
      try {
        const saved = await saveBlock({
          contentName: SITE_CONTENT_KEYS.LANDING_HIGHLIGHTS,
          value: values.items,
        });
        if (!saved) return;
        form.reset(values);
        toast.success(`${SITE_CONTENT_LABELS[SITE_CONTENT_KEYS.LANDING_HIGHLIGHTS]} saved`);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  return (
    <BlockCard
      contentKey={SITE_CONTENT_KEYS.LANDING_HIGHLIGHTS}
      description="Short claims under the hero, each with an icon."
      isIgnored={isIgnored}
      isDirty={form.formState.isDirty}
      isPending={isPending}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No highlights. The section is hidden on the home page until you add one.
        </p>
      ) : (
        <ul className="space-y-4">
          {fields.map((field, index) => (
            <RepeatableRow
              key={field.id}
              label="Highlight"
              index={index}
              count={fields.length}
              disabled={isPending}
              onMoveUp={() => move(index, index - 1)}
              onMoveDown={() => move(index, index + 1)}
              onRemove={() => remove(index)}
            >
              <Controller
                control={form.control}
                name={`items.${index}.icon`}
                render={({ field: iconField }) => (
                  <LandingIconPicker
                    id={`highlight-${index}-icon`}
                    label="Icon"
                    value={iconField.value}
                    onChange={iconField.onChange}
                    disabled={isPending}
                  />
                )}
              />
              <FormInputField
                control={form.control}
                name={`items.${index}.title`}
                id={`highlight-${index}-title`}
                label="Title"
                placeholder="e.g. Secure by default"
                disabled={isPending}
              />
              <FormTextareaField
                control={form.control}
                name={`items.${index}.body`}
                id={`highlight-${index}-body`}
                label="Body"
                rows={2}
                placeholder="One sentence backing the claim."
                disabled={isPending}
              />
            </RepeatableRow>
          ))}
        </ul>
      )}

      {rowsError && (
        <p role="alert" className="text-sm text-destructive">
          {rowsError}
        </p>
      )}

      <AddRowButton
        label="Add highlight"
        disabled={isPending}
        atLimit={!canAddRow(fields.length, MAX_HIGHLIGHTS)}
        max={MAX_HIGHLIGHTS}
        onClick={() => append(EMPTY_HIGHLIGHT)}
      />
    </BlockCard>
  );
}

// -------------------------------------------------------------------
// Features
// -------------------------------------------------------------------
function FeaturesSection({ features, isIgnored }: { features: LandingFeatures; isIgnored: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const form = useForm<LandingFeatures>({
    resolver: schemaResolver(landingFeaturesSchema),
    mode: "onChange",
    defaultValues: features,
  });

  const { fields, append, remove, move } = useFieldArray({ control: form.control, name: "items" });
  const rowsError = form.formState.errors.items?.root?.message ?? form.formState.errors.items?.message;

  const onSubmit = (values: LandingFeatures) => {
    startTransition(async () => {
      try {
        if (!(await saveBlock({ contentName: SITE_CONTENT_KEYS.LANDING_FEATURES, value: values }))) return;
        form.reset(values);
        toast.success(`${SITE_CONTENT_LABELS[SITE_CONTENT_KEYS.LANDING_FEATURES]} saved`);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  return (
    <BlockCard
      contentKey={SITE_CONTENT_KEYS.LANDING_FEATURES}
      description="The card grid, with its own heading and intro."
      isIgnored={isIgnored}
      isDirty={form.formState.isDirty}
      isPending={isPending}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <FormInputField
        control={form.control}
        name="heading"
        id="features-heading"
        label="Heading"
        placeholder="e.g. What you can run from here"
        disabled={isPending}
      />

      <FormTextareaField
        control={form.control}
        name="intro"
        id="features-intro"
        label="Intro"
        rows={2}
        placeholder="A line under the heading. Leave it blank to hide it."
        disabled={isPending}
      />

      {fields.length > 0 && (
        <ul className="space-y-4">
          {fields.map((field, index) => (
            <RepeatableRow
              key={field.id}
              label="Feature"
              index={index}
              count={fields.length}
              disabled={isPending}
              onMoveUp={() => move(index, index - 1)}
              onMoveDown={() => move(index, index + 1)}
              onRemove={() => remove(index)}
            >
              <Controller
                control={form.control}
                name={`items.${index}.icon`}
                render={({ field: iconField }) => (
                  <LandingIconPicker
                    id={`feature-${index}-icon`}
                    label="Icon"
                    value={iconField.value}
                    onChange={iconField.onChange}
                    disabled={isPending}
                  />
                )}
              />
              <FormInputField
                control={form.control}
                name={`items.${index}.title`}
                id={`feature-${index}-title`}
                label="Title"
                placeholder="e.g. Scheduling and attendance"
                disabled={isPending}
              />
              <FormTextareaField
                control={form.control}
                name={`items.${index}.description`}
                id={`feature-${index}-description`}
                label="Description"
                rows={2}
                placeholder="What this actually does for them."
                disabled={isPending}
              />
            </RepeatableRow>
          ))}
        </ul>
      )}

      {rowsError && (
        <p role="alert" className="text-sm text-destructive">
          {rowsError}
        </p>
      )}

      <AddRowButton
        label="Add feature"
        disabled={isPending}
        atLimit={!canAddRow(fields.length, MAX_FEATURES)}
        max={MAX_FEATURES}
        onClick={() => append(EMPTY_FEATURE)}
      />
    </BlockCard>
  );
}

// -------------------------------------------------------------------
// Closing call to action
// -------------------------------------------------------------------
function CtaSection({ cta, isIgnored }: { cta: LandingCta; isIgnored: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const form = useForm<LandingCta>({
    resolver: schemaResolver(landingCtaSchema),
    mode: "onChange",
    defaultValues: cta,
  });

  const onSubmit = (values: LandingCta) => {
    startTransition(async () => {
      try {
        if (!(await saveBlock({ contentName: SITE_CONTENT_KEYS.LANDING_CTA, value: values }))) return;
        form.reset(values);
        toast.success(`${SITE_CONTENT_LABELS[SITE_CONTENT_KEYS.LANDING_CTA]} saved`);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  return (
    <BlockCard
      contentKey={SITE_CONTENT_KEYS.LANDING_CTA}
      description="The last thing on the page, and the ask."
      isIgnored={isIgnored}
      isDirty={form.formState.isDirty}
      isPending={isPending}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <FormInputField
        control={form.control}
        name="heading"
        id="cta-heading"
        label="Heading"
        placeholder="e.g. Ready to take a look?"
        disabled={isPending}
      />

      <FormTextareaField
        control={form.control}
        name="body"
        id="cta-body"
        label="Body"
        rows={2}
        placeholder="A line before the button. Leave it blank to hide it."
        disabled={isPending}
      />

      <fieldset className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
        <legend className="px-1 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Button</legend>
        <FormInputField
          control={form.control}
          name="cta.label"
          id="cta-button-label"
          label="Label"
          placeholder="e.g. Start a conversation"
          disabled={isPending}
        />
        <FormInputField
          control={form.control}
          name="cta.href"
          id="cta-button-href"
          label="Link"
          description="A path on this site, or a mailto: / tel: link."
          placeholder="/contact"
          disabled={isPending}
        />
      </fieldset>
    </BlockCard>
  );
}
