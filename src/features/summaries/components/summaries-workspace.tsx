"use client";

import { useRef, useState } from "react";

import { Copy, FileText, Sparkles, StopCircle } from "lucide-react";
import { toast } from "sonner";

import { ModelMarkdown } from "@/components/model-markdown";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { cn } from "@/lib/utils";

import {
  MAX_INPUT_CHARS,
  MIN_INPUT_CHARS,
  SUMMARY_STYLES,
  SUMMARY_STYLE_DESCRIPTIONS,
  SUMMARY_STYLE_LABELS,
  type SummariesPageDTO,
  type SummaryStyle,
} from "../summaries.types";

// -------------------------------------------------------------------
// SummariesWorkspace
//
// Paste, pick a style, read the summary as it arrives.
//
// NOTHING IS SAVED, and the screen says so rather than letting somebody
// discover it by refreshing. The whole exchange lives in this component's
// state: the text they pasted and the summary streaming back.
//
// The summary is STREAMED rather than awaited, which is why this reads from
// a fetch body instead of calling a server action. A detailed summary of a
// long report takes a minute, and watching it write itself is the
// difference between waiting and staring.
// -------------------------------------------------------------------

const STYLE_ORDER: SummaryStyle[] = [
  SUMMARY_STYLES.DETAILED,
  SUMMARY_STYLES.SUMMARY,
  SUMMARY_STYLES.EXECUTIVE,
];

export function SummariesWorkspace({ page }: { page: SummariesPageDTO }) {
  const [text, setText] = useState("");
  // Default to the middle option, which is the right answer when somebody
  // has not thought about it - see the description on it.
  const [style, setStyle] = useState<SummaryStyle>(SUMMARY_STYLES.SUMMARY);
  const [summary, setSummary] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  // Held so Stop can abort a request that may have a minute left to run.
  const abortRef = useRef<AbortController | null>(null);

  const characters = text.trim().length;
  const tooShort = characters > 0 && characters < MIN_INPUT_CHARS;
  const tooLong = characters > MAX_INPUT_CHARS;
  const canSubmit = page.isConfigured && !isStreaming && characters >= MIN_INPUT_CHARS && !tooLong;

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const submit = async () => {
    if (!canSubmit) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setIsStreaming(true);
    // Cleared up front. Leaving the previous summary on screen while a new
    // one streams in underneath it is the kind of thing that gets the wrong
    // one copied.
    setSummary("");

    try {
      const response = await fetch("/api/summaries/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), style }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // The route answers JSON for anything it refuses before streaming -
        // not configured, too long, not signed in - so the reason is real
        // rather than generic.
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;

        toast.error(detail?.error ?? MESSAGES.SOMETHING_WENT_WRONG);
        return;
      }

      if (!response.body) {
        toast.error(MESSAGES.SOMETHING_WENT_WRONG);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      // Appended chunk by chunk. `stream: true` on decode matters: a
      // multi-byte character can be split across chunk boundaries, and
      // decoding each one independently would produce replacement
      // characters mid-word.
      for (;;) {
        const { done, value } = await reader.read();

        if (done) break;

        setSummary((previous) => previous + decoder.decode(value, { stream: true }));
      }
    } catch (error) {
      // An abort is somebody pressing Stop, not a failure. Whatever arrived
      // before it stays on screen.
      if (error instanceof DOMException && error.name === "AbortError") return;

      handleFrontendErrorWithToast(error);
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      toast.success("Summary copied.");
    } catch {
      // Clipboard access is refused in some browsers without a secure
      // context. Saying so beats a silent no-op.
      toast.error("Could not copy. Select the text and copy it manually.");
    }
  };

  if (!page.isConfigured) {
    return (
      <div
        role="status"
        className="flex flex-col items-center justify-center rounded-xl border border-border bg-muted/40 px-6 py-16 text-center"
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Sparkles size={22} aria-hidden="true" />
        </span>
        <p className="mt-3 text-sm font-medium text-foreground">Summaries are not configured</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          No Bedrock API key is set on this environment, so there is nothing to send text to. Set
          AWS_BEARER_TOKEN_BEDROCK and restart.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* What goes in */}
      <section className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="summary-source">Text to summarise</Label>
          <Textarea
            id="summary-source"
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={isStreaming}
            rows={16}
            placeholder="Paste a document, a transcript, an email thread - anything you would rather not read in full."
            className="resize-y font-normal"
          />
          <p
            className={cn(
              "text-xs",
              tooShort || tooLong ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {tooLong
              ? `${characters.toLocaleString()} characters - too long to do in one pass. Split it and summarise the parts.`
              : tooShort
                ? `${characters.toLocaleString()} characters - paste at least ${MIN_INPUT_CHARS} to summarise.`
                : `${characters.toLocaleString()} characters`}
          </p>
        </div>

        {/* Style. Radio behaviour rather than a select, because the
            descriptions are the point - a three-word label alone would have
            people guessing which one they want. */}
        <fieldset className="grid gap-2" disabled={isStreaming}>
          <legend className="mb-1 text-sm font-medium text-foreground">Style</legend>

          {STYLE_ORDER.map((option) => {
            const isSelected = style === option;

            return (
              <label
                key={option}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors",
                  isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
                  isStreaming && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="radio"
                  name="summary-style"
                  value={option}
                  checked={isSelected}
                  disabled={isStreaming}
                  onChange={() => setStyle(option)}
                  className="mt-1 size-4 shrink-0 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    {SUMMARY_STYLE_LABELS[option]}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {SUMMARY_STYLE_DESCRIPTIONS[option]}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={submit} disabled={!canSubmit} loading={isStreaming}>
            <Sparkles size={16} aria-hidden="true" />
            {isStreaming ? "Summarising..." : "Summarise"}
          </Button>

          {isStreaming ? (
            <Button type="button" variant="outline" onClick={stop}>
              <StopCircle size={16} aria-hidden="true" />
              Stop
            </Button>
          ) : null}
        </div>
      </section>

      {/* What comes out */}
      <section className="min-w-0">
        <div className="flex min-h-64 flex-col rounded-xl border border-border">
          <div className="flex items-center justify-between gap-3 border-b border-border p-4">
            <p className="text-sm font-medium text-foreground">
              {SUMMARY_STYLE_LABELS[style]} summary
            </p>

            {summary && !isStreaming ? (
              <Button type="button" variant="outline" size="sm" onClick={copy}>
                <Copy size={14} aria-hidden="true" />
                Copy
              </Button>
            ) : null}
          </div>

          <div className="min-w-0 flex-1 p-4">
            {summary ? (
              // Model output, so it goes through the same renderer as a chat
              // reply - React elements, never an HTML string. The source text
              // was somebody else's document and a model repeats back what it
              // was given, which is exactly the case that renderer exists for.
              <ModelMarkdown content={summary} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center py-10 text-center">
                <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <FileText size={22} aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm text-muted-foreground">
                  {isStreaming ? "Reading it now..." : "The summary will appear here."}
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
