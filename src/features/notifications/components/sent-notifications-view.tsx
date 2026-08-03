"use client";

import { useState } from "react";
import { format } from "date-fns";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NOTIFICATION_AUDIENCE_LABELS } from "@/lib/data/kysely-database-types";
import { cn } from "@/lib/utils";

import type { SentNotificationDTO } from "../notifications.types";
import { NotificationBody } from "./notification-body";

// The one-line summary of who a message went to. The stored audience label is
// what the sender chose; the recipient count is what it actually resolved to,
// which is smaller whenever somebody had the type turned off.
function audienceSummary(sent: SentNotificationDTO): string {
  const count = sent.recipients.length;
  const label = sent.audienceLabel ?? NOTIFICATION_AUDIENCE_LABELS[sent.audienceType];

  if (count === 0) return label;

  return `${label} · ${count} ${count === 1 ? "recipient" : "recipients"}`;
}

// "Delivered to N, opened by M", with a chevron that expands the names. Keyed
// by the open message so it starts collapsed each time one is selected.
function RecipientDisclosure({ sent }: { sent: SentNotificationDTO }) {
  const [open, setOpen] = useState(false);
  const count = sent.recipients.length;

  if (count === 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Addressed to: <span className="text-foreground">{sent.audienceLabel ?? "-"}</span>
      </p>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden />
        Delivered to {count} {count === 1 ? "person" : "people"}, opened by {sent.readCount}
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-5 text-xs text-foreground">
          {sent.recipients.map((recipient) => (
            <li key={recipient.userId} className="flex items-center gap-2">
              <span className="truncate">{recipient.name}</span>
              {recipient.isRead ? (
                <Badge variant="success">Opened</Badge>
              ) : (
                <Badge variant="secondary">Unopened</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -------------------------------------------------------------------
// SentNotificationsView
//
// Two-pane history of what has been sent: the list on the left, the selected
// message and who received it on the right.
//
// The list is already scoped server-side. An admin sees every message; a
// manager sees their own, because a broadcast carries no team and the sender is
// the only scope it has.
// -------------------------------------------------------------------
export function SentNotificationsView({ sent }: { sent: SentNotificationDTO[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(sent[0]?.id ?? null);
  const [query, setQuery] = useState("");

  const selected = sent.find((message) => message.id === selectedId) ?? null;

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? sent.filter((message) =>
        `${message.title} ${message.body ? message.body.replace(/<[^>]*>/g, " ") : ""}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : sent;

  return (
    <div className="grid overflow-hidden rounded-xl border border-border md:h-[70vh] md:grid-cols-[minmax(280px,360px)_1fr] md:grid-rows-1">
      {/* Left: what has been sent */}
      <div className="flex max-h-[45vh] min-h-0 flex-col border-b border-border bg-primary/10 md:max-h-none md:border-b-0 md:border-r dark:bg-muted/40">
        <div className="shrink-0 space-y-2 border-b border-border px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sent notifications
          </h2>
          <Input
            type="search"
            aria-label="Search sent notifications"
            placeholder="Search messages"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {normalizedQuery ? "No messages match your search." : "Nothing sent yet."}
            </p>
          ) : (
            <ul aria-label="Sent notifications">
              {filtered.map((message) => (
                <li key={message.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(message.id)}
                    aria-current={selectedId === message.id}
                    className={cn(
                      "w-full border-b border-l-2 border-border border-l-transparent px-4 py-3 text-left transition-colors hover:bg-primary/20 dark:hover:bg-muted/70",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      selectedId === message.id && "border-l-primary bg-background",
                    )}
                  >
                    <span className="block truncate font-medium">{message.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {audienceSummary(message)}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{message.typeLabel}</span>
                      <span aria-hidden>·</span>
                      <span>{format(message.createdAt, "d MMM yyyy")}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Right: the message and who received it */}
      <div className="flex min-h-0 flex-col">
        <div className="shrink-0 border-b border-border px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Message</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {selected ? (
            <article>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{selected.typeLabel}</span>
                <span aria-hidden>·</span>
                <span>{format(selected.createdAt, "EEEE d MMMM yyyy, h:mm a")}</span>
              </div>
              <h3 className="mt-1 font-heading text-xl font-bold text-foreground">{selected.title}</h3>
              <RecipientDisclosure key={selected.id} sent={selected} />
              {selected.body ? (
                <NotificationBody html={selected.body} className="mt-4" />
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">No additional details.</p>
              )}
            </article>
          ) : (
            <p className="text-sm text-muted-foreground">Select a notification to view it.</p>
          )}
        </div>
      </div>
    </div>
  );
}
