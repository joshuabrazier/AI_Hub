"use client";

import { FileText, Image as ImageIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/ai/attachment-formats";
import { AI_CHAT_ATTACHMENT_KINDS } from "@/lib/data/kysely-database-types";
import { cn } from "@/lib/utils";

import type { AiChatAttachmentDTO } from "../ai-chat.types";

// -------------------------------------------------------------------
// Attached files, in the composer and in the transcript.
//
// Two states, one component: `onRemove` is present while the files are
// still staged and absent once they have been sent - which is also the
// product rule, since a sent attachment is part of the transcript and
// cannot be taken back out of it.
//
// EVERY FILENAME HERE IS UNTRUSTED. It came from the uploader's own
// filesystem, so it is rendered as a text node, exactly like message
// content, and never with dangerouslySetInnerHTML. `title` gets the full
// name for the cases where the visible one is truncated.
// -------------------------------------------------------------------
export function AiChatAttachmentList({
  attachments,
  onRemove,
  removingId,
  className,
}: {
  attachments: AiChatAttachmentDTO[];
  onRemove?: (attachmentId: string) => void;
  removingId?: string | null;
  className?: string;
}) {
  if (attachments.length === 0) return null;

  return (
    <ul className={cn("flex flex-wrap gap-2", className)}>
      {attachments.map((attachment) => (
        <AttachmentChip
          key={attachment.id}
          attachment={attachment}
          onRemove={onRemove}
          isRemoving={removingId === attachment.id}
        />
      ))}
    </ul>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
  isRemoving,
}: {
  attachment: AiChatAttachmentDTO;
  onRemove?: (attachmentId: string) => void;
  isRemoving: boolean;
}) {
  const isImage = attachment.kind === AI_CHAT_ATTACHMENT_KINDS.IMAGE;

  // The download route serves this back, scoped to the owner. Encoded even
  // though ids are generated rather than typed, because building a URL from
  // a value without encoding it is a habit worth not having.
  const href = `/api/ai-chat/attachments/${encodeURIComponent(attachment.id)}`;

  return (
    <li
      className={cn(
        "flex max-w-full items-center gap-2 rounded-lg border border-border bg-muted/40 py-1.5 pl-2 pr-1.5",
        isRemoving && "opacity-50",
      )}
    >
      {isImage ? (
        // A real thumbnail rather than an icon: recognising the photo you
        // attached is the whole point of showing it back.
        //
        // Deliberately a plain <img>. next/image would need this route in
        // remotePatterns and would proxy private bytes through the image
        // optimiser, which caches them on disk outside the access check
        // that makes them private in the first place.
        //
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={href}
          alt={attachment.fileName}
          className="size-9 shrink-0 rounded object-cover"
          loading="lazy"
        />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded bg-background text-muted-foreground">
          <FileText size={16} aria-hidden="true" />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <a
          href={href}
          // Opens the download (or the image) without navigating away from a
          // conversation that may have an answer streaming into it.
          target="_blank"
          rel="noopener noreferrer"
          title={attachment.fileName}
          className="block truncate text-sm font-medium text-foreground hover:underline"
        >
          {attachment.fileName}
        </a>

        <span className="block text-xs uppercase tracking-wide text-muted-foreground">
          {attachment.format} &middot; {formatBytes(attachment.byteSize)}
        </span>
      </span>

      {onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          disabled={isRemoving}
          onClick={() => onRemove(attachment.id)}
          aria-label={`Remove ${attachment.fileName}`}
        >
          <X size={14} aria-hidden="true" />
        </Button>
      ) : (
        // Keeps a sent chip the same height as a staged one, so the
        // transcript does not shift when a message lands.
        <span className="size-7 shrink-0" aria-hidden="true" />
      )}
    </li>
  );
}

// -------------------------------------------------------------------
// The icon for a kind, for the composer's empty and busy states.
// -------------------------------------------------------------------
export function AttachmentKindIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  return kind === AI_CHAT_ATTACHMENT_KINDS.IMAGE ? (
    <ImageIcon size={size} aria-hidden="true" />
  ) : (
    <FileText size={size} aria-hidden="true" />
  );
}
