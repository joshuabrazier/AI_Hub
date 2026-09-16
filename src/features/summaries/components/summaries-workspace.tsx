"use client";

import { useRef, useState } from "react";

import { Copy, FileText, Sparkles, StopCircle, TriangleAlert } from "lucide-react";

import { createStreamDecoder, type StreamEvent } from "@/lib/ai/stream-protocol";
import { toast } from "sonner";

import { ModelMarkdown } from "@/components/model-markdown";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useWorkInFlight } from "@/features/layout/work-in-flight";
import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";
import { cn } from "@/lib/utils";

import {
  MAX_INPUT_CHARS,
  MIN_INPUT_CHARS,
  SUMMARY_STYLES,
  SUMMARY_STYLE_DESCRIPTIONS,
  SUMMARY_STYLE_LABELS,
  SUMMARY_STYLE_RESULT_HEADINGS,
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

  // Why the last attempt stopped, in the server's own words. Inline rather
  // than a toast: it is worth reading twice and worth being able to copy, and
  // a toast reading "something went wrong" was the thing being complained
  // about.
  const [streamError, setStreamError] = useState<string | null>(null);

  // Held so Stop can abort a request that may have a minute left to run.
  const abortRef = useRef<AbortController | null>(null);

  // Tell the deployment watcher not to reload over a summary being written.
  // This feature stores nothing, so an interrupted one is not resumable and
  // not recoverable - it is a model call paid for and thrown away.
  useWorkInFlight(isStreaming);

  const characters = text.trim().length;
  const tooShort = characters > 0 && characters < MIN_INPUT_CHARS;
  const tooLong = characters > MAX_INPUT_CHARS;
  const canSubmit = page.isConfigured && !isStreaming && characters >= MIN_INPUT_CHARS && !tooLong;

  // -------------------------------------------------------------------
  // WHAT THE READER ACTUALLY GAINS, measured rather than implied.
  //
  // The one number this screen is about. Everything else on it - the box, the
  // depth control, the button - is machinery; the reason anybody came is that
  // a long thing became a short thing, and until now the page never said by
  // how much. It is arithmetic on two character counts, done here, so it is
  // exact rather than a model's guess at its own output.
  //
  // The reading estimate is the half people care about, and it is an ESTIMATE:
  // five characters a word and 240 words a minute are the conventional
  // figures, and the copy says "about" because of it. Shown only from a
  // minute up - "about 0 minutes saved" is worse than silence.
  // -------------------------------------------------------------------
  const summaryCharacters = summary.trim().length;
  const percentOfSource =
    characters > 0 ? Math.max(1, Math.round((summaryCharacters / characters) * 100)) : 0;
  const minutesOfReading = (count: number) => count / 5 / 240;
  const minutesSaved = Math.round(minutesOfReading(characters) - minutesOfReading(summaryCharacters));

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const submit = async () => {
    if (!canSubmit) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setIsStreaming(true);
    // Cleared on a new attempt rather than on a timer, so the last thing that
    // happened stays readable until something else does.
    setStreamError(null);
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
      const textDecoder = new TextDecoder();
      const events = createStreamDecoder();

      const apply = (event: StreamEvent) => {
        if (event.t === "text") {
          setSummary((previous) => previous + event.v);
          return;
        }

        // A failure that arrived after the 200. Shown rather than swallowed:
        // a summary that stops mid-sentence looks finished, and one of
        // somebody's contract presented as whole when it is not is worse
        // than no summary at all.
        if (event.t === "error") setStreamError(event.v);
      };

      // Appended chunk by chunk. `stream: true` on decode matters: a
      // multi-byte character can be split across chunk boundaries, and
      // decoding each one independently would produce replacement characters
      // mid-word. It has to run BEFORE the line splitting, which works on
      // characters.
      for (;;) {
        const { done, value } = await reader.read();

        if (done) break;

        for (const event of events.push(textDecoder.decode(value, { stream: true }))) apply(event);
      }

      for (const event of events.flush()) apply(event);

      if (events.malformed > 0) {
        setStreamError(
          `${events.malformed} part(s) of the summary arrived damaged and were skipped, so what is shown may be incomplete.`,
        );
      }
    } catch (error) {
      // An abort is somebody pressing Stop, not a failure. Whatever arrived
      // before it stays on screen.
      if (error instanceof DOMException && error.name === "AbortError") return;

      // A fetch that throws is the network rather than the app, so it gets
      // its own sentence instead of the generic one.
      setStreamError(
        error instanceof Error
          ? `The connection to the server failed: ${error.message}`
          : MESSAGES.SOMETHING_WENT_WRONG,
      );

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
        // h-full so it centres in the filled page rather than sitting at the
        // top of it with the rest of the window empty underneath.
        className="flex h-full flex-col items-center justify-center rounded-xl border border-border bg-muted/40 px-6 py-16 text-center"
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
    // ===================================================================
    // A WORKBENCH, NOT A FORM, and that is the whole redesign.
    //
    // This was laid out as a form: label, field, a stack of three radio
    // cards, submit - with the result as a short box parked beside the top of
    // it. Everything sat in the top-left, the output was visibly a lesser
    // thing than the input, and on a normal monitor two thirds of the screen
    // was empty.
    //
    // It is a before-and-after instrument. So: the two texts are PEERS, side
    // by side and the same height, the controls that govern both sit in one
    // strip above them, and the page fills the window instead of trailing off
    // into white. `fill` on PortalPage is what makes the height real rather
    // than guessed.
    // ===================================================================
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* -----------------------------------------------------------------
          ONE CONTROL STRIP FOR BOTH PANES.
          The depth choice was three stacked cards, each carrying a label and
          a description - about 180px of vertical space to pick one of three
          things. As a segmented control it is one row, and it is also a
          better control: three options side by side are compared, where three
          paragraphs are read. The description does not disappear, it moves to
          a line underneath that describes THE SELECTED ONE, which is the only
          one that matters once the choice is made.
          ----------------------------------------------------------------- */}
      <div className="flex shrink-0 flex-col gap-2.5 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <fieldset disabled={isStreaming} className="min-w-0">
            <legend className="sr-only">Summary depth</legend>

            <div className={cn("inline-flex gap-0.5 rounded-lg bg-muted p-1", isStreaming && "opacity-60")}>
              {STYLE_ORDER.map((option) => {
                const isSelected = style === option;

                return (
                  <label
                    key={option}
                    className={cn("min-w-0", isStreaming ? "cursor-not-allowed" : "cursor-pointer")}
                  >
                    {/* A REAL RADIO, hidden rather than replaced. The segments
                        are styled text, but arrow-key navigation, the group
                        semantics and the announcement all come from the input
                        - a div with an onClick would have none of them. */}
                    <input
                      type="radio"
                      name="summary-style"
                      value={option}
                      checked={isSelected}
                      disabled={isStreaming}
                      onChange={() => setStyle(option)}
                      className="peer sr-only"
                    />
                    <span
                      className={cn(
                        "block rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
                        // The focus ring has to be put back by hand, because
                        // the input it would have drawn around is sr-only.
                        "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:outline-none",
                        isSelected
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {SUMMARY_STYLE_LABELS[option]}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex items-center gap-2">
            {isStreaming ? (
              <Button type="button" variant="outline" onClick={stop}>
                <StopCircle size={16} aria-hidden="true" />
                Stop
              </Button>
            ) : null}

            <Button type="button" onClick={submit} disabled={!canSubmit} loading={isStreaming}>
              <Sparkles size={16} aria-hidden="true" />
              {isStreaming ? "Summarising…" : "Summarise"}
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{SUMMARY_STYLE_DESCRIPTIONS[style]}</p>
      </div>

      {/* -----------------------------------------------------------------
          THE TWO TEXTS, AS PEERS. Equal width, equal height, headers on the
          same line. The old version made the source tall and the result
          short, which said the paste mattered more than the answer.
          ----------------------------------------------------------------- */}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        {/* What goes in */}
        <section className="flex min-h-0 min-w-0 flex-col gap-2">
          <div className="flex min-h-8 shrink-0 items-center justify-between gap-3">
            <Label htmlFor="summary-source">Your text</Label>

            <span
              className={cn(
                "text-xs tabular-nums",
                tooShort || tooLong ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {characters.toLocaleString()} characters
            </span>
          </div>

          <Textarea
            id="summary-source"
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={isStreaming}
            placeholder="Paste a document, a transcript, an email thread - anything you would rather not read in full."
            // min-h so it is still a usable box when the two stack on a
            // phone, flex-1 so it takes the height on a real screen.
            className="min-h-48 flex-1 resize-none font-normal"
          />

          {/* Only when there is something to say. A character count that is
              fine is already in the header; this line is for the two states
              that stop the button working. */}
          {tooLong || tooShort ? (
            <p className="shrink-0 text-xs text-destructive">
              {tooLong
                ? "Too long to do in one pass. Split it and summarise the parts."
                : `Paste at least ${MIN_INPUT_CHARS.toLocaleString()} characters to summarise.`}
            </p>
          ) : null}
        </section>

        {/* What comes out */}
        <section className="flex min-h-0 min-w-0 flex-col gap-2">
          <div className="flex min-h-8 shrink-0 items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">
              {SUMMARY_STYLE_RESULT_HEADINGS[style]}
            </p>

            {summary && !isStreaming ? (
              <Button type="button" variant="outline" size="sm" onClick={copy}>
                <Copy size={14} aria-hidden="true" />
                Copy
              </Button>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card">
            {streamError !== null && (
              <div
                className="shrink-0 border-b border-destructive/30 bg-destructive/5 px-4 py-3"
                // Announced, because it can arrive a minute after the send
                // while the reader is looking at the source text.
                role="alert"
              >
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <TriangleAlert size={14} className="text-destructive" aria-hidden="true" />
                  {summary ? "The summary did not finish" : "The summary could not be produced"}
                </p>
                {/* Selectable and wrapped. A diagnosis somebody has to retype
                    is one they will not pass on. */}
                <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                  {streamError}
                </p>
                {summary ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    What is shown below stops where it stopped. Nothing is saved either way, so treat it
                    as incomplete rather than short.
                  </p>
                ) : null}
              </div>
            )}

            {/* The pane scrolls, not the page. A detailed summary of a long
                report is longer than the window, and with the page filling
                the viewport there is nowhere else for it to go. */}
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
              {summary ? (
                // Model output, so it goes through the same renderer as a chat
                // reply - React elements, never an HTML string. The source text
                // was somebody else's document and a model repeats back what it
                // was given, which is exactly the case that renderer exists for.
                <ModelMarkdown content={summary} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <FileText size={22} aria-hidden="true" />
                  </span>
                  {/* AN EMPTY SCREEN IS AN INVITATION, so it says what to do
                      next rather than describing itself. "The summary will
                      appear here" tells somebody looking at an empty box that
                      the box is empty. */}
                  <p className="mt-3 text-sm text-muted-foreground">
                    {isStreaming
                      ? "Reading it now."
                      : canSubmit
                        ? "Ready when you are. Press Summarise."
                        : "Paste your text on the left to get started."}
                  </p>
                </div>
              )}
            </div>

            {/* -------------------------------------------------------------
                HOW MUCH SHORTER, which is the only thing this screen is
                actually about. Every other element here is machinery. It
                appears once there is a result to measure and not before,
                because a meter reading zero is furniture.
                ------------------------------------------------------------- */}
            {summary && !isStreaming ? (
              <div className="shrink-0 border-t border-border px-4 py-3">
                <div
                  className="h-1 overflow-hidden rounded-full bg-muted"
                  role="img"
                  aria-label={`The summary is ${percentOfSource}% the length of your text`}
                >
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${percentOfSource}%` }}
                  />
                </div>

                <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    <span className="font-medium tabular-nums text-foreground">
                      {summaryCharacters.toLocaleString()}
                    </span>{" "}
                    characters, {percentOfSource}% of what you pasted
                  </span>

                  {minutesSaved >= 1 ? <span>about {minutesSaved} min of reading saved</span> : null}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
