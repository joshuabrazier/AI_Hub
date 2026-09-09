"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cancelTeamsAutoImportAction } from "../transcription.actions";
import { MeetingPromptPanel } from "./meeting-prompt-panel";
import { copyStyles, supportsFloatingWindow, useMeetingNow } from "./meeting-prompt";

// -------------------------------------------------------------------
// The prompt, running in its own browser window.
//
// WHY A WINDOW AND NOT JUST PICTURE-IN-PICTURE, and the two are a genuine
// trade rather than a preference:
//
//   A Picture-in-Picture window FLOATS ABOVE EVERYTHING, which is what you
//   want during a meeting - but it is tied to the document that opened it and
//   dies the moment that tab closes.
//
//   A window.open window SURVIVES its opener closing, which is what you want
//   when you shut the app and carry on with the meeting - but no browser will
//   let a web page sit above other applications, so it can be covered by
//   Teams.
//
// So this window is the durable half, and it can open a Picture-in-Picture of
// its own for the on-top half. Closing the app leaves both alive, because
// this window is now the opener. Neither piece can do the job alone and
// nothing in a browser can.
//
// It polls on its own. That is the point: once the app is closed there is
// nothing else left running to tell it the meeting has ended.
// -------------------------------------------------------------------
export function MeetingPromptWindow() {
  const data = useMeetingNow();

  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const pipRef = useRef<Window | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const popOut = useCallback(async () => {
    if (!supportsFloatingWindow()) return;

    try {
      const win = await window.documentPictureInPicture!.requestWindow({ width: 440, height: 560 });

      copyStyles(win);
      win.document.body.style.margin = "0";
      win.addEventListener("pagehide", () => {
        pipRef.current = null;
        setPipWindow(null);
      });

      pipRef.current = win;
      setPipWindow(win);
    } catch {
      // Refused or unsupported. This window is still here, which is the
      // durable half and the more important one.
    }
  }, []);

  useEffect(() => () => pipRef.current?.close(), []);

  const cancelCollection = async () => {
    if (!data?.meeting) return;

    const eventId = data.meeting.eventId;

    // Optimistic, in the safe direction: if the call fails the collection
    // still happens, and an unwanted transcript can be deleted where a missed
    // one cannot be recovered.
    setCancelled(true);

    await cancelTeamsAutoImportAction({ eventId });
  };

  // DISMISS CLOSES THE WINDOW. In the app the panel just hides; here the
  // window IS the panel, so leaving an empty one on somebody's screen would
  // be litter.
  const dismiss = () => {
    pipRef.current?.close();
    window.close();
  };

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">
        Checking your meetings...
      </div>
    );
  }

  if (!data.prompt) {
    // The meeting ended, or presence says no call is up. Said plainly rather
    // than closing the window from under somebody: a window that vanishes on
    // its own is indistinguishable from one that crashed.
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium">No meeting in progress.</p>
        <p className="text-sm text-muted-foreground">
          Anything armed will still be collected and summarised on its own. You can close this window.
        </p>
      </div>
    );
  }

  const panel = (
    <MeetingPromptPanel
      data={data}
      collecting={data.autoImportArmed && data.meeting !== null && !cancelled}
      onCancelCollection={() => void cancelCollection()}
      onDismiss={dismiss}
      onPopOut={() => void popOut()}
      canPopOut={supportsFloatingWindow() && pipWindow === null}
      floating={false}
    />
  );

  if (pipWindow) {
    return (
      <>
        <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Showing in a floating window.
        </div>
        {createPortal(<div className="p-3">{panel}</div>, pipWindow.document.body)}
      </>
    );
  }

  return <div className="min-h-screen p-3">{panel}</div>;
}
