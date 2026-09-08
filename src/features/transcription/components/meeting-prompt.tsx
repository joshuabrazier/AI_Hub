"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ROUTES } from "@/lib/routes";

import { cancelTeamsAutoImportAction, getMeetingNowAction } from "../transcription.actions";
import type { MeetingNowDTO } from "../meeting-now.service";
import { MeetingPromptPanel } from "./meeting-prompt-panel";

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

// -------------------------------------------------------------------
// A LEASE, so several open tabs do not each poll.
//
// This used to skip whenever the tab was hidden, which was the wrong rule
// once a push notification was the point: during a meeting the browser is
// BEHIND Teams, so the tab is always hidden at exactly the moment the
// notification matters. Skipping then meant the meeting was never detected
// and the notification never sent.
//
// So it polls regardless of visibility, and the tab-count problem is solved
// properly instead: whichever tab gets there first writes a timestamp, and
// the others stand down until it lapses. Two tabs can still race into one
// extra call, which is a far better failure than not noticing a meeting.
//
// localStorage rather than a BroadcastChannel because it survives a tab being
// closed mid-interval - a channel would need a live leader to hand over.
// Wrapped in try/catch because a browser with site data blocked throws on
// access, and there the right answer is to poll rather than to go silent.
// -------------------------------------------------------------------
const POLL_LEASE_KEY = "meeting-prompt:last-poll";

function claimPollLease(): boolean {
  try {
    const previous = Number(window.localStorage.getItem(POLL_LEASE_KEY) ?? 0);

    // A small slack, so a tab whose timer fires a few milliseconds early does
    // not hand the whole interval to another one.
    if (Number.isFinite(previous) && Date.now() - previous < POLL_MS - 2_000) return false;

    window.localStorage.setItem(POLL_LEASE_KEY, String(Date.now()));
    return true;
  } catch {
    return true;
  }
}

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

export function supportsFloatingWindow(): boolean {
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
export function copyStyles(target: Window): void {
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

export function useMeetingNow(): MeetingNowDTO | null {
  const [state, setState] = useState<MeetingNowDTO | null>(null);

  // Once Graph says the scope is missing, nothing will change until the
  // person signs in again - so stop asking rather than paying two calls a
  // minute forever for an answer that cannot move.
  const stopped = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const poll = async (options: { force?: boolean } = {}) => {
      if (cancelled || stopped.current) return;

      // Deliberately NOT gated on visibility - see the note on the lease.
      // A forced poll skips the lease, because somebody returning to the tab
      // wants the current answer rather than the one another tab happens to
      // have leased.
      if (!options.force && !claimPollLease()) return;

      const result = await getMeetingNowAction();

      if (cancelled) return;

      if (!result.success) return;

      if (result.data.unavailable === "forbidden") stopped.current = true;

      setState(result.data);
    };

    void poll({ force: true });
    const timer = window.setInterval(() => void poll(), POLL_MS);

    // Ask again as soon as somebody comes back to the tab, rather than
    // showing them whatever the last poll found some time ago.
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll({ force: true });
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

export function MeetingPrompt() {
  const data = useMeetingNow();

  // Meetings somebody has said they do not want kept. Local, so the panel
  // reflects the choice immediately; the server is what actually stops the
  // collection, and a cancelled row is never re-armed by a later poll.
  const [cancelledKeys, setCancelledKeys] = useState<Set<string>>(new Set());

  // Dismissals last for the SESSION and are keyed on the meeting, so saying
  // no to one meeting does not silence the next, and a page navigation does
  // not bring back a prompt somebody has already refused.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const key = data?.meeting?.eventId ?? (data?.prompt ? "unknown-call" : null);

  // -----------------------------------------------------------------
  // POP OUT INTO A REAL WINDOW, not a Picture-in-Picture one.
  //
  // A PiP window floats above everything but is tied to THIS document and
  // dies the moment this tab closes - which is exactly when somebody wants it
  // most, having shut the app to get on with the meeting. A window.open
  // window is an independent browsing context and outlives its opener.
  //
  // That window can open a PiP of its own once it is up, so the on-top half
  // is not lost either; see the note in meeting-prompt-window.tsx. Named, so
  // pressing this twice focuses the window that already exists rather than
  // opening a second one.
  // -----------------------------------------------------------------
  const popOut = useCallback(() => {
    // Blocked by a popup blocker returns null, and there is nothing to report
    // when it does: the in-page panel is still here and still says everything
    // the window would.
    window.open(ROUTES.MEETING_PROMPT, "meeting-prompt", "popup,width=460,height=680")?.focus();
  }, []);

  if (!data?.prompt || key === null || dismissed.has(key)) return null;

  const dismiss = () => setDismissed((current) => new Set(current).add(key));

  const cancelCollection = async () => {
    if (!data.meeting) return;

    const eventId = data.meeting.eventId;

    // Optimistic, in the safe direction: if the call fails the collection
    // still happens, and an unwanted transcript can be deleted where a missed
    // one cannot be recovered.
    setCancelledKeys((current) => new Set(current).add(eventId));

    await cancelTeamsAutoImportAction({ eventId });
  };

  // -----------------------------------------------------------------
  // BOTTOM CENTRE AND WIDE, not a corner card.
  //
  // The corner version was missed through a whole meeting, and a meeting is
  // not recoverable afterwards - so this sits where the eye goes, takes real
  // width, and floats above the app chrome.
  //
  // role="alert" rather than "status": this is time-critical and interrupts
  // deliberately. A screen reader should announce it rather than wait to be
  // asked, for the same reason it is loud visually.
  // -----------------------------------------------------------------
  return (
    <div
      className="fixed inset-x-0 bottom-6 z-[100] mx-auto w-[30rem] max-w-[calc(100vw-2rem)] px-2"
      role="alert"
      aria-live="assertive"
    >
      <MeetingPromptPanel
        data={data}
        collecting={
          data.autoImportArmed && data.meeting !== null && !cancelledKeys.has(data.meeting.eventId)
        }
        onCancelCollection={() => void cancelCollection()}
        onDismiss={dismiss}
        onPopOut={popOut}
        canPopOut
        floating={false}
      />
    </div>
  );
}
