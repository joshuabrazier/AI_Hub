"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MessageSquarePlus, MessagesSquare, Pencil, Trash2 } from "lucide-react";

import { toast } from "sonner";

import { AppDialog } from "@/components/app-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { cn } from "@/lib/utils";

import { createAiChatSubjectAction, deleteAiChatSubjectAction, renameAiChatSubjectAction } from "../ai-chat.actions";
import { TITLE_MAX_CHARS, type AiChatPageDTO, type AiChatSubjectDTO } from "../ai-chat.types";
import { AiChatThread } from "./ai-chat-thread";

// -------------------------------------------------------------------
// AiChatWorkspace
//
// The two-column shell: conversations down the left, the open conversation
// on the right.
//
// Which conversation is open lives in the URL (`?subject=<id>`) rather than
// in state, so a conversation is linkable, survives a refresh, and works
// with the back button. The server re-checks that id against the session on
// every render, so putting it in the URL grants nothing.
// -------------------------------------------------------------------
export function AiChatWorkspace({ page }: { page: AiChatPageDTO }) {
  const router = useRouter();
  // The area this is mounted under (/admin/ai-chat, /manage/ai-chat, ...).
  // Read rather than passed so the same component works in all three areas
  // without a prop that could disagree with where it actually is.
  const pathname = usePathname();

  const [isPending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState<AiChatSubjectDTO | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleting, setDeleting] = useState<AiChatSubjectDTO | null>(null);

  const activeId = page.active?.subject.id ?? null;

  const openSubject = (subjectId: string) => router.push(`${pathname}?subject=${subjectId}`);

  const startNewChat = () =>
    startTransition(async () => {
      try {
        const response = await createAiChatSubjectAction();

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        openSubject(response.data);
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  const submitRename = () =>
    startTransition(async () => {
      if (!renaming) return;

      try {
        const response = await renameAiChatSubjectAction({
          subjectId: renaming.id,
          title: renameTitle,
        });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        setRenaming(null);
        router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  const confirmDelete = () =>
    startTransition(async () => {
      if (!deleting) return;

      try {
        const response = await deleteAiChatSubjectAction({ subjectId: deleting.id });

        if (!response.success) {
          toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
          return;
        }

        const wasOpen = deleting.id === activeId;
        setDeleting(null);
        toast.success(MESSAGES.AI_CHAT_DELETED);

        // Deleting the open conversation leaves the URL pointing at
        // something that no longer exists. Drop the query so the server
        // picks the next most recent one instead of rendering an empty
        // thread.
        if (wasOpen) router.push(pathname);
        else router.refresh();
      } catch (error) {
        handleFrontendErrorWithToast(error);
      }
    });

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* Conversations */}
        <aside className="flex min-w-0 flex-col gap-3">
          <Button onClick={startNewChat} disabled={isPending} className="w-full justify-center">
            <MessageSquarePlus size={16} aria-hidden="true" />
            New chat
          </Button>

          {page.subjects.length === 0 ? (
            <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
              No conversations yet. Start one to see it here.
            </p>
          ) : (
            <nav aria-label="Conversations">
              <ul className="space-y-1">
                {page.subjects.map((subject) => {
                  const isActive = subject.id === activeId;

                  return (
                    <li key={subject.id} className="group/subject relative">
                      <Link
                        href={`${pathname}?subject=${subject.id}`}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "block rounded-lg py-2 pl-3 pr-16 transition-colors",
                          isActive ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        <span className="block truncate text-sm font-medium">{subject.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          {subject.messageCount === 0
                            ? "Empty"
                            : `${subject.messageCount} ${subject.messageCount === 1 ? "message" : "messages"}`}
                        </span>
                      </Link>

                      {/* Per-conversation actions. Shown on hover on a
                          pointer device, and always once focused, so they
                          are reachable from the keyboard rather than
                          hover-only. */}
                      <span className="absolute right-1 top-1.5 flex opacity-0 transition-opacity focus-within:opacity-100 group-hover/subject:opacity-100">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Rename ${subject.title}`}
                          onClick={() => {
                            setRenaming(subject);
                            setRenameTitle(subject.title);
                          }}
                        >
                          <Pencil size={14} aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete ${subject.title}`}
                          onClick={() => setDeleting(subject)}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
        </aside>

        {/* The open conversation */}
        <section className="min-w-0">
          {!page.isConfigured ? (
            <div
              role="status"
              className="flex flex-col items-center justify-center rounded-xl border border-border bg-muted/40 px-6 py-16 text-center"
            >
              <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <MessagesSquare size={22} aria-hidden="true" />
              </span>
              <p className="mt-3 text-sm font-medium text-foreground">AI chat is not configured</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                No Bedrock API key is set on this environment, so there is nothing to send messages to. Set
                AWS_BEARER_TOKEN_BEDROCK and restart.
              </p>
            </div>
          ) : page.active === null ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border px-6 py-16 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MessagesSquare size={22} aria-hidden="true" />
              </span>
              <p className="mt-3 text-sm font-medium text-foreground">Nothing open</p>
              <p className="mt-1 text-sm text-muted-foreground">Start a new chat to begin.</p>
            </div>
          ) : (
            // Keyed on the conversation so switching threads remounts and
            // resets the composer and the in-flight reply. Without the key
            // React keeps the previous thread's local state and the new
            // conversation would open showing the old one's draft.
            <AiChatThread key={page.active.subject.id} detail={page.active} canAttachFiles={page.canAttachFiles} />
          )}
        </section>
      </div>

      {/* Rename. AppDialog rather than ConfirmDialog because this needs a
          real field, and ConfirmDialog's description renders inside a <p> -
          an input nested in a paragraph is invalid markup. */}
      <AppDialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        title="Rename conversation"
        description="Only you see this name."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitRename();
          }}
          className="space-y-5"
        >
          <div className="grid gap-2">
            <Label htmlFor="ai-chat-rename">Title</Label>
            <Input
              id="ai-chat-rename"
              value={renameTitle}
              maxLength={TITLE_MAX_CHARS}
              onChange={(event) => setRenameTitle(event.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || renameTitle.trim().length === 0}
              loading={isPending}
            >
              {isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </AppDialog>

      {/* Delete */}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="Delete this conversation?"
        description={`"${deleting?.title ?? ""}" and its messages will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete"
        pendingLabel="Deleting..."
        isPending={isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}
