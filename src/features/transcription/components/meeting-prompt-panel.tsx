"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, CircleDot, ExternalLink, PictureInPicture2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { MeetingNowDTO } from "../meeting-now.service";

// -------------------------------------------------------------------
// The panel. Rendered either in the page or inside the floating window, so
// there is one of it and the two cannot drift apart.
//
// IT IS LOUD ON PURPOSE. The first version was a quiet card in a corner and
// went unnoticed through an entire meeting, which is a total failure for
// something whose only job is to be seen in the first two minutes. A prompt
// that arrives during a meeting and is missed is worse than no prompt: the
// meeting is unrecoverable afterwards.
//
// So it takes real space, leads with the instruction rather than with a
// status, and the primary action is the thing you must do in Teams. The
// detail that used to sit in the body is behind "How do I start it?",
// because somebody who has done this twice does not need to read it again
// and somebody who has never done it needs all of it.
// -------------------------------------------------------------------

export function MeetingPromptPanel({
  data,
  armed,
  arming,
  armError,
  onArm,
  onDismiss,
  onPopOut,
  canPopOut,
  floating,
}: {
  data: MeetingNowDTO;
  armed: boolean;
  arming: boolean;
  armError: string | null;
  onArm: () => void;
  onDismiss: () => void;
  onPopOut: () => void;
  canPopOut: boolean;
  floating: boolean;
}) {
  const [showHow, setShowHow] = useState(false);

  const subject = data.meeting?.subject ?? null;
  // Nothing in the calendar behind the call, so there is no event id to arm
  // against and nothing of ours to collect afterwards. Said plainly rather
  // than discovered later.
  const canAutoImport = data.meeting !== null;

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-2xl border-2 bg-background p-5 shadow-2xl",
        armed ? "border-emerald-500/60" : "border-amber-500/70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {armed ? (
            <Check className="size-5 shrink-0 text-emerald-600" aria-hidden />
          ) : (
            // A filled dot rather than a microphone: nothing here is
            // recording, and an icon implying otherwise would be the one
            // thing this panel must never suggest.
            <CircleDot className="size-5 shrink-0 animate-pulse text-amber-600" aria-hidden />
          )}
          <p className="text-lg font-semibold leading-tight">
            {armed ? "We will collect this one" : "Start recording this meeting"}
          </p>
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

      {armed ? (
        <p className="text-sm text-muted-foreground">
          When the meeting ends, the transcript will be imported and summarised on its own. Nothing else to do.
        </p>
      ) : (
        <>
          <div className="rounded-xl bg-amber-50 p-4 dark:bg-amber-950/30">
            <p className="text-base font-semibold">In Teams: More actions, then Record and transcribe.</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Teams announces it to everyone in the meeting, which is what makes it lawful to keep, and it labels
              each speaker by name. Nothing is recorded until you do this.
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
                Choose <span className="font-medium">Start transcription</span>. Start recording works too and gives
                you the video as well, but transcription is all this needs.
              </li>
              <li>Everyone sees a banner saying it has started. Say out loud that you have begun, as a courtesy.</li>
              <li>Come back here and press the button below.</li>
              <li>
                Only the organiser and people from our own organisation can start it. If the option is missing, the
                meeting belongs to somebody else&apos;s tenant and they hold the transcript.
              </li>
            </ol>
          )}
        </>
      )}

      {armError && (
        <p className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {armError}
        </p>
      )}

      {!armed && canAutoImport && (
        <Button size="lg" className="w-full" onClick={onArm} disabled={arming}>
          {arming ? "Setting it up..." : "I have started it - collect it for me"}
        </Button>
      )}

      {!canAutoImport && (
        <p className="text-sm text-muted-foreground">
          This call is not in your calendar, so there is nothing here to collect afterwards. Teams still keeps the
          transcript if you start one.
        </p>
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
