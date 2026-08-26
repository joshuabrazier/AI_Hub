"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  Check,
  CircleStop,
  Copy,
  Loader2,
  Paperclip,
  SendHorizontal,
  Sparkles,
} from "lucide-react";

import { ModelMarkdown } from "@/components/model-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AI_CHAT_ACCEPTED_SUMMARY,
  AI_CHAT_ACCEPT_ATTRIBUTE,
} from "@/lib/ai/attachment-formats";
import { MESSAGES } from "@/lib/constants";
import { AI_CHAT_ROLES } from "@/lib/data/kysely-database-types";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { removeAiChatAttachmentAction } from "../ai-chat.actions";
import {
  MAX_MESSAGE_CHARS,
  type AiChatAttachmentDTO,
  type AiChatMessageDTO,
  type AiChatSubjectDetailDTO,
} from "../ai-chat.types";
import { AiChatAttachmentList } from "./ai-chat-attachment-list";

// -------------------------------------------------------------------
// AiChatThread
//
// The transcript and the composer for one conversation.
//
// This is the only component in the app that talks to an API route rather
// than a server action, because the reply streams. The route owns
// authorization; this component owns nothing but presentation and the
// in-flight text.
//
// Mounted with a key on the conversation id (see AiChatWorkspace), so all
// of the state below is per conversation and switching threads resets it.
// -------------------------------------------------------------------
export function AiChatThread({
  detail,
  canAttachFiles,
}: {
  detail: AiChatSubjectDetailDTO;
  canAttachFiles: boolean;
}) {
  const router = useRouter();

  // Seeded from the server and then advanced locally while a reply streams.
  // Re-synced from the server once the reply lands, which is what replaces
  // the optimistic rows with the persisted ones (real ids, token counts).
  const [messages, setMessages] = useState<AiChatMessageDTO[]>(detail.messages);
  const [draft, setDraft] = useState("");

  // Files uploaded but not yet sent. Seeded from the server, so a page
  // reload does not lose an attachment somebody already waited for, and
  // advanced locally as uploads land.
  const [staged, setStaged] = useState<AiChatAttachmentDTO[]>(detail.staged);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);

  // The reply currently arriving. Null when nothing is in flight; an empty
  // string means the request is away but no text has come back yet, which
  // is what drives the thinking indicator.
  const [reply, setReply] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Drag events fire on every child element, so a plain boolean would clear
  // the highlight as soon as the pointer crossed one. Counting enters and
  // leaves is what makes it survive the crossing.
  const dragDepth = useRef(0);

  const isStreaming = reply !== null;
  const isUploading = uploadingCount > 0;

  // -------------------------------------------------------------------
  // Upload chosen files.
  //
  // SEQUENTIAL, and that is not laziness. The per-message caps (20 images,
  // 5 documents, and a shared byte budget) are checked server-side against
  // the rows already staged, so uploads sent in parallel would each read a
  // stale count and could collectively walk past a limit that neither one
  // broke on its own.
  //
  // Each file is reported on its own: one rejected type does not discard
  // the others that were selected with it.
  // -------------------------------------------------------------------
  const upload = async (files: File[]) => {
    if (files.length === 0 || isStreaming) return;

    setUploadingCount((current) => current + files.length);

    try {
      for (const file of files) {
        const body = new FormData();
        body.append("subjectId", detail.subject.id);
        body.append("file", file);

        try {
          const response = await fetch("/api/ai-chat/attachments", {
            method: "POST",
            body,
          });
          const payload = await response.json().catch(() => null);

          if (!response.ok) {
            toast.error(payload?.error ?? MESSAGES.SOMETHING_WENT_WRONG);
            continue;
          }

          setStaged((current) => [
            ...current,
            payload.attachment as AiChatAttachmentDTO,
          ]);
        } catch (error) {
          console.error(error);
          toast.error(MESSAGES.SOMETHING_WENT_WRONG);
        } finally {
          setUploadingCount((current) => current - 1);
        }
      }
    } catch {
      // The per-file catch above handles the expected failures; this only
      // guards the loop itself, and the counter has to be released or the
      // composer stays disabled forever.
      setUploadingCount(0);
    }
  };

  const remove = async (attachmentId: string) => {
    setRemovingId(attachmentId);

    const response = await removeAiChatAttachmentAction({ attachmentId });

    setRemovingId(null);

    if (!response.success) {
      toast.error(response.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
      return;
    }

    setStaged((current) =>
      current.filter((attachment) => attachment.id !== attachmentId),
    );
  };

  // Keep the newest text in view as it arrives. `instant` rather than smooth
  // because a smooth scroll re-triggered on every chunk never catches up.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [messages, reply]);

  // Abort any in-flight request if this thread unmounts (the user switched
  // conversations or navigated away). Without this the fetch keeps running
  // against a component that is gone.
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async () => {
    const content = draft.trim();

    // An upload in flight blocks the send: the server claims whatever is
    // staged at the moment the turn is written, so sending mid-upload would
    // attach some of the chosen files and silently leave the rest behind.
    if (!content || isStreaming || isUploading) return;

    // Optimistic user turn. The id is local and is replaced by the server's
    // on the refresh below; it only has to be unique within this render.
    const optimistic: AiChatMessageDTO = {
      id: `pending-${Date.now()}`,
      role: AI_CHAT_ROLES.USER,
      content,
      createdAt: new Date(),
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      totalInputTokens: null,
      // The send claims exactly what is staged now, so showing it on the
      // optimistic turn is accurate rather than hopeful.
      attachments: staged,
    };

    setMessages((current) => [...current, optimistic]);
    setDraft("");
    setStaged([]);
    setReply("");

    const controller = new AbortController();
    abortRef.current = controller;

    let streamed = "";

    try {
      const response = await fetch("/api/ai-chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId: detail.subject.id, content }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        // The server may or may not have persisted the question before
        // failing, so rather than guess, re-read the truth from the server.
        const problem = await response.json().catch(() => null);
        toast.error(problem?.error ?? MESSAGES.SOMETHING_WENT_WRONG);
        setReply(null);
        router.refresh();
        return;
      }

      const decoder = new TextDecoder();
      const reader = response.body.getReader();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        // `stream: true` matters: a multi-byte character can be split across
        // chunk boundaries, and decoding each chunk in isolation would
        // render a replacement character instead of the letter.
        streamed += decoder.decode(value, { stream: true });
        setReply(streamed);
      }
    } catch (error) {
      // An abort is the Stop button, not a failure - whatever arrived is
      // kept, and the server has persisted it too.
      const aborted =
        error instanceof DOMException && error.name === "AbortError";
      if (!aborted) {
        console.error(error);
        toast.error(MESSAGES.SOMETHING_WENT_WRONG);
      }
    } finally {
      abortRef.current = null;
      setReply(null);

      // Commit whatever arrived so the answer does not blink out between
      // the stream closing and the server render landing.
      if (streamed.trim().length > 0) {
        setMessages((current) => [
          ...current,
          {
            id: `pending-reply-${Date.now()}`,
            role: AI_CHAT_ROLES.ASSISTANT,
            content: streamed,
            createdAt: new Date(),
            inputTokens: null,
            outputTokens: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            totalInputTokens: null,
            attachments: [],
          },
        ]);
      }

      // Re-sync: replaces both optimistic rows with the persisted ones and
      // picks up the auto-derived conversation title in the sidebar.
      router.refresh();
    }
  };

  return (
    // No border and no card. The conversation IS the page, so a box drawn
    // around it only makes the reading area smaller.
    //
    // h-full, not a calc. The page above is a fixed-height flex column, so
    // this fills what is left after the header and the composer stays on
    // screen at any window size.
    <div className="flex h-full min-h-0 flex-col">
      {/* Transcript. The scroll is full-bleed so a long reply does not sit
          inside a visible frame, but the CONTENT is held to a measured
          column - prose past about 75 characters a line is measurably harder
          to read, and a chat reply is prose. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-6">
        {messages.length === 0 && !isStreaming ? (
          // The greeting on an empty thread, and the place the full terms of
          // the thing live. The page header above is one line now, so this
          // carries what that line no longer says - and it is read at the
          // moment somebody is deciding what to type, which is when it
          // actually matters rather than on every return visit.
          <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Sparkles size={24} aria-hidden="true" />
            </span>

            <h2 className="mt-4 font-heading text-xl font-semibold text-foreground">
              What would you like to know?
            </h2>

            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Ask about this app or about your timesheets. The whole conversation is sent each time, so you can
              build on earlier questions.
            </p>

            <p className="mt-5 max-w-md text-xs leading-relaxed text-muted-foreground">
              This conversation is private from other users. Timesheet answers are limited to what your role can
              already see. Administrators can review the requests sent to the model.
            </p>
          </div>
        ) : (
          <ul className="space-y-6">
            {messages.map((message) => (
              <Fragment key={message.id}>
                <MessageRow message={message} />

                {/* Where the model's own recall stops being verbatim. Shown so
                    a reader is never left wondering why it seems to have
                    forgotten something said further up - the messages above
                    are still here and still readable, the model just sees a
                    summary of them now. */}
                {message.id === detail.summarizedThroughMessageId && (
                  <li
                    className="flex items-center gap-3 py-1"
                    aria-hidden="false"
                  >
                    <span className="h-px flex-1 bg-border" />
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Archive size={12} aria-hidden="true" />
                      Everything above is summarised for the assistant
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </li>
                )}
              </Fragment>
            ))}

            {isStreaming && (
              <MessageRow
                message={{
                  id: "streaming",
                  role: AI_CHAT_ROLES.ASSISTANT,
                  content: reply,
                  createdAt: new Date(),
                  inputTokens: null,
                  outputTokens: null,
                  cacheReadTokens: null,
                  cacheWriteTokens: null,
                  totalInputTokens: null,
                  attachments: [],
                }}
                isStreaming
              />
            )}
          </ul>
        )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer. Doubles as the drop zone, so a file can be dragged
          anywhere over it rather than onto a small target. */}
      <div
        className={cn(
          "mx-auto w-full max-w-3xl px-4 pb-4 transition-colors",
          isDropTarget && "opacity-90",
        )}
        onDragEnter={(event) => {
          // Only react to an actual file drag; dragging selected text over
          // the composer should do nothing. And with no storage configured
          // there is nowhere to put a dropped file, so it should not look
          // like a target at all.
          if (!canAttachFiles || !event.dataTransfer.types.includes("Files"))
            return;

          dragDepth.current += 1;
          setIsDropTarget(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;

          // Without this the browser navigates to the dropped file.
          event.preventDefault();
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setIsDropTarget(false);
        }}
        onDrop={(event) => {
          if (!canAttachFiles || !event.dataTransfer.types.includes("Files"))
            return;

          event.preventDefault();
          dragDepth.current = 0;
          setIsDropTarget(false);

          void upload(Array.from(event.dataTransfer.files));
        }}
      >
        {(staged.length > 0 || isUploading) && (
          <div className="mb-2">
            <AiChatAttachmentList
              attachments={staged}
              onRemove={(id) => void remove(id)}
              removingId={removingId}
            />

            {isUploading && (
              <p
                className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"
                role="status"
              >
                <Loader2
                  size={12}
                  className="animate-spin"
                  aria-hidden="true"
                />
                Uploading {uploadingCount} file{uploadingCount === 1 ? "" : "s"}
                ...
              </p>
            )}
          </div>
        )}

      {/* ONE ROUNDED FIELD holding all three controls, rather than a text box
          with buttons beside it. The whole thing is the input: the border and
          the focus ring belong to the container, so attaching and sending
          read as part of writing rather than as separate widgets. */}
        <div
          className={cn(
            "flex items-end gap-1.5 rounded-3xl border border-border bg-card px-2 py-1.5 shadow-sm transition-shadow",
            "focus-within:border-primary/40 focus-within:shadow-md",
            isDropTarget && "border-primary/60 shadow-md",
          )}
        >
        {/* The real input stays off-screen and the button drives it, so the
            control matches the rest of the UI while keeping a native file
            picker and its keyboard behaviour. */}
        {canAttachFiles && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={AI_CHAT_ACCEPT_ATTRIBUTE}
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                void upload(Array.from(event.target.files ?? []));
                // Cleared so choosing the same file twice in a row still
                // fires a change event.
                event.target.value = "";
              }}
            />

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
              disabled={isStreaming || isUploading}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach files"
              title={`Attach files - ${AI_CHAT_ACCEPTED_SUMMARY}`}
            >
              <Paperclip size={18} aria-hidden="true" />
            </Button>
          </>
        )}

          <Textarea
            aria-label="Message"
            value={draft}
            maxLength={MAX_MESSAGE_CHARS}
            rows={1}
            placeholder={staged.length > 0 ? "Ask about the attached files..." : "Write a message..."}
            disabled={isStreaming}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={(event) => {
              // Pasting a screenshot is the fastest way to attach one, and
              // the clipboard carries it as a file item. Text pastes have no
              // file items and fall through to the default handler.
              if (!canAttachFiles) return;

              const files = Array.from(event.clipboardData.files);
              if (files.length === 0) return;

              event.preventDefault();
              void upload(files);
            }}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter makes a new line - the convention
              // for a chat composer. Guarded on the IME composition flag so
              // Enter to accept a candidate in a Japanese or Chinese input
              // does not fire a send.
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
            className={cn(
              "max-h-56 min-h-0 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-[0.9375rem] leading-[1.5] shadow-none",
              "dark:bg-transparent",
              "focus-visible:ring-0 focus-visible:ring-offset-0",
            )}
            style={{ height: "auto" }}
            ref={(node) => {
              // Grow to fit, up to the max-height above, after which it
              // scrolls. A fixed row count is either too small for a
              // paragraph or too large for the one-line question that most
              // messages actually are.
              if (!node) return;
              node.style.height = "auto";
              node.style.height = `${node.scrollHeight}px`;
            }}
          />



          {isStreaming ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-9 shrink-0 rounded-full"
              onClick={() => abortRef.current?.abort()}
              aria-label="Stop generating"
              title="Stop generating"
            >
              <CircleStop size={18} aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              className="size-9 shrink-0 rounded-full"
              onClick={() => void send()}
              disabled={draft.trim().length === 0 || isUploading}
              aria-label="Send message"
              title="Send message"
            >
              <SendHorizontal size={18} aria-hidden="true" />
            </Button>
          )}
        </div>

        {/* Kept, but demoted to a hint under the field rather than a line of
            instructions above it. Somebody who already knows Enter sends
            should not read it on every visit. */}
        <p className="mt-2 text-center text-xs text-muted-foreground">
          The assistant can be wrong. Check anything that matters against the screen it came from.
        </p>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------
// One turn.
//
// Neither half is ever rendered as HTML. Both are untrusted: the user's
// because they typed it, the model's because a model repeats back whatever
// it was given.
//
// The user's turn is a TEXT NODE with `whitespace-pre-wrap`, which keeps
// their line breaks and indentation without giving up React's escaping.
// The model's turn is markdown, rendered to React elements rather than to
// an HTML string - see ModelMarkdown, where that distinction is the whole
// argument for why this is still safe.
// -------------------------------------------------------------------
function MessageRow({
  message,
  isStreaming = false,
}: {
  message: AiChatMessageDTO;
  isStreaming?: boolean;
}) {
  const isUser = message.role === AI_CHAT_ROLES.USER;

  // ---------------------------------------------------------------
  // The two halves are shaped DIFFERENTLY on purpose, which is what makes a
  // transcript readable without labelling every turn.
  //
  // A person's message is short and is theirs, so it sits in a bubble on the
  // right - bounded, obviously an utterance. The model's is long and is the
  // thing being read, so it has no bubble and no avatar and runs the full
  // width of the column, like a document.
  //
  // That asymmetry replaces the "YOU" / "ASSISTANT" captions this used to
  // carry. Two visual forms say the same thing as two words, and do not
  // repeat it on every turn down a long thread.
  // ---------------------------------------------------------------
  if (isUser) {
    return (
      <li className="group/msg flex flex-col items-end gap-1">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 sm:max-w-[75%]">
          {/* The user's own words, exactly as typed. Deliberately NOT
              markdown: somebody who writes **stars** meant stars, and
              reformatting a person's own message is both surprising and a
              way to make two different inputs render identically. Still a
              text node, so it is escaped by React as it always was. */}
          <p className="whitespace-pre-wrap break-words text-[0.9375rem] leading-[1.6] text-foreground">
            {message.content}
          </p>
        </div>

        <AiChatAttachmentList attachments={message.attachments} className="max-w-[85%] sm:max-w-[75%]" />

        <Timestamp message={message} isStreaming={isStreaming} />
      </li>
    );
  }

  return (
    <li className="group/msg flex flex-col gap-1">
      {message.content.length === 0 && isStreaming ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          {/* A moving indicator rather than the word alone: a tool call adds
              a second round trip, so this can sit for several seconds and
              static text reads as a page that has stopped. */}
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          Thinking...
        </p>
      ) : (
        // The model's half, rendered as markdown - which is the format it
        // writes in. Renders to React elements, never to an HTML string;
        // see the note in ModelMarkdown for why that distinction is the
        // whole security argument.
        <ModelMarkdown content={message.content} className="text-[0.9375rem] leading-[1.7] text-foreground" />
      )}

      {/* What was sent with this turn. No remove handler: once a file is
          part of the transcript it stays, because the model was shown it
          and the answer above may depend on it. */}
      <AiChatAttachmentList attachments={message.attachments} className="mt-1" />

      <div className="-ml-2 flex items-center gap-1">
        <CopyReply content={message.content} isStreaming={isStreaming} />
        <Timestamp message={message} isStreaming={isStreaming} />
      </div>
    </li>
  );
}

// -------------------------------------------------------------------
// When the reply landed.
//
// ON HOVER AND ON FOCUS, not always. A time under every turn is noise in a
// conversation you are reading straight through, but it is the thing you want
// the moment you are reconciling a figure against when it was asked for - so
// it is kept and made quiet rather than removed.
//
// The `outputTokens` check is the test for "this reply completed and was
// persisted": a stream the reader stopped part-way has no usage recorded, and
// stamping a time on it would suggest a finished answer. Token counts used to
// sit here and were removed from the UI; they are still stored per turn, and
// the admin AI-requests screen is where spend is reviewed.
// -------------------------------------------------------------------
function Timestamp({ message, isStreaming }: { message: AiChatMessageDTO; isStreaming: boolean }) {
  if (isStreaming || message.outputTokens === null) return null;

  return (
    <p className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100">
      {formatDateTime(message.createdAt)}
    </p>
  );
}

// -------------------------------------------------------------------
// Copy a reply.
//
// Under the answer, on hover, beside the time - the same treatment and for
// the same reason: worth having, not worth a permanent button on every turn.
//
// It copies the MARKDOWN SOURCE rather than the rendered text, because that
// is what survives being pasted somewhere else. A table pasted as its
// rendered characters arrives as a wall of words with the columns gone.
//
// Not shown while streaming: half an answer is not an answer, and a copy
// button beside one invites copying it.
// -------------------------------------------------------------------
function CopyReply({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  if (isStreaming || content.trim().length === 0) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/msg:opacity-100 group-focus-within/msg:opacity-100"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(content);
          setCopied(true);
        } catch {
          // Blocked by the browser, or no permission. Say so rather than
          // showing a tick for something that did not happen.
          toast.error("Could not copy to the clipboard.");
        }
      }}
      aria-label={copied ? "Copied" : "Copy reply"}
    >
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
