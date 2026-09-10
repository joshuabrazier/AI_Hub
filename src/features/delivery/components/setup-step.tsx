"use client";

import { useState } from "react";

import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

// ===================================================================
// ONE STEP OF SETTING A PROJECT UP
//
// WHAT THIS REPLACES. Three panels, stacked, all open, all the same size -
// about eleven hundred lines of interface arriving at once on a screen
// somebody opens knowing none of it is done yet. Nothing said what order to
// work in, nothing said when you had finished, and two of the three were
// compulsory while the third was not.
//
// THE COLLAPSED STATE SHOWS THE ANSWER, NOT A TICK, and that is the whole
// idea. Setting up a project is a short list of questions - who is on it,
// what are its phases, is anybody's time pooled - so a finished step should
// read as the answer to its question. "Louis leading, and 3 others" tells
// you the thing a tick withholds, and it means the whole page can be read
// at a glance without opening anything.
//
// NUMBERED ONLY WHERE ORDER IS REAL. The dependency is not decorative:
// SetupBudgetGroupsPanel takes the member list, so people genuinely come
// first, and a board with no phases has nowhere to put a task. Those two are
// 1 and 2. Pooled budgets are optional and carry no number, because
// numbering all three would say three things are required when two are - the
// exact impression the old page gave by showing three identical panels.
//
// IT OWNS NO DATA AND WRITES NOTHING. Every panel inside still saves as it
// goes, exactly as before; this decides what is visible. That is deliberate:
// the panels are large and well-tested, and wrapping them cost nothing while
// rewriting them would have risked their behaviour for a layout change.
// ===================================================================
export function SetupStep({
  step,
  title,
  question,
  summary,
  isComplete,
  defaultOpen,
  children,
}: {
  // Absent for an optional step. See the note above.
  step?: number;
  title: string;
  // What this step is actually asking, shown while it is open. A heading
  // names a thing; this says what to do about it.
  question: string;
  // The answer, shown while it is closed. Written by the caller because only
  // it knows the data - and phrased as a fact, never as "3 items".
  summary: string;
  isComplete: boolean;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className="relative">
      <div className="flex gap-4">
        {/* -----------------------------------------------------------
            The rail. A fixed narrow gutter so every step's content starts
            on the same line, which is what makes the sequence readable as
            a column rather than as three cards that happen to be stacked.
            ----------------------------------------------------------- */}
        <div className="flex shrink-0 flex-col items-center" aria-hidden="true">
          <span
            className={cn(
              "flex size-7 items-center justify-center rounded-full border text-xs font-medium figure transition-colors",
              isComplete
                ? "border-transparent bg-primary/10 text-primary"
                : isOpen
                  ? "border-primary/40 bg-background text-foreground"
                  : "border-border bg-background text-muted-foreground",
            )}
          >
            {isComplete ? <Check size={14} /> : (step ?? "+")}
          </span>

          {/* The connector, which is what turns three markers into one
              sequence. Not drawn under the last step - a line running into
              nothing reads as a step somebody forgot to add. */}
          <span className="mt-1 w-px flex-1 bg-border" />
        </div>

        <div className="min-w-0 flex-1 pb-8">
          <button
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            aria-expanded={isOpen}
            className="group flex w-full items-start gap-3 rounded-md text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">{title}</span>
                {step === undefined && (
                  <span className="text-xs text-muted-foreground">Optional</span>
                )}
              </span>

              {/* The question while open, the answer while closed. One line
                  either way, so opening a step does not move the ones below
                  it any further than the panel itself does. */}
              <span className="mt-0.5 block break-words text-sm text-muted-foreground">
                {isOpen ? question : summary}
              </span>
            </span>

            <ChevronDown
              size={16}
              aria-hidden="true"
              className={cn(
                "mt-0.5 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground",
                isOpen && "rotate-180",
              )}
            />
          </button>

          {/* Unmounted rather than hidden when closed. These panels each hold
              their own dialogs and pending state, and a closed step keeping a
              half-filled form alive is a surprise waiting for whoever opens
              it again. */}
          {isOpen && <div className="mt-4">{children}</div>}
        </div>
      </div>
    </section>
  );
}

// -------------------------------------------------------------------
// The end of the sequence.
//
// THERE IS NOTHING TO SUBMIT, and saying so is most of this component's job.
// Every panel writes as it changes, so a person who has worked down the page
// has already finished - but a page that simply stops leaves them looking
// for a save button that was never going to be there.
//
// It is one link, and it used to be two: the same "Open the board" sat in
// the page header as well, where somebody looks to LEAVE a screen rather
// than to finish one. Two buttons with one label, one of which is the real
// end of the job, is a choice nobody should have to make.
// -------------------------------------------------------------------
export function SetupDone({
  isReady,
  missing,
  children,
}: {
  isReady: boolean;
  // What is still needed, in the order the steps ask for it. Named, because
  // "setup is incomplete" sends somebody back to check all of it.
  missing: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex shrink-0 justify-center" aria-hidden="true">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-full border",
            isReady ? "border-transparent bg-primary/10 text-primary" : "border-border",
          )}
        >
          {isReady ? <Check size={14} /> : null}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {isReady ? "Ready to work on" : "Not ready yet"}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {isReady
            ? "Everything saves as you change it, so there is nothing left to submit. The board is where phases get their tasks."
            : `Add ${formatMissing(missing)} and the board can be used.`}
        </p>

        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

// "people and phases" rather than "people, phases". Two items take "and",
// which is the only case this has to handle - there are two required steps.
function formatMissing(missing: string[]): string {
  if (missing.length <= 1) return missing[0] ?? "the missing pieces";

  return `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
}
