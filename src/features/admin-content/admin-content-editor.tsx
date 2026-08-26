"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { SITE_CONTENT_KEYS } from "@/lib/data/kysely-database-types";
import { ROUTES } from "@/lib/routes";
import { updateSiteContentAction } from "./admin-content.actions";
import { RichTextEditor } from "./rich-text-editor";
import { SITE_CONTENT_LABELS, SiteContentResponseDTO } from "./admin-content.types";

// Public path each editable page maps to (shown as a hint in the card). Not
// every key has a public page - the media consent is a document members sign -
// so this is partial and those keys get the fallback hint instead.
const PUBLIC_PATHS: Partial<Record<SiteContentResponseDTO["contentName"], string>> = {
  [SITE_CONTENT_KEYS.ABOUT]: ROUTES.PUBLIC_ABOUT,
  [SITE_CONTENT_KEYS.PRIVACY_POLICY]: ROUTES.PUBLIC_PRIVACY_POLICY,
  [SITE_CONTENT_KEYS.TERMS_AND_CONDITIONS]: ROUTES.PUBLIC_TERMS_AND_CONDITIONS,
};

function formatUpdated(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// -------------------------------------------------------------------
// Admin Content Editor
// One rich-text card per editable public page (About, Privacy, Terms) plus
// the media consent wording. The structured blocks - contact details and the
// home page - have their own forms; JSON does not belong in a rich-text box.
// -------------------------------------------------------------------
export function AdminContentEditor({ pages }: { pages: SiteContentResponseDTO[] }) {
  return (
    <div className="space-y-6">
      {pages.map((item) => (
        <RichTextSection key={item.contentName} item={item} />
      ))}
    </div>
  );
}

// Returns the STORED html on success, which is not always what was submitted:
// the value is sanitised on write. Returns undefined when nothing was saved -
// the action reports a failed write as an error rather than as success, so this
// never mistakes a lost edit for a saved one.
async function saveContent(
  contentName: SiteContentResponseDTO["contentName"],
  contentValue: string,
): Promise<string | undefined> {
  const response = await updateSiteContentAction({ contentName, contentValue });
  if (response.success) return response.data.contentValue;
  toast.error(response.formError ?? "Could not save changes");
  return undefined;
}

// -------------------------------------------------------------------
// Section header (shared)
// -------------------------------------------------------------------
function SectionHeader({ item }: { item: SiteContentResponseDTO }) {
  const publicPath = PUBLIC_PATHS[item.contentName];
  return (
    <CardHeader>
      <CardTitle className="font-heading text-xl">{SITE_CONTENT_LABELS[item.contentName]}</CardTitle>
      <CardDescription>
        {publicPath ? (
          <>
            Shown on <span className="font-medium text-primary">{publicPath}</span>
          </>
        ) : (
          // No public page - this is the wording members sign in their portal.
          <span className="font-medium text-primary">Signed by members in their Documents</span>
        )}
        {" · "}
        {item.updatedAt ? `Updated ${formatUpdated(item.updatedAt)}` : "Not yet edited"}
      </CardDescription>
    </CardHeader>
  );
}

function SaveFooter({ isDirty, isPending, onSave }: { isDirty: boolean; isPending: boolean; onSave: () => void }) {
  return (
    <CardFooter className="justify-end gap-3 border-t">
      <span className={isDirty ? "text-sm text-muted-foreground" : "text-sm text-transparent"} aria-hidden={!isDirty}>
        Unsaved changes
      </span>
      <Button onClick={onSave} disabled={!isDirty} loading={isPending}>
        {isPending ? "Saving…" : "Save changes"}
      </Button>
    </CardFooter>
  );
}

// -------------------------------------------------------------------
// Rich-text section (About, Privacy, Terms)
// -------------------------------------------------------------------
function RichTextSection({ item }: { item: SiteContentResponseDTO }) {
  const router = useRouter();
  const [savedValue, setSavedValue] = useState(item.contentValue);
  const [value, setValue] = useState(item.contentValue);
  // The editor takes its html as initial content only, so it is remounted when
  // the stored value differs from what was typed.
  const [editorKey, setEditorKey] = useState(0);
  const [isPending, setIsPending] = useState(false);

  const isDirty = value !== savedValue;

  const onSave = async () => {
    if (isPending || !isDirty) return;
    setIsPending(true);
    try {
      const storedValue = await saveContent(item.contentName, value);
      if (storedValue === undefined) return;

      // The baseline is what the row now HOLDS, not what was submitted. The
      // value is sanitised on write, so the two differ whenever the sanitiser
      // strips something, and taking the submitted text as the baseline would
      // have the card claim there is nothing to save while showing markup the
      // row does not contain. When they differ, show the stored text.
      setSavedValue(storedValue);
      if (storedValue !== value) {
        setValue(storedValue);
        setEditorKey((key) => key + 1);
      }

      toast.success(`${SITE_CONTENT_LABELS[item.contentName]} saved`);
      // Re-read the row so the header stops saying "Not yet edited" and shows
      // the date this save just wrote.
      router.refresh();
    } catch (error) {
      handleFrontendErrorWithToast(error);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Card>
      <SectionHeader item={item} />
      <CardContent>
        <RichTextEditor key={editorKey} value={savedValue} onChange={setValue} disabled={isPending} />
      </CardContent>
      <SaveFooter isDirty={isDirty} isPending={isPending} onSave={onSave} />
    </Card>
  );
}
