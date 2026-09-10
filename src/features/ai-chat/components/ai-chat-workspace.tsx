"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  MessageSquarePlus,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Trash2,
} from "lucide-react";

import { toast } from "sonner";

import { AppDialog } from "@/components/app-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { chatFeatureLabel } from "@/lib/ai/assistant-identity";
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
//
// THE TWO COLUMNS ARE TWO SURFACES, not one surface with a gap in it. The
// list is `bg-secondary`; the thread paints nothing and so wears the page's
// own background; and there is a border between them. The previous version
// separated them with whitespace alone, which on a wide monitor is one field
// of white with some links floating in it.
//
// `bg-muted` IS THE TRAP HERE, and it is worth naming because it is the
// obvious choice for a quiet panel. Check the tokens in globals.css: in the
// light theme it is #f6fafb, a step off #ffffff that you cannot see, and in
// the dark theme it is #131f22 - the SAME VALUE as `--card`. A muted panel
// is invisible in one theme and, beside a card, absent in the other.
// `secondary` is the only neutral surface that steps away from both the
// background and the card in both themes.
//
// The open conversation's row is `bg-background` - the thread's own surface
// - so the selection reads as the leading edge of the column it opens rather
// than as one more highlight colour. If the thread is ever given a surface
// of its own, this and the New chat button have to move with it or the
// selected row will point at a colour that is no longer next to it.
//
// THE LIST COLLAPSES, and it is two different controls rather than one:
// an inline rail that animates to nothing on md and up, and a Sheet on
// smaller screens. One control would need a JS media query to decide which
// behaviour to use, and that cannot be evaluated during the server render -
// so the first paint would either flash a 17rem panel onto a phone or flash
// it off a desktop, depending on which way the initial state guessed. Here
// the breakpoint is CSS in both directions, so there is nothing to guess.
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
  // The inline rail (md and up). Open by default: the list is how somebody
  // gets back to a conversation, so it is not hidden until they ask.
  const [railOpen, setRailOpen] = useState(true);
  // The Sheet (below md). Closed by default, because on a phone it covers
  // the thread.
  const [sheetOpen, setSheetOpen] = useState(false);

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

        setSheetOpen(false);
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

  // The list, built once and rendered in two places - the inline rail and
  // the Sheet. `onNavigate` is what closes the Sheet after a tap; the rail
  // passes nothing, because opening a conversation there does not dismiss
  // anything.
  const conversationList = (onNavigate?: () => void) => (
    <ConversationList
      subjects={page.subjects}
      activeId={activeId}
      pathname={pathname}
      isPending={isPending}
      onNewChat={startNewChat}
      onRename={(subject) => {
        setRenaming(subject);
        setRenameTitle(subject.title);
      }}
      onDelete={setDeleting}
      onNavigate={onNavigate}
    />
  );

  return (
    <>
      {/* NO CARD AROUND THIS. The chat is the screen, not an object sitting
          on one - a border and a radius here drew it as a panel floating in
          the middle of the window, with a strip of page visible around all
          four sides. The two surfaces and the divider between them are what
          separate the columns; the outline was never doing that work. */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Conversations, inline. Quieter than the thread beside it on
            purpose: this is the way back to something, not the thing being
            read.

            `inert` when collapsed, and zero width is NOT enough on its own:
            a 0px panel with overflow hidden still holds real focusable
            links, so tabbing off the toggle would walk through every
            conversation with nothing on screen to show where focus went.
            `inert` removes them from the tab order and from the
            accessibility tree together, which is why it is used rather than
            aria-hidden - that would fix only the second half. */}
        <aside
          className={cn(
            "hidden shrink-0 overflow-hidden bg-secondary transition-[width] duration-300 ease-in-out motion-reduce:transition-none md:block",
            railOpen ? "w-[17rem] border-r border-border" : "w-0",
          )}
          inert={!railOpen}
        >
          {/* The measure lives HERE rather than on the list, so the list
              itself is width-agnostic and fills the Sheet correctly on a
              phone. It also means the collapse animates the panel's width
              while the contents keep theirs, so the rows slide out of view
              instead of reflowing on every frame. */}
          <div className="h-full w-[17rem]">{conversationList()}</div>
        </aside>

        {/* The open conversation */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* THE THREAD'S OWN CHROME, and deliberately not a page header -
              the page suppresses that (see ai-chat.page.tsx) and this does
              not bring it back. It exists because a collapsed list needs the
              toggle to live somewhere, and because once the list is closed
              the name of the open conversation is the only thing left saying
              which one you are reading. One slim row, no eyebrow, no
              description. */}
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="hidden md:inline-flex"
                  aria-expanded={railOpen}
                  aria-label={railOpen ? "Hide conversations" : "Show conversations"}
                  onClick={() => setRailOpen((previous) => !previous)}
                >
                  {railOpen ? (
                    <PanelLeftClose size={16} aria-hidden="true" />
                  ) : (
                    <PanelLeftOpen size={16} aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{railOpen ? "Hide conversations" : "Show conversations"}</TooltipContent>
            </Tooltip>

            {/* Below md the same list arrives as a Sheet over the thread,
                because a 17rem column on a phone leaves nothing to read. */}
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  aria-label="Show conversations"
                >
                  <MessagesSquare size={16} aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="gap-0 bg-secondary p-0">
                {/* A VISIBLE header, not an sr-only one. SheetContent paints
                    its own close button at top-3 right-3, so with the list
                    flush to the top edge that button sits on top of the "New
                    chat" row. The header is what it needs to sit in, and
                    `pr-12` is what keeps the title clear of it.

                    No width class here on purpose: SheetContent already
                    sizes itself to the viewport (3/4, capped at sm), and its
                    data-[side=left] rule outranks a plain w-* anyway - so a
                    rem width would be both ignored and misleading. */}
                <SheetHeader className="shrink-0 border-b border-border/70 p-3 pr-12">
                  <SheetTitle className="text-sm">Conversations</SheetTitle>
                </SheetHeader>
                <div className="min-h-0 flex-1">{conversationList(() => setSheetOpen(false))}</div>
              </SheetContent>
            </Sheet>

            <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {page.active?.subject.title ?? chatFeatureLabel()}
            </p>
          </div>

          {!page.isConfigured ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              <div role="status" className="flex flex-col items-center text-center">
                <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <MessagesSquare size={22} aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm font-medium text-foreground">{chatFeatureLabel()} is not configured</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  No Bedrock API key is set on this environment, so there is nothing to send messages to. Set
                  AWS_BEARER_TOKEN_BEDROCK and restart.
                </p>
              </div>
            </div>
          ) : page.active === null ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              <div className="flex flex-col items-center text-center">
                <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <MessagesSquare size={22} aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm font-medium text-foreground">Nothing open</p>
                <p className="mt-1 text-sm text-muted-foreground">Start a new chat to begin.</p>
              </div>
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

// -------------------------------------------------------------------
// The list of conversations.
//
// Extracted because it renders twice - the inline rail and the Sheet - and
// two copies of it would have drifted the first time a row gained anything.
// It owns no state: everything it does is handed down, so the rail and the
// Sheet cannot disagree about what is open or what is being renamed.
//
// It carries NO width of its own. The rail wraps it in the 17rem measure
// and clips it as that panel animates shut; the Sheet gives it whatever the
// viewport allows, which on a narrow phone is less than 17rem - so a fixed
// width here would overflow the one and be redundant in the other.
// -------------------------------------------------------------------
function ConversationList({
  subjects,
  activeId,
  pathname,
  isPending,
  onNewChat,
  onRename,
  onDelete,
  onNavigate,
}: {
  subjects: AiChatSubjectDTO[];
  activeId: string | null;
  pathname: string;
  isPending: boolean;
  onNewChat: () => void;
  onRename: (subject: AiChatSubjectDTO) => void;
  onDelete: (subject: AiChatSubjectDTO) => void;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="shrink-0 border-b border-border/70 p-3">
        <Button
          onClick={onNewChat}
          disabled={isPending}
          variant="outline"
          className="w-full justify-start rounded-xl bg-background"
        >
          <MessageSquarePlus size={16} aria-hidden="true" />
          New chat
        </Button>
      </div>

      {subjects.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">No conversations yet.</p>
      ) : (
        <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto p-2">
          <ul className="space-y-0.5">
            {subjects.map((subject) => {
              const isActive = subject.id === activeId;

              return (
                <li key={subject.id} className="group/subject relative">
                  <Link
                    href={`${pathname}?subject=${subject.id}`}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    title={
                      subject.messageCount === 0
                        ? "Empty conversation"
                        : `${subject.messageCount} ${subject.messageCount === 1 ? "message" : "messages"}`
                    }
                    className={cn(
                      "block truncate rounded-lg py-2 pl-3 pr-14 text-sm transition-colors",
                      // The open row wears the THREAD's surface, so the
                      // selection reads as continuous with the panel it
                      // opens rather than as another highlight.
                      isActive
                        ? "bg-background font-medium text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                    )}
                  >
                    {subject.title}
                  </Link>

                  {/* Per-conversation actions. Shown on hover on a
                      pointer device, and always once focused, so they
                      are reachable from the keyboard rather than
                      hover-only. */}
                  <span className="absolute right-1 top-1 flex opacity-0 transition-opacity focus-within:opacity-100 group-hover/subject:opacity-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Rename ${subject.title}`}
                      onClick={() => onRename(subject)}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${subject.title}`}
                      onClick={() => onDelete(subject)}
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
    </div>
  );
}
