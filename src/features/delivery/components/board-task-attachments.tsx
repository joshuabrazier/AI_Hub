"use client";

import { useRef, useState, useTransition } from "react";
import { Download, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { MESSAGES } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";

import { deleteTaskAttachmentAction } from "../delivery-board.actions";
import {
  MAX_TASK_ATTACHMENT_BYTES,
  TASK_ATTACHMENT_ACCEPT,
  TASK_ATTACHMENT_ACCEPTED_SUMMARY,
  type TaskAttachmentDTO,
} from "../delivery.types";

// -------------------------------------------------------------------
// BoardTaskAttachments
//
// The files on one card: what is there, how to add one, how to get one
// back, and how to remove one.
//
// -------------------------------------------------------------------
// THE UPLOAD IS A fetch(), NOT AN ACTION, and this is the one component in
// the module that talks to a route handler.
//
// serverActions.bodySizeLimit is GLOBAL and defaults to 1 MB, so the bytes
// could not go through an action without weakening every action in the app.
// POST /api/delivery/task-attachments takes them instead. The DELETE beside
// it is an ordinary action, because an id fits in a kilobyte - the two being
// different is the body limit and nothing else.
//
// EVERY FILE IS REPORTED ON ITS OWN. One rejected type does not discard the
// others chosen with it, and the loop is sequential rather than parallel so
// a refusal names the file it was about.
//
// -------------------------------------------------------------------
// NOTHING HERE DECIDES WHAT A FILE IS.
//
// `accept` is a hint to the operating system's picker and is trivially
// bypassed - a person can always choose "all files", and a script never
// opens a picker at all. The size check below is the same: it saves a
// pointless round trip and proves nothing. The REAL answers are the
// service's, which sniffs the bytes for the type and measures what actually
// arrived, and the download route's, which serves everything but an image as
// an attachment behind `nosniff`.
//
// SO THE FILE NAME IS UNTRUSTED TEXT, and it renders as a text node like
// every other thing somebody typed. There is no dangerouslySetInnerHTML in
// this module and adding one would undo that.
// -------------------------------------------------------------------

// One decimal, and only where it says something: 4 KB rather than 4.0 KB.
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size < 10 ? size.toFixed(1).replace(/\.0$/, "") : Math.round(size)} ${units[unit]}`;
}

export function BoardTaskAttachments({
  taskId,
  attachments,
  canUpload,
  canRemoveAny,
  onChanged,
}: {
  taskId: string;
  attachments: readonly TaskAttachmentDTO[];
  /** False on an archived project, where the service refuses a new file. */
  canUpload: boolean;
  /**
   * A lead or an admin, who may remove anybody's file. Everybody else may
   * still remove their OWN - but this component cannot tell which are theirs
   * (TaskAttachmentDTO carries a name, not an id, on purpose), so it offers
   * the button to everyone and lets the service refuse in words. A hidden
   * button people cannot explain is worse than a refusal they can read.
   */
  canRemoveAny: boolean;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const upload = async (files: File[]) => {
    if (files.length === 0) return;

    setUploadingCount((current) => current + files.length);

    try {
      for (const file of files) {
        try {
          // Saves a round trip on something the server would refuse anyway.
          // It is not the check - see the note above.
          if (file.size > MAX_TASK_ATTACHMENT_BYTES) {
            toast.error(`${file.name} is larger than ${formatSize(MAX_TASK_ATTACHMENT_BYTES)}.`);
            continue;
          }

          const body = new FormData();
          body.append("taskId", taskId);
          body.append("file", file);

          const response = await fetch("/api/delivery/task-attachments", { method: "POST", body });
          const payload = await response.json().catch(() => null);

          if (!response.ok) {
            toast.error(payload?.error ?? MESSAGES.SOMETHING_WENT_WRONG);
            continue;
          }

          toast.success("File attached");
          onChanged();
        } catch (error) {
          console.error(error);
          toast.error(MESSAGES.SOMETHING_WENT_WRONG);
        } finally {
          setUploadingCount((current) => current - 1);
        }
      }
    } catch {
      // The per-file catch handles the expected failures; this guards the
      // loop itself, and the counter has to be released or the button stays
      // disabled forever.
      setUploadingCount(0);
    }
  };

  const remove = (attachment: TaskAttachmentDTO) =>
    startTransition(async () => {
      setRemovingId(attachment.id);

      try {
        const response = await deleteTaskAttachmentAction({ attachmentId: attachment.id });

        if (!response.success) {
          // A refusal in words - a file already gone, or somebody else's
          // file - and worth reading rather than being reduced to "that did
          // not work".
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        toast.success("File removed");
        onChanged();
      } finally {
        setRemovingId(null);
      }
    });

  const isUploading = uploadingCount > 0;

  return (
    <section aria-labelledby="task-panel-files">
      <h3 id="task-panel-files" className="text-sm font-semibold text-foreground">
        Files
      </h3>

      {attachments.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">Nothing attached yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-start gap-2 rounded-md border border-border bg-card p-2"
            >
              <Paperclip size={14} aria-hidden="true" className="mt-1 shrink-0 text-muted-foreground" />

              <div className="min-w-0 flex-1">
                {/* Somebody's own file name, as a text node. `wrap-break-word`
                    rather than a truncation, so a long name is readable
                    instead of ending in an ellipsis that hides the
                    extension. */}
                <p className="wrap-break-word text-sm text-foreground">{attachment.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatSize(attachment.byteSize)}
                  {attachment.uploadedByName ? ` - ${attachment.uploadedByName}` : ""} -{" "}
                  {formatDateTime(attachment.createdAt)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {/* A plain link, so the browser handles the transfer and the
                    route's Content-Disposition decides what happens to it.
                    The id is encoded because it lands in a path segment. */}
                <Button asChild type="button" variant="ghost" size="icon" title={`Download ${attachment.fileName}`}>
                  <a href={`/api/delivery/task-attachments/${encodeURIComponent(attachment.id)}`}>
                    <Download size={14} aria-hidden="true" />
                    <span className="sr-only">Download {attachment.fileName}</span>
                  </a>
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title={`Remove ${attachment.fileName}`}
                  disabled={isPending && removingId === attachment.id}
                  onClick={() => remove(attachment)}
                >
                  {removingId === attachment.id ? (
                    <Loader2 size={14} aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Trash2 size={14} aria-hidden="true" />
                  )}
                  <span className="sr-only">Remove {attachment.fileName}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canUpload ? (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            accept={TASK_ATTACHMENT_ACCEPT}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);

              // Cleared before the upload runs so choosing the SAME file
              // again still fires a change event.
              event.target.value = "";

              void upload(files);
            }}
          />

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
          >
            {isUploading ? (
              <Loader2 size={14} aria-hidden="true" className="animate-spin" />
            ) : (
              <Upload size={14} aria-hidden="true" />
            )}
            {isUploading ? "Uploading…" : "Attach a file"}
          </Button>

          <p className="mt-2 text-xs text-muted-foreground">
            {TASK_ATTACHMENT_ACCEPTED_SUMMARY}, up to {formatSize(MAX_TASK_ATTACHMENT_BYTES)}.
            {canRemoveAny ? "" : " You can remove files you attached yourself."}
          </p>
        </>
      ) : null}
    </section>
  );
}
