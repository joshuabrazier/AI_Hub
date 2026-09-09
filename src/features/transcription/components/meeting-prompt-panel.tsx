"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, ChevronDown, CircleDot, ExternalLink, PictureInPicture2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { MeetingNowDTO } from "../meeting-now.service";

// -------------------------------------------------------------------
// The panel. Rendered either in the page or inside the floating window, so
// there is one of it and the two cannot drift apart.
//
// IT IS LOUD ON PURPOSE. The first version was a quiet card in a corner and
// went unnoticed through an entire meeting, which is total failure for
// something whose only job is to be seen in the first two minutes. A missed
// prompt is worse than no prompt: the meeting cannot be recovered afterwards.
//
// THERE IS ONE INSTRUCTION AND NO BUTTON. The only thing a person has to do
// is press Microsoft's button inside Teams, and this app cannot do that for
// them - Graph has no API for it. Everything after that is automatic:
// collection is armed the moment the meeting is detected, and the transcript
// is imported and summarised once it ends. An earlier version asked for a
// confirmation here, which was friction in the middle of a meeting and, worse,
// a step that goes unpressed - and an unpressed confirmation is a transcript
// nobody collects.
// -------------------------------------------------------------------

export function MeetingPromptPanel({
  data,
  collecting,
  onCancelCollection,
  onDismiss,
  onPopOut,
  canPopOut,
  floating,
}: {
  data: MeetingNowDTO;
  collecting: boolean;
  onCancelCollection: () => void;
  onDismiss: () => void;
  onPopOut: () => void;
  canPopOut: boolean;
  floating: boolean;
}) {
  const [showHow, setShowHow] = useState(false);

  const subject = data.meeting?.subject ?? null;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border-2 border-amber-500/70 bg-background p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {/* A dot rather than a microphone. Nothing here is recording, and an
              icon implying otherwise is the one thing this must never say. */}
          <CircleDot className="size-5 shrink-0 animate-pulse text-amber-600" aria-hidden />
          <p className="text-lg font-semibold leading-tight">Start recording this meeting</p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!floating && canPopOut && (
            <Button variant="ghost" size="icon" onClick={onPopOut} aria-label="Keep this on top">
              <PictureInPicture2 className="size-4" aria-hidden />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onDismiss} aria-label="Dismiss">
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      {subject && <p className="-mt-2 text-sm font-medium text-muted-foreground">{subject}</p>}

      {data.ambiguous.length > 0 && (
        // Named rather than picked. Announcing a recording of the wrong
        // meeting to a room of people is worse than admitting we cannot tell
        // which of two overlapping entries this is.
        <p className="text-sm text-muted-foreground">
          Two meetings overlap right now, {data.ambiguous.map((entry) => entry.subject).join(" and ")}, so this
          cannot tell which one you are in.
        </p>
      )}

      <div className="rounded-xl bg-amber-50 p-4 dark:bg-amber-950/30">
        <p className="text-base font-semibold">In Teams: More actions, then Record and transcribe.</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Teams announces it to everyone in the meeting, which is what makes it lawful to keep, and it labels each
          speaker by name. Nothing is recorded until you do this.
        </p>
      </div>

      <button
        type="button"
        onClick={() => setShowHow((shown) => !shown)}
        className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left text-sm font-medium hover:bg-muted/50"
        aria-expanded={showHow}
      >
        How do I start it?
        <ChevronDown className={cn("size-4 transition-transform", showHow && "rotate-180")} aria-hidden />
      </button>

      {showHow && (
        <ol className="list-decimal space-y-2 rounded-lg border border-border bg-muted/30 p-4 pl-8 text-sm">
          <li>In the meeting toolbar, click the three dots, labelled More.</li>
          <li>
            Choose <span className="font-medium">Record and transcribe</span>.
          </li>
          <li>
            Choose <span className="font-medium">Start transcription</span>. Start recording works too and gives you
            the video as well, but transcription is all this needs.
          </li>
          <li>Everyone sees a banner saying it has started. Say out loud that you have begun, as a courtesy.</li>
          <li>
            Only the organiser and people from our own organisation can start it. If the option is not there, the
            meeting belongs to somebody else&apos;s tenant and they hold the transcript.
          </li>
        </ol>
      )}

      {/* ---------------------------------------------------------------
          What happens next, stated rather than asked for. This is the
          half that used to be a button.
          --------------------------------------------------------------- */}
      {collecting ? (
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-50/60 p-3 dark:bg-emerald-950/20">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
          <div className="space-y-1 text-sm">
            <p className="font-medium">Nothing else to do.</p>
            <p className="text-muted-foreground">
              When this meeting ends, the transcript will be imported and summarised on its own. If nobody starts
              transcription there is simply nothing to collect.
            </p>
            <button
              type="button"
              onClick={onCancelCollection}
              className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Do not collect this one
            </button>
          </div>
        </div>
      ) : data.meeting === null ? (
        <p className="text-sm text-muted-foreground">
          This call is not in your calendar, so there is nothing here to collect afterwards. Teams still keeps the
          transcript if you start one.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">This meeting will not be collected automatically.</p>
      )}

      <Button asChild variant="ghost" size="sm" className="self-start">
        <Link href={data.transcriptionHref} target={floating ? "_blank" : undefined}>
          Open transcription
          <ExternalLink className="size-3.5" aria-hidden />
        </Link>
      </Button>
    </div>
  );
}
