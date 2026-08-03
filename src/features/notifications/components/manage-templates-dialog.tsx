"use client";

import { useState } from "react";
import { FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/features/admin-content/rich-text-editor";
import {
  createNotificationTemplateAction,
  deleteNotificationTemplateAction,
  updateNotificationTemplateAction,
} from "../notifications.actions";
import { NotificationTemplateDTO } from "../notifications.types";

const NEW_TEMPLATE = "new";

// -------------------------------------------------------------------
// ManageTemplatesDialog
// Find, create, edit and delete reusable notification templates. Pick an
// existing template (or "New template") from the selector, edit the form,
// and Save; Delete removes the selected one.
// -------------------------------------------------------------------
export function ManageTemplatesDialog({
  templates: initialTemplates,
  notificationTypes,
}: {
  templates: NotificationTemplateDTO[];
  notificationTypes: { key: string; name: string }[];
}) {
  const defaultType = notificationTypes[0]?.key ?? "";
  const [open, setOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [templates, setTemplates] = useState<NotificationTemplateDTO[]>(initialTemplates);
  const [selectedId, setSelectedId] = useState<string>(NEW_TEMPLATE);
  const [name, setName] = useState("");
  const [type, setType] = useState<string>(defaultType);
  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [editorInitialHtml, setEditorInitialHtml] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isEditing = selectedId !== NEW_TEMPLATE;
  const busy = isSaving || isDeleting;

  // System templates have fixed ids and back a built-in feature, which looks
  // them up by id. Their wording can be edited; the row cannot be deleted.
  const selectedTemplate = isEditing ? templates.find((candidate) => candidate.id === selectedId) : undefined;
  const isSystemTemplate = selectedTemplate?.isSystem ?? false;

  // Save requires a template name and a title (body is optional).
  const canSave = name.trim().length > 0 && title.trim().length > 0;

  const loadTemplate = (id: string) => {
    setSelectedId(id);

    const template = id === NEW_TEMPLATE ? undefined : templates.find((candidate) => candidate.id === id);
    setName(template?.name ?? "");
    setType(template?.type ?? defaultType);
    setTitle(template?.title ?? "");
    setBodyHtml(template?.body ?? "");
    setEditorInitialHtml(template?.body ?? "");
    setEditorKey((previous) => previous + 1);
  };

  const handleSave = () => {
    if (busy) return;
    if (!name.trim()) {
      toast.error("Please enter a template name");
      return;
    }
    if (!title.trim()) {
      toast.error("Please enter a title");
      return;
    }

    const hasBody = bodyHtml.replace(/<[^>]*>/g, "").trim().length > 0;
    const body = hasBody ? bodyHtml : undefined;

    setIsSaving(true);

    if (isEditing) {
      void updateNotificationTemplateAction({
        id: selectedId,
        name: name.trim(),
        type,
        title: title.trim(),
        body,
      }).then((response) => {
        setIsSaving(false);
        if (!response.success) {
          toast.error(response.formError ?? "Could not save template");
          return;
        }
        setTemplates((previous) =>
          previous
            .map((template) => (template.id === response.data.id ? response.data : template))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
        toast.success("Template updated");
      });
      return;
    }

    void createNotificationTemplateAction({ name: name.trim(), type, title: title.trim(), body }).then(
      (response) => {
        setIsSaving(false);
        if (!response.success) {
          toast.error(response.formError ?? "Could not save template");
          return;
        }
        setTemplates((previous) =>
          [...previous, response.data].sort((a, b) => a.name.localeCompare(b.name)),
        );
        setSelectedId(response.data.id);
        toast.success("Template created");
      },
    );
  };

  const handleDelete = () => {
    if (!isEditing || busy) return;
    setConfirmDeleteOpen(true);
  };

  const handleDeleteConfirmed = () => {
    const templateId = selectedId;
    setIsDeleting(true);
    void deleteNotificationTemplateAction({ id: templateId }).then((response) => {
      setIsDeleting(false);
      setConfirmDeleteOpen(false);
      if (!response.success) {
        toast.error(response.formError ?? "Could not delete template");
        return;
      }
      setTemplates((previous) => previous.filter((template) => template.id !== templateId));
      loadTemplate(NEW_TEMPLATE);
      toast.success("Template deleted");
    });
  };

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) loadTemplate(NEW_TEMPLATE);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <FileText className="size-4" />
          Templates
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Templates</DialogTitle>
          <DialogDescription>Create, edit and delete reusable notification templates.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label htmlFor="template-select">Template</Label>
            <Select value={selectedId} onValueChange={loadTemplate} disabled={busy}>
              <SelectTrigger id="template-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value={NEW_TEMPLATE}>+ New template</SelectItem>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                    {template.isSystem ? " (system)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isSystemTemplate && (
              <p className="text-xs text-muted-foreground">
                This is a system template used by a built-in feature. You can edit its wording, but it can&apos;t be
                deleted.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-name">Template name</Label>
            <Input
              id="template-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Pool closed"
              maxLength={100}
              disabled={busy}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-type">Type</Label>
            <Select value={type} onValueChange={setType} disabled={busy}>
              <SelectTrigger id="template-type" className="w-full">
                <SelectValue />
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

          <div className="space-y-2">
            <Label htmlFor="template-title">Title</Label>
            <Input
              id="template-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Notification title"
              maxLength={150}
              disabled={busy}
            />
          </div>

          <div className="space-y-2" role="group" aria-labelledby="template-message-label">
            <Label id="template-message-label">Message</Label>
            <p className="text-xs text-muted-foreground">
              Tip: type {"{{name}}"} to insert each recipient&rsquo;s first name when the notification is sent.
            </p>
            <RichTextEditor
              key={editorKey}
              value={editorInitialHtml}
              onChange={setBodyHtml}
              disabled={busy}
              ariaLabel="Message"
              editorClassName="max-h-[50vh] overflow-y-auto"
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <div>
            {isEditing && !isSystemTemplate && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                loading={isDeleting}
                disabled={busy}
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Close
              </Button>
            </DialogClose>
            <Button type="button" onClick={handleSave} loading={isSaving} disabled={busy || !canSave}>
              {isEditing ? "Save changes" : "Create template"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete this template?"
        description="The template is removed for everyone. Notifications already sent are not affected."
        confirmLabel="Delete template"
        pendingLabel="Deleting..."
        isPending={isDeleting}
        onConfirm={handleDeleteConfirmed}
      />
    </>
  );
}
