"use client";

import { useEffect, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import z from "zod";

import { FormInputField } from "@/components/form/form-input-field";
import { FormSelectField } from "@/components/form/form-select-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { SITE_CONTENT_KEYS, type SiteContentKey } from "@/lib/data/kysely-database-types";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { createDocumentAction, updateDocumentAction } from "../admin-documents.actions";
import { SIGNABLE_CONTENT_KEYS, type DocumentResponseDTO } from "../admin-documents.types";

// Human labels for the site content rows a document can point at. Derived from
// the keys rather than typed out, so a new content key cannot be forgotten here.
const CONTENT_KEY_LABELS: Record<SiteContentKey, string> = {
  [SITE_CONTENT_KEYS.ABOUT]: "About page",
  [SITE_CONTENT_KEYS.CONTACT]: "Contact details",
  [SITE_CONTENT_KEYS.PRIVACY_POLICY]: "Privacy policy",
  [SITE_CONTENT_KEYS.TERMS_AND_CONDITIONS]: "Terms and conditions",
  [SITE_CONTENT_KEYS.MEDIA_CONSENT]: "Media consent",
  [SITE_CONTENT_KEYS.LANDING_HERO]: "Home page hero",
  [SITE_CONTENT_KEYS.LANDING_HIGHLIGHTS]: "Home page highlights",
  [SITE_CONTENT_KEYS.LANDING_FEATURES]: "Home page features",
  [SITE_CONTENT_KEYS.LANDING_CTA]: "Home page call to action",
};

const CONTENT_KEY_OPTIONS = SIGNABLE_CONTENT_KEYS.map((key) => ({
  value: key,
  label: CONTENT_KEY_LABELS[key],
}));

// -------------------------------------------------------------------
// Client form schema
//
// `key` is only in the create form. Every signature snapshots the key it was
// signed under and the overview matches on that snapshot, so editing it would
// orphan the existing signatures - see UpdateDocumentSchema.
// -------------------------------------------------------------------
const DocumentFormSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "Key is required")
    .max(120)
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers and underscores only"),
  title: z.string().trim().min(1, "Title is required").max(120),
  version: z.string().trim().min(1, "Version is required").max(20),
  contentKey: z.enum(SITE_CONTENT_KEYS),
  isRequired: z.boolean(),
  orderBy: z.number().int().min(1).max(999),
  isActive: z.boolean(),
});

type DocumentFormValues = z.infer<typeof DocumentFormSchema>;

const toFormValues = (doc: DocumentResponseDTO | null): DocumentFormValues => ({
  key: doc?.key ?? "",
  title: doc?.title ?? "",
  version: doc?.version ?? "1.0",
  contentKey: doc?.contentKey ?? SIGNABLE_CONTENT_KEYS[0],
  isRequired: doc?.isRequired ?? true,
  orderBy: doc?.orderBy ?? 1,
  isActive: doc?.isActive ?? true,
});

type Props = {
  doc: DocumentResponseDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// -------------------------------------------------------------------
// Document form dialog (create + edit)
//
// The wording itself is not edited here. It lives in the site content row named
// by "Wording", so editing the text shows up immediately for new signers - and
// bumping the version is the separate, deliberate act that asks everybody to
// sign again.
// -------------------------------------------------------------------
export function DocumentFormDialog({ doc, open, onOpenChange }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEditing = !!doc;

  const form = useForm<DocumentFormValues>({
    resolver: zodResolver(DocumentFormSchema),
    mode: "onChange",
    defaultValues: toFormValues(doc),
  });

  useEffect(() => {
    form.reset(toFormValues(doc));
  }, [doc, open, form]);

  const onSubmit = (values: DocumentFormValues) => {
    startTransition(async () => {
      try {
        const response = isEditing
          ? await updateDocumentAction({
              id: doc.id,
              title: values.title,
              version: values.version,
              contentKey: values.contentKey,
              isRequired: values.isRequired,
              orderBy: values.orderBy,
              isActive: values.isActive,
            })
          : await createDocumentAction(values);

        if (!response.success) {
          if (response.fieldErrors) {
            Object.entries(response.fieldErrors).forEach(([field, errors]) => {
              form.setError(field as keyof DocumentFormValues, { type: "server", message: errors[0] });
            });
          }
          if (response.formError) toast.error(response.formError);
          return;
        }

        toast.success(isEditing ? "Document updated" : "Document created");
        router.refresh();
        onOpenChange(false);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) form.reset(toFormValues(doc));
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
        <DialogHeader className="text-center">
          <DialogTitle className="text-3xl font-extrabold">
            {isEditing ? "Edit document" : "Add document"}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {isEditing ? "Update this document's details" : "Add a document for members to read and sign"}
          </p>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 space-y-5 overflow-y-auto pr-1">
          {!isEditing && (
            <FormInputField
              control={form.control}
              name="key"
              label="Key"
              placeholder="e.g. terms_and_conditions"
              description="The stable identifier stored on every signature. It cannot be changed later."
            />
          )}

          <FormInputField
            control={form.control}
            name="title"
            label="Title"
            placeholder="e.g. Terms and conditions"
          />

          <FormSelectField
            control={form.control}
            name="contentKey"
            label="Wording"
            options={CONTENT_KEY_OPTIONS}
            description="The site content this document's text is read from. Edit the text under Site content."
          />

          <FormInputField
            control={form.control}
            name="version"
            label="Version"
            placeholder="e.g. 1.0"
            description="Bump this when a change should force everyone to sign again. Editing the wording alone does not."
          />

          <FormInputField
            control={form.control}
            name="orderBy"
            label="Order (1 = top)"
            type="number"
            inputMode="numeric"
            min={1}
            max={999}
            placeholder="e.g. 1"
            transformValue={(e) => (e.target.value === "" ? undefined : e.target.valueAsNumber)}
          />

          <Controller
            control={form.control}
            name="isRequired"
            render={({ field }) => (
              <div className="flex items-center justify-between">
                <label htmlFor="isRequired" className="text-sm font-medium">
                  Required
                </label>
                <Switch id="isRequired" checked={field.value} onCheckedChange={field.onChange} />
              </div>
            )}
          />

          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <div className="flex items-center justify-between">
                <label htmlFor="isActive" className="text-sm font-medium">
                  Active
                </label>
                <Switch id="isActive" checked={field.value} onCheckedChange={field.onChange} />
              </div>
            )}
          />

          <p className="text-sm text-muted-foreground">
            Retiring a document stops it being offered and stops it counting against anybody. The signatures
            already recorded for it are untouched.
          </p>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !form.formState.isValid} loading={isPending}>
              {isPending ? "Saving..." : isEditing ? "Save changes" : "Create document"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
