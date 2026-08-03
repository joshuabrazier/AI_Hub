"use client";

import { useState, useTransition } from "react";
import { LayoutTemplate, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RichTextEditor } from "@/features/admin-content/rich-text-editor";
import { MESSAGES } from "@/lib/constants";
import { NOTIFICATION_AUDIENCE_TYPES } from "@/lib/data/kysely-database-types";

import { sendNotificationAction } from "../notifications.actions";
import type { NotificationAudienceOptionsDTO, NotificationTemplateDTO } from "../notifications.types";
import {
  AudiencePicker,
  emptyAudienceDraft,
  isAudienceDraftComplete,
  toAudienceRequest,
  type AudienceDraft,
} from "./audience-picker";

const NO_TEMPLATE = "none";

// -------------------------------------------------------------------
// NotificationComposerDialog
//
// Compose and send. Two entry points share it:
//   "New notification" - omit `templates` for a blank form.
//   "From template"    - pass `templates` to show a picker that pre-fills the
//                        type, title and message.
//
// A template never carries an audience. Who a message goes to is chosen every
// time it is sent, so a saved target can never outlive the sender's access to it.
// -------------------------------------------------------------------
export function NotificationComposerDialog({
  audience,
  notificationTypes,
  templates,
  triggerLabel,
  triggerVariant = "default",
  dialogTitle,
  dialogDescription,
}: {
  audience: NotificationAudienceOptionsDTO;
  notificationTypes: { key: string; name: string }[];
  templates?: NotificationTemplateDTO[];
  triggerLabel: string;
  triggerVariant?: "default" | "outline";
  dialogTitle: string;
  dialogDescription: string;
}) {
  const defaultType = notificationTypes[0]?.key ?? "";
  // A manager has no "Everyone", so their form opens on teams instead.
  const defaultAudienceType = audience.canAddressEveryone
    ? NOTIFICATION_AUDIENCE_TYPES.EVERYONE
    : NOTIFICATION_AUDIENCE_TYPES.TEAMS;

  // The trigger icon is chosen here rather than passed in: icon components
  // cannot cross the server-to-client boundary as props.
  const TriggerIcon = templates ? LayoutTemplate : Plus;

  const [open, setOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(NO_TEMPLATE);
  const [type, setType] = useState<string>(defaultType);
  const [audienceDraft, setAudienceDraft] = useState<AudienceDraft>(emptyAudienceDraft(defaultAudienceType));
  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [editorInitialHtml, setEditorInitialHtml] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [isPending, startTransition] = useTransition();

  const resetForm = () => {
    setSelectedTemplateId(NO_TEMPLATE);
    setType(defaultType);
    setAudienceDraft(emptyAudienceDraft(defaultAudienceType));
    setTitle("");
    setBodyHtml("");
    setEditorInitialHtml("");
    setEditorKey((previous) => previous + 1);
  };

  const applyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);

    const template = templates?.find((candidate) => candidate.id === templateId);
    // "Choose a template" or an unknown id clears the content fields. The
    // audience is deliberately untouched.
    setType(template?.type ?? defaultType);
    setTitle(template?.title ?? "");
    setBodyHtml(template?.body ?? "");
    setEditorInitialHtml(template?.body ?? "");
    setEditorKey((previous) => previous + 1);
  };

  // The editor emits "<p></p>" for an empty document, so measure the text.
  const hasBody = bodyHtml.replace(/<[^>]*>/g, "").trim().length > 0;
  const canSend = title.trim().length > 0 && type.length > 0 && isAudienceDraftComplete(audienceDraft);

  const handleSubmit = () => {
    if (isPending) return;

    if (!title.trim()) {
      toast.error("Please enter a title");
      return;
    }

    if (!isAudienceDraftComplete(audienceDraft)) {
      toast.error("Please choose who this goes to");
      return;
    }

    startTransition(async () => {
      const response = await sendNotificationAction({
        type,
        title: title.trim(),
        body: hasBody ? bodyHtml : undefined,
        audience: toAudienceRequest(audienceDraft),
      });

      if (!response.success) {
        toast.error(response.formError ?? "Something went wrong. Please try again.");
        return;
      }

      toast.success(MESSAGES.NOTIFICATION_SENT);
      resetForm();
      setOpen(false);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={triggerVariant}>
          <TriggerIcon className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {templates && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
              <Label htmlFor="composer-template">Template</Label>
              {templates.length > 0 ? (
                <Select value={selectedTemplateId} onValueChange={applyTemplate} disabled={isPending}>
                  <SelectTrigger id="composer-template" className="w-full bg-background">
                    <SelectValue placeholder="Choose a template" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value={NO_TEMPLATE}>Choose a template</SelectItem>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No templates yet - an admin creates them under &ldquo;Templates&rdquo;.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="composer-type">Type</Label>
            <Select value={type} onValueChange={setType} disabled={isPending}>
              <SelectTrigger id="composer-type" className="w-full">
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent position="popper">
                {notificationTypes.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <AudiencePicker
            options={audience}
            value={audienceDraft}
            onChange={setAudienceDraft}
            disabled={isPending}
          />

          <div className="space-y-2">
            <Label htmlFor="composer-title">Title</Label>
            <Input
              id="composer-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Notification title"
              maxLength={150}
              disabled={isPending}
            />
          </div>

          <div className="space-y-2" role="group" aria-labelledby="composer-message-label">
            <Label id="composer-message-label">Message</Label>
            <p className="text-xs text-muted-foreground">
              Tip: type {"{{name}}"} to insert each recipient&rsquo;s first name.
            </p>
            <RichTextEditor
              key={editorKey}
              value={editorInitialHtml}
              onChange={setBodyHtml}
              disabled={isPending}
              ariaLabel="Message"
              editorClassName="max-h-[50vh] overflow-y-auto"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleSubmit} loading={isPending} disabled={isPending || !canSend}>
            {isPending ? "Sending..." : "Send notification"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
