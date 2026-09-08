"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AudioLines, ExternalLink, PictureInPicture2, X } from "lucide-react";

import { Button } from "@/components/ui/button";

import { getMeetingNowAction } from "../transcription.actions";
import type { MeetingNowDTO } from "../meeting-now.service";

// -------------------------------------------------------------------
// "You are in a meeting - want it transcribed?"
//
// WHAT THIS DOES NOT DO IS THE IMPORTANT PART. It does not record, and it
// cannot start transcription for you. Both are deliberate, and neither is a
// gap to be closed later.
//
// RECORDING A TEAMS MEETING FROM A BROWSER IS THE WRONG SHAPE. getUserMedia
// captures the microphone, so on headphones - which is most meetings - it
// would capture your half of the conversation and nothing else. Capturing
// the other side needs system-audio screen capture, which is Windows Chrome
// only and needs a window picked by hand every time.
//
// AND THE LEGAL POINT CUTS THE SAME WAY. Recording a private conversation
// without the consent of everyone in it is an offence in South Australia
// (Surveillance Devices Act 2016), and participants elsewhere bring their
// own rules. This app cannot inject audio into a Teams call, so an
// app-side announcement could only ever be this app telling YOU to say
// something - while nobody else in the meeting sees any indication at all.
// That is the covert-recording shape the legislation is about.
//
// Teams, started from inside the meeting, shows every participant
// "Recording and transcription have started". That is a far stronger
// position than our prompt reminding one person to speak up, it attributes
// each turn to a signed-in identity, and the import already exists to
// collect the result. So this prompt's whole job is to get somebody to press
// Microsoft's button at the moment it is useful, and to say why.
//
// GRAPH HAS NO API TO START TRANSCRIPTION on somebody's behalf. The only way
// to make it automatic is a tenant-wide Teams meeting policy, which is an
// admin setting rather than code.
// -------------------------------------------------------------------

// How often to ask. Two Graph calls per poll per person, against a
// per-application-per-tenant throttle shared with the SharePoint crawl and
// the meeting import - so this is minutes, not seconds. A meeting lasts long
// enough that a prompt arriving a minute in is still early.
const POLL_MS = 90_000;

// Document Picture-in-Picture is not in lib.dom yet. Narrow declaration
// rather than `any`, so a typo in the call is still caught.
declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
      window: Window | null;
    };
  }
}

function supportsFloatingWindow(): boolean {
  return typeof window !== "undefined" && "documentPictureInPicture" in window;
}

// -------------------------------------------------------------------
// A Picture-in-Picture document starts EMPTY - it inherits no stylesheets
// from the page that opened it. Without this the panel renders as unstyled
// black-on-white text, which looks broken rather than minimal.
//
// Both shapes are copied because Next serves them differently: real <link>
// stylesheets in production, inline <style> elements in development.
// -------------------------------------------------------------------
function copyStyles(target: Window): void {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("");
      const style = target.document.createElement("style");
      style.textContent = rules;
      target.document.head.appendChild(style);
    } catch {
      // A cross-origin stylesheet throws on cssRules. Link to it instead,
      // which is what it was anyway.
      const link = target.document.createElement("link");
      link.rel = "stylesheet";
      link.href = (sheet as CSSStyleSheet).href ?? "";
      if (link.href) target.document.head.appendChild(link);
    }
  }
}

function useMeetingNow(): MeetingNowDTO | null {
  const [state, setState] = useState<MeetingNowDTO | null>(null);

  // Once Graph says the scope is missing, nothing will change until the
  // person signs in again - so stop asking rather than paying two calls a
  // minute forever for an answer that cannot move.
  const stopped = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled || stopped.current) return;
      // Nothing to prompt about in a tab nobody is looking at, and a person
      // with several tabs open would otherwise multiply the Graph calls by
      // the number of tabs.
      if (document.visibilityState !== "visible") return;

      const result = await getMeetingNowAction();

      if (cancelled) return;

      if (!result.success) return;

      if (result.data.unavailable === "forbidden") stopped.current = true;

      setState(result.data);
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);

    // Ask again as soon as somebody comes back to the tab, rather than
    // making them wait out the remainder of an interval that was skipped.
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return state;
}

// -------------------------------------------------------------------
// The panel itself, rendered either in the page or inside the floating
// window. One component for both so the two cannot drift apart.
// -------------------------------------------------------------------
function PromptPanel({
  data,
  onDismiss,
  onPopOut,
  canPopOut,
  floating,
}: {
  data: MeetingNowDTO;
  onDismiss: () => void;
  onPopOut: () => void;
  canPopOut: boolean;
  floating: boolean;
}) {
  const subject = data.meeting?.subject ?? null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <AudioLines className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">
            {data.certain ? "You are in a meeting" : "A meeting looks like it is on"}
          </p>
        </div>

        <div className="flex items-center gap-1">
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

      {subject && <p className="text-sm text-muted-foreground">{subject}</p>}

      {data.ambiguous.length > 0 && (
        // Named rather than picked. Announcing a recording of the wrong
        // meeting to a room of people is worse than admitting we cannot tell
        // which of two overlapping entries this is.
        <p className="text-sm text-muted-foreground">
          Two meetings overlap right now - {data.ambiguous.map((entry) => entry.subject).join(" and ")} - so this
          cannot say which one you are in.
        </p>
      )}

      {/* ---------------------------------------------------------------
          THE INSTRUCTION, and why it is an instruction rather than a
          button. Nothing here can start transcription for you: Graph has
          no such API. And Teams starting it is the point, not a
          workaround - it is what tells everyone else in the meeting.
          --------------------------------------------------------------- */}
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
        <p className="font-medium">In Teams: More actions, then Record and transcribe, then Start transcription.</p>
        <p className="mt-1 text-muted-foreground">
          Teams announces it to everyone in the meeting, which is what makes it lawful to keep, and it labels each
          speaker by name. Nothing is recorded until you do this.
        </p>
      </div>

      {data.meeting ? (
        <p className="text-xs text-muted-foreground">
          When the meeting ends, import the transcript and this app will summarise it.
        </p>
      ) : (
        // No calendar entry behind it. Say so plainly: there will be nothing
        // to import afterwards, and finding that out later is worse.
        <p className="text-xs text-muted-foreground">
          This call is not in your calendar, so there will be nothing here to import afterwards. Teams still keeps the
          transcript if you start one.
        </p>
      )}

      <Button asChild variant="outline" size="sm" className="self-start">
        <Link href={data.transcriptionHref} target={floating ? "_blank" : undefined}>
          Open transcription
          <ExternalLink className="size-3.5" aria-hidden />
        </Link>
      </Button>
    </div>
  );
}

export function MeetingPrompt() {
  const data = useMeetingNow();
  const [pipWindow, setPipWindow] = useState<Window | null>(null);

  // The same window as the state, reachable from an effect without making
  // that effect depend on it.
  const pipRef = useRef<Window | null>(null);

  // Dismissals last for the SESSION and are keyed on the meeting, so saying
  // no to one meeting does not silence the next, and a page navigation does
  // not bring back a prompt somebody has already refused.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const key = data?.meeting?.eventId ?? (data?.prompt ? "unknown-call" : null);

  // ONE PATH OUT, and it is the window's own pagehide event. Closing the
  // window is the only thing this does; the listener installed in popOut is
  // what clears the state. Setting both here would mean two ways for the
  // panel and the window to disagree about whether it is open - and the
  // browser can close a Picture-in-Picture window on its own, so the
  // listener has to work unaided regardless.
  const closePip = useCallback(() => {
    pipRef.current?.close();
  }, []);

  const popOut = useCallback(async () => {
    if (!supportsFloatingWindow()) return;

    try {
      // Requires a user gesture, which is why this is a button and the
      // window cannot open itself.
      const win = await window.documentPictureInPicture!.requestWindow({ width: 380, height: 340 });

      copyStyles(win);
      win.document.body.style.margin = "0";
      win.addEventListener("pagehide", () => {
        pipRef.current = null;
        setPipWindow(null);
      });

      pipRef.current = win;
      setPipWindow(win);
    } catch {
      // Refused, unsupported, or no gesture. The in-page panel is still
      // there, so there is nothing to report.
    }
  }, []);

  // A floating window outliving the meeting it is about would be a panel
  // making a claim that is no longer true. Closing it is all this does - the
  // pagehide listener clears the state.
  useEffect(() => {
    if (!data?.prompt) closePip();
  }, [data?.prompt, closePip]);

  // And it must not outlive the page either.
  useEffect(() => () => pipRef.current?.close(), []);

  if (!data?.prompt || key === null || dismissed.has(key)) return null;

  const dismiss = () => {
    setDismissed((current) => new Set(current).add(key));
    closePip();
  };

  const panel = (
    <PromptPanel
      data={data}
      onDismiss={dismiss}
      onPopOut={popOut}
      canPopOut={supportsFloatingWindow()}
      floating={pipWindow !== null}
    />
  );

  if (pipWindow) return createPortal(<div className="p-2">{panel}</div>, pipWindow.document.body);

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[22rem] max-w-[calc(100vw-2rem)]" role="status" aria-live="polite">
      {panel}
    </div>
  );
}
