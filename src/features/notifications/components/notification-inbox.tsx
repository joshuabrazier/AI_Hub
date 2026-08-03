"use client";

import { useState, useTransition } from "react";
import { format } from "date-fns";
import { CheckCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { markAllNotificationsReadAction, markNotificationsReadAction } from "../notifications.actions";
import type { NotificationDTO } from "../notifications.types";
import { NotificationBody } from "./notification-body";

// Strip tags so a search matches the words a reader can see rather than the
// markup around them.
function searchableText(notification: NotificationDTO): string {
  const body = notification.body ? notification.body.replace(/<[^>]*>/g, " ") : "";
  return `${notification.title} ${body}`.toLowerCase();
}

// -------------------------------------------------------------------
// NotificationInbox
//
// Two-pane, email-client style: the list on the left, the open message on the
// right. Opening a message marks it read.
//
// Read state is tracked locally as well as on the server. The server is the
// record - markNotificationsReadRepo skips rows that are already read, so a
// re-open never rewrites the original time - but the list has to stop showing
// "New" the moment the reader opens it, and waiting for a round trip to do that
// reads as a bug.
// -------------------------------------------------------------------
export function NotificationInbox({
  notifications,
  unreadCount,
}: {
  notifications: NotificationDTO[];
  unreadCount: number;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(notifications[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [locallyRead, setLocallyRead] = useState<Set<string>>(new Set());
  const [isMarkingAll, startMarkAll] = useTransition();

  const isUnread = (notification: NotificationDTO) =>
    notification.isUnread && !locallyRead.has(notification.id);

  const remainingUnread = Math.max(0, unreadCount - locallyRead.size);

  const openNotification = (notification: NotificationDTO) => {
    setSelectedId(notification.id);

    if (!isUnread(notification)) return;

    setLocallyRead((previous) => new Set(previous).add(notification.id));

    // Fire and forget: the message is open and readable either way, so a failed
    // mark-as-read must not interrupt reading it. The next page load re-reads
    // the true state from the server.
    void markNotificationsReadAction({ notificationIds: [notification.id] });
  };

  const handleMarkAllRead = () => {
    if (isMarkingAll || remainingUnread === 0) return;

    startMarkAll(async () => {
      const response = await markAllNotificationsReadAction();

      if (!response.success) {
        toast.error(response.formError ?? "Could not mark your notifications as read.");
        return;
      }

      setLocallyRead(new Set(notifications.map((notification) => notification.id)));
    });
  };

  const selected = notifications.find((notification) => notification.id === selectedId) ?? null;

  // Filter by title and message text. The open message stays open even when it
  // drops out of the filtered list.
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? notifications.filter((notification) => searchableText(notification).includes(normalizedQuery))
    : notifications;

  return (
    <div className="grid overflow-hidden rounded-xl border border-border md:h-[70vh] md:grid-cols-[minmax(260px,340px)_1fr] md:grid-rows-1">
      {/* Left: the list */}
      <div className="flex max-h-[45vh] min-h-0 flex-col border-b border-border bg-primary/10 md:max-h-none md:border-b-0 md:border-r dark:bg-muted/40">
        <div className="shrink-0 space-y-2 border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {remainingUnread > 0 ? `${remainingUnread} unread` : "All caught up"}
            </h2>
            {remainingUnread > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleMarkAllRead}
                loading={isMarkingAll}
                disabled={isMarkingAll}
              >
                <CheckCheck className="size-4" aria-hidden="true" />
                Mark all read
              </Button>
            )}
          </div>
          <Input
            type="search"
            aria-label="Search notifications"
            placeholder="Search messages"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {normalizedQuery ? "No messages match your search." : "No notifications yet."}
            </p>
          ) : (
            <ul aria-label="Notifications">
              {filtered.map((notification) => {
                const unread = isUnread(notification);

                return (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(notification)}
                      aria-current={selectedId === notification.id}
                      className={cn(
                        "w-full border-b border-l-2 border-border border-l-transparent px-4 py-3 text-left transition-colors hover:bg-primary/20 dark:hover:bg-muted/70",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        selectedId === notification.id && "border-l-primary bg-background",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {unread && (
                          <span
                            className="size-2 shrink-0 rounded-full bg-signal"
                            aria-label="Unread"
                            role="img"
                          />
                        )}
                        <span
                          className={cn("block truncate", unread ? "font-semibold" : "font-medium")}
                        >
                          {notification.title}
                        </span>
                      </span>
                      <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{notification.typeLabel}</span>
                        <span aria-hidden>·</span>
                        <span>{format(notification.createdAt, "d MMM yyyy")}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Right: the open message */}
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
              {selected.body ? (
                <NotificationBody html={selected.body} className="mt-4" />
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">No additional details.</p>
              )}
            </article>
          ) : (
            <p className="text-sm text-muted-foreground">Select a notification to read it.</p>
          )}
        </div>
      </div>
    </div>
  );
}
