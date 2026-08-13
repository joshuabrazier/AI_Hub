"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, CircleStop, SendHorizontal, Sparkles, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MESSAGES } from "@/lib/constants";
import { AI_CHAT_ROLES } from "@/lib/data/kysely-database-types";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { MAX_MESSAGE_CHARS, type AiChatMessageDTO, type AiChatSubjectDetailDTO } from "../ai-chat.types";

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
export function AiChatThread({ detail }: { detail: AiChatSubjectDetailDTO }) {
  const router = useRouter();

  // Seeded from the server and then advanced locally while a reply streams.
  // Re-synced from the server once the reply lands, which is what replaces
  // the optimistic rows with the persisted ones (real ids, token counts).
  const [messages, setMessages] = useState<AiChatMessageDTO[]>(detail.messages);
  const [draft, setDraft] = useState("");

  // The reply currently arriving. Null when nothing is in flight; an empty
  // string means the request is away but no text has come back yet, which
  // is what drives the thinking indicator.
  const [reply, setReply] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const isStreaming = reply !== null;

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
    if (!content || isStreaming) return;

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
    };

    setMessages((current) => [...current, optimistic]);
    setDraft("");
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
      const aborted = error instanceof DOMException && error.name === "AbortError";
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
          },
        ]);
      }

      // Re-sync: replaces both optimistic rows with the persisted ones and
      // picks up the auto-derived conversation title in the sidebar.
      router.refresh();
    }
  };

  return (
    <div className="flex h-[calc(100vh-18rem)] min-h-[28rem] flex-col rounded-xl border border-border">
      {/* Transcript */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {messages.length === 0 && !isStreaming ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles size={22} aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-medium text-foreground">Ask the first question</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The whole conversation is sent each time, so you can build on your earlier questions.
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {messages.map((message) => (
              <Fragment key={message.id}>
                <MessageRow message={message} />

                {/* Where the model's own recall stops being verbatim. Shown so
                    a reader is never left wondering why it seems to have
                    forgotten something said further up - the messages above
                    are still here and still readable, the model just sees a
                    summary of them now. */}
                {message.id === detail.summarizedThroughMessageId && (
                  <li className="flex items-center gap-3 py-1" aria-hidden="false">
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
                }}
                isStreaming
              />
            )}
          </ul>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <Textarea
            aria-label="Message"
            value={draft}
            maxLength={MAX_MESSAGE_CHARS}
            rows={2}
            placeholder="Ask anything..."
            disabled={isStreaming}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter makes a new line - the convention
              // for a chat composer. Guarded on the IME composition flag so
              // Enter to accept a candidate in a Japanese or Chinese input
              // does not fire a send.
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
            className="min-h-0 resize-none"
          />

          {isStreaming ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => abortRef.current?.abort()}
              aria-label="Stop generating"
            >
              <CircleStop size={16} aria-hidden="true" />
              Stop
            </Button>
          ) : (
            <Button type="button" onClick={() => void send()} disabled={draft.trim().length === 0}>
              <SendHorizontal size={16} aria-hidden="true" />
              Send
            </Button>
          )}
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          Enter to send, Shift + Enter for a new line. Replies can be wrong - check anything that matters.
        </p>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------
// One turn.
//
// `content` is rendered as a TEXT NODE, never as HTML. Both halves of a
// conversation are untrusted: the user's because they typed it, the model's
// because a model repeats back whatever it was given. `whitespace-pre-wrap`
// preserves the line breaks and indentation without giving up that escaping.
// -------------------------------------------------------------------
function MessageRow({ message, isStreaming = false }: { message: AiChatMessageDTO; isStreaming?: boolean }) {
  const isUser = message.role === AI_CHAT_ROLES.USER;

  return (
    <li className="flex gap-3">
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground",
        )}
      >
        {isUser ? <UserRound size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {isUser ? "You" : "Assistant"}
        </p>

        {message.content.length === 0 && isStreaming ? (
          <p className="mt-1 text-sm text-muted-foreground" role="status">
            Thinking...
          </p>
        ) : (
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{message.content}</p>
        )}

        {/* Cost per answer, once the reply has landed and been persisted.
            `totalInputTokens` rather than `inputTokens`: with caching on the
            latter is only the uncached remainder, so showing it alone would
            report a fraction of what was sent and make a working cache look
            like a broken counter. The cached share is called out separately,
            because that is the part billed at roughly a tenth of the rate. */}
        {!isStreaming && message.outputTokens !== null && (
          <p className="mt-1.5 font-mono text-xs tabular-nums text-muted-foreground">
            {message.totalInputTokens ?? 0} in / {message.outputTokens} out
            {message.cacheReadTokens ? ` (${message.cacheReadTokens} cached)` : ""} &middot;{" "}
            {formatDateTime(message.createdAt)}
          </p>
        )}
      </div>
    </li>
  );
}
