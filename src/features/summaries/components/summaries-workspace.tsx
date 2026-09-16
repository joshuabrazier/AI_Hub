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

import { SavedSummaries } from "./saved-summaries";
import {
  MAX_INPUT_CHARS,
  MIN_INPUT_CHARS,
  SUMMARY_STYLES,
  SUMMARY_STYLE_DESCRIPTIONS,
  SUMMARY_STYLE_LABELS,
  SUMMARY_STYLE_RESULT_HEADINGS,
  type SavedSummaryDetailDTO,
  type SummariesPageDTO,
  type SummaryStyle,
} from "../summaries.types";

// -------------------------------------------------------------------
// SummariesWorkspace
//
// Paste, pick a style, read the summary as it arrives.
//
// WHAT WAS PASTED AND WHAT CAME BACK ARE BOTH SAVED, to the person's own
// account. The exchange still lives in this component's state while it is
// happening - the row is written before the model is asked and settled when
// the stream ends, server-side, so nothing here is responsible for
// persisting anything.
//
// Opening a saved one replaces both panes with what was stored. That is the
// only way back into old work, so it deliberately loads the material as well
// as the answer: a summary without the thing it summarised is not much use
// six months later.
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
  // An interrupted one is not resumable: the row keeps whatever arrived and
  // says it did not finish, but the rest of that model call is paid for and
  // gone.
  useWorkInFlight(isStreaming);

  const characters = text.trim().length;
  const tooShort = characters > 0 && characters < MIN_INPUT_CHARS;
  const tooLong = characters > MAX_INPUT_CHARS;
  const canSubmit = page.isConfigured && !isStreaming && characters >= MIN_INPUT_CHARS && !tooLong;

  // -------------------------------------------------------------------
  // HOW MUCH SHORTER, which is the only thing this screen is about.
  //
  // Everything else on the page is machinery. A long thing became a short
  // thing and the screen never said by how much, so the result read as
  // "some text arrived" rather than as the thing somebody came for.
  //
  // Arithmetic on two character counts, done here, so it is exact rather
  // than a model's guess at its own output. The reading figure is the one
  // ESTIMATE - five characters a word and 240 words a minute are the
  // conventional numbers - which is why the copy says "about", and why it is
  // shown only from a minute up. "About 0 minutes saved" is worse than
  // silence.
  // -------------------------------------------------------------------
  const summaryCharacters = summary.trim().length;
  const percentOfSource =
    characters > 0 && summaryCharacters > 0
      ? Math.max(1, Math.round((summaryCharacters / characters) * 100))
      : 0;
  const minutesOfReading = (count: number) => count / 5 / 240;
  const minutesSaved = Math.round(minutesOfReading(characters) - minutesOfReading(summaryCharacters));
  const hasResult = summaryCharacters > 0;

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  // -------------------------------------------------------------------
  // Opening something saved.
  //
  // BOTH PANES ARE REPLACED, material as well as answer. A stored summary
  // with no sight of what it was made from is close to useless months
  // later - the question "is this the right version of the contract" can
  // only be answered by the text.
  //
  // The style is restored too, because the three styles are three different
  // questions: reading an executive summary under a heading that says
  // Detailed would misrepresent what was asked.
  // -------------------------------------------------------------------
  const openSaved = (saved: SavedSummaryDetailDTO) => {
    setText(saved.sourceText);
    setStyle(saved.style);
    setSummary(saved.summary ?? "");
    setStreamError(saved.error);
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
    // THE ANSWER IS THE COLOURED HALF.
    //
    // This page was two white rectangles: the box you paste into and the box
    // you read out of were the same object twice, so nothing on the screen
    // said which one you came for. It had no focal point, and it sat in the
    // top-left of an empty window.
    //
    // So the result gets --spotlight and the input does not. The raw material
    // recedes, the thing the machine produced comes forward, and the page has
    // colour in it from the moment it loads rather than only after somebody
    // has used it - which is the part that matters, because a screen that is
    // only interesting once you have done something is a screen that looks
    // dead on arrival.
    //
    // ONE spotlight per screen. Two would be the same flatness with more
    // colour in it.
    // ===================================================================
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* -----------------------------------------------------------------
          THE DEPTH CHOICE, STILL THREE CARDS WITH THEIR DESCRIPTIONS - but
          across rather than down.
          A previous pass collapsed these into a segmented control, which was
          wrong twice: it was a generic control, and the descriptions ARE the
          point. "Detailed", "Summary" and "Executive" are three words that
          leave somebody guessing, and the sentence under each is what stops
          the guessing. Three across keeps every description on screen and
          still costs one row instead of three.
          ----------------------------------------------------------------- */}
      {/* ---------------------------------------------------------------
          THE WAY BACK IN. Above the two panes because it is how a session
          starts when somebody is returning rather than pasting - and
          horizontal so it costs the panes below almost no height.
          --------------------------------------------------------------- */}
      <SavedSummaries saved={page.saved} disabled={isStreaming} onOpen={openSaved} />

      <fieldset className="shrink-0" disabled={isStreaming}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <legend className="text-sm font-medium text-foreground">Style</legend>

          <div className="flex items-center gap-2">
            {isStreaming ? (
              <Button type="button" variant="outline" size="sm" onClick={stop}>
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

        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {STYLE_ORDER.map((option) => {
            const isSelected = style === option;

            return (
              <label
                key={option}
                className={cn(
                  "flex min-w-0 cursor-pointer gap-2.5 rounded-lg border p-3 transition-colors",
                  isSelected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:bg-muted",
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
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    {SUMMARY_STYLE_LABELS[option]}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                    {SUMMARY_STYLE_DESCRIPTIONS[option]}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        {/* ---------------------------------------------------------------
            WHAT GOES IN. Deliberately plain: it is raw material, and giving
            it equal weight to the answer is what made the page read as two
            empty boxes.
            --------------------------------------------------------------- */}
        <section className="flex min-h-0 min-w-0 flex-col gap-2">
          <div className="flex min-h-7 shrink-0 items-center justify-between gap-3">
            <Label htmlFor="summary-source">Text to summarise</Label>

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
            className="min-h-56 flex-1 resize-none font-normal"
          />

          {tooLong || tooShort ? (
            <p className="shrink-0 text-xs text-destructive">
              {tooLong
                ? "Too long to do in one pass. Split it and summarise the parts."
                : `Paste at least ${MIN_INPUT_CHARS.toLocaleString()} characters to summarise.`}
            </p>
          ) : null}
        </section>

        {/* ---------------------------------------------------------------
            WHAT COMES OUT. The spotlight.
            --------------------------------------------------------------- */}
        <section className="flex min-h-0 min-w-0 flex-col gap-2">
          <div className="flex min-h-7 shrink-0 items-center justify-between gap-3">
            <p className="text-sm font-medium text-foreground">
              {SUMMARY_STYLE_RESULT_HEADINGS[style]}
            </p>

            {hasResult && !isStreaming ? (
              <Button type="button" variant="outline" size="sm" onClick={copy}>
                <Copy size={14} aria-hidden="true" />
                Copy
              </Button>
            ) : null}
          </div>

          {/* -------------------------------------------------------------
              A TEAL FRAME AROUND A WHITE SHEET, rather than prose printed
              straight onto the colour.
              The frame is what makes this the answer half of the page. The
              sheet is where the words go, and it is white for two reasons
              that both matter more than the extra boldness would be worth:
              several paragraphs of prose on a saturated ground is harder to
              read, on a screen whose entire job is reading; and ModelMarkdown
              paints with the PAGE's tokens - text-foreground, bg-muted,
              text-primary links - so on teal its body text would be near-
              black on dark teal. That is the same mistake the rail made with
              its rows, and the fix there was to restate the ink. Here the
              better answer is to give the ink the surface it was measured
              against.
              ------------------------------------------------------------- */}
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-xl bg-spotlight p-2 text-spotlight-foreground shadow-lg">
            {/* -----------------------------------------------------------
                THE READOUT, and it is the one loud thing on the page.
                A percentage at display size is not decoration here: it is
                the single fact the whole screen exists to produce. It earns
                the room by only being there once there is a result - before
                that the header carries the invitation instead, so the panel
                is never a big empty box with a zero in it.
                ----------------------------------------------------------- */}
            <div className="flex shrink-0 items-end justify-between gap-4 px-3 pt-2 pb-1">
              {hasResult ? (
                <>
                  <div className="min-w-0">
                    <p className="font-heading text-4xl leading-none font-bold tracking-tight text-spotlight-accent tabular-nums">
                      {percentOfSource}%
                    </p>
                    <p className="mt-1.5 text-xs text-spotlight-muted">
                      {summaryCharacters.toLocaleString()} of {characters.toLocaleString()} characters
                      {minutesSaved >= 1 ? `, about ${minutesSaved} min of reading saved` : ""}
                    </p>
                  </div>

                  {/* The proportion, drawn. Vertical so it reads as a level
                      rather than as a progress bar, which is a different
                      promise. One transition, and it is skipped for anybody
                      who has asked for less motion. */}
                  <div
                    className="flex h-12 w-2 shrink-0 items-end overflow-hidden rounded-full bg-spotlight-foreground/15"
                    role="img"
                    aria-label={`The summary is ${percentOfSource}% the length of your text`}
                  >
                    <div
                      className="w-full rounded-full bg-spotlight-accent transition-[height] duration-700 ease-out motion-reduce:transition-none"
                      style={{ height: `${percentOfSource}%` }}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-spotlight-muted">
                  {isStreaming ? "Reading it now…" : "Your summary will land here."}
                </p>
              )}
            </div>

            {streamError !== null && (
              <div
                className="shrink-0 rounded-lg bg-destructive/25 px-3 py-2.5"
                // Announced, because it can arrive a minute after the send
                // while the reader is looking at the source text.
                role="alert"
              >
                <p className="flex items-center gap-2 text-sm font-medium text-spotlight-foreground">
                  <TriangleAlert size={14} aria-hidden="true" />
                  {hasResult ? "The summary did not finish" : "The summary could not be produced"}
                </p>
                {/* Selectable and wrapped. A diagnosis somebody has to retype
                    is one they will not pass on. */}
                <p className="mt-1.5 break-words whitespace-pre-wrap text-xs leading-relaxed text-spotlight-muted">
                  {streamError}
                </p>
                {hasResult ? (
                  <p className="mt-2 text-xs text-spotlight-muted">
                    What is shown below stops where it stopped. Nothing is saved either way, so treat it
                    as incomplete rather than short.
                  </p>
                ) : null}
              </div>
            )}

            {/* The panel scrolls, not the page. A detailed summary of a long
                report is taller than the window, and with the page filling
                the viewport there is nowhere else for it to go. */}
            {/* The sheet. It scrolls, not the page - a detailed summary of a
                long report is taller than the window, and with the page
                filling the viewport there is nowhere else for it to go. */}
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-lg bg-card px-4 py-3.5 text-card-foreground">
              {hasResult ? (
                // Model output, so it goes through the same renderer as a chat
                // reply - React elements, never an HTML string. The source text
                // was somebody else's document and a model repeats back what it
                // was given, which is exactly the case that renderer exists for.
                <ModelMarkdown content={summary} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <FileText size={24} aria-hidden="true" />
                  </span>
                  {/* AN EMPTY SCREEN IS AN INVITATION. "The summary will
                      appear here" tells somebody looking at an empty box that
                      the box is empty. */}
                  <p className="max-w-56 text-sm text-muted-foreground">
                    {isStreaming
                      ? "Reading your text and writing it back shorter."
                      : canSubmit
                        ? "Ready when you are. Press Summarise."
                        : "Paste your text on the left to get started."}
                  </p>
                </div>
              )}
            </div>

            {/* The retention warning where it can still be acted on: beside a
                summary somebody is about to lose, rather than only in the page
                description they read before they had one. */}
            {hasResult && !isStreaming ? (
              <p className="shrink-0 px-3 pb-1 text-xs text-spotlight-muted">
                Not saved anywhere. Copy it before you leave this page.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
