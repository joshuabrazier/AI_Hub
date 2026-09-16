"use client";

import { useEffect } from "react";

// ===================================================================
// "SOMETHING IS RUNNING - DO NOT THROW THIS TAB AWAY"
//
// The deployment watcher reloads a tab that has outlived its build, and the
// one thing it must never do is reload over work in progress. Half of that is
// text somebody has typed, which it can see in the DOM. The other half is
// invisible there:
//
//   - a chat reply streaming in. The turn has already been paid for, the
//     model is mid-answer, and a reload loses both.
//   - a recording. A meeting cannot be recorded twice, which is the whole
//     reason `recording-store.ts` exists.
//   - an upload. The bytes are going somewhere and the row is waiting.
//
// None of those is a form field, none of them blocks navigation, and a
// `fetch` in flight leaves no trace in the document. So the features that own
// them SAY SO, through this.
//
// -------------------------------------------------------------------
// A COUNTER RATHER THAN A BOOLEAN, because two things can be in flight at
// once - a reply streaming while a file uploads - and whichever finished
// first would otherwise clear the flag for both.
//
// -------------------------------------------------------------------
// WHY NOT `beforeunload`? Because it cannot be used for this. A reload the
// page starts itself would be blocked by a browser dialog nobody asked for,
// which turns an automatic refresh into an interruption - the exact thing
// this feature is meant to avoid. The watcher does not need to be STOPPED, it
// needs to be told to wait, and waiting costs one poll.
// ===================================================================

let inFlight = 0;

/** True while any feature has declared work the reload would destroy. */
export function isWorkInFlight(): boolean {
  return inFlight > 0;
}

/**
 * Declare work in flight for as long as `active` is true.
 *
 * The cleanup runs on unmount as well as on the flag going false, so a panel
 * that is closed mid-upload releases its claim rather than pinning the tab
 * open for the rest of the session.
 */
export function useWorkInFlight(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    inFlight += 1;

    return () => {
      inFlight -= 1;
    };
  }, [active]);
}
