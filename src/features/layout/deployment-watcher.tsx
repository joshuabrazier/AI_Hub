"use client";

import { useCallback, useEffect, useRef } from "react";

import { isStaleDeploymentError, registerDeploymentProbe } from "@/lib/deployment-probe";

import {
  DEPLOYMENT_POLL_MS,
  RELOADED_FOR_KEY,
  UNKNOWN_BUILD_ID,
  decideDeploymentAction,
} from "./deployment-watch";
import { isWorkInFlight } from "./work-in-flight";

// -------------------------------------------------------------------
// Reload a tab that has outlived the build it was served by.
//
// Renders nothing. The decision it acts on is `decideDeploymentAction`, which
// is pure and tested separately - everything here is the plumbing around it:
// when to ask, how to tell whether anything would be lost, and where to
// remember what has already been reloaded for.
//
// WHY IT IS WORTH HAVING AT ALL. Next.js hashes a server action id from the
// build it came from, so after a deploy every button on an open tab posts an
// id the new server has never heard of and is rejected before any of our code
// runs. handle-errors.ts catches that and offers a Reload toast, but only
// once somebody has already pressed something and had it do nothing. This
// notices first.
// -------------------------------------------------------------------

// ===================================================================
// WOULD RELOADING THROW AWAY WORK? TWO KINDS, AND NEITHER IS OBVIOUS.
//
// Getting this wrong in the permissive direction is the worst thing this
// feature can do: it would be the app destroying somebody's writing to save
// them a click, which is a bigger bug than the staleness being fixed. Getting
// it wrong in the cautious direction costs one poll.
// ===================================================================

/**
 * Has somebody typed since this page loaded?
 *
 * Set by a listener rather than inferred from the DOM, and the distinction is
 * the whole point. "Some input has a value in it" is not the same question:
 * half the forms in this app are SERVER-PREFILLED - `/welcome`, the account
 * page, the settings pages all render with the current values in the boxes -
 * so a value-only check is permanently true there and the tab would never
 * reload at all. The feature would look like it worked while quietly doing
 * nothing on exactly the pages people leave open.
 *
 * Trusted events only: a programmatic `value` assignment does not fire
 * `input` at all, but a synthetic event dispatched by some library could, and
 * a form that repopulates itself must not pin the tab open for ever.
 */
let hasTyped = false;

function noteTyping(event: Event) {
  if (event.isTrusted) hasTyped = true;
}

/**
 * Is there text on screen that would be lost?
 *
 * Paired with `hasTyped` rather than used alone, so a prefilled form is not
 * mistaken for a draft - and paired the other way too, so a search box that
 * was typed in and then cleared stops blocking. What has to be true is BOTH:
 * somebody typed, and something is still in a box.
 *
 * It does not try to be clever about which inputs matter. A search box with a
 * word in it delays the reload by one poll, which costs nothing.
 */
const TEXTUAL_INPUT_TYPES = ["text", "search", "email", "url", "tel", "number", "password"];

function hasTextInAField(): boolean {
  const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  );

  for (const field of fields) {
    // Buttons, checkboxes and hidden fields carry a `value` that has nothing
    // to do with anything somebody typed.
    if (field instanceof HTMLInputElement && !TEXTUAL_INPUT_TYPES.includes(field.type)) {
      continue;
    }

    if (field.value.trim().length > 0) return true;
  }

  // Rich text and anything else editable - the site content editors use one.
  for (const editable of document.querySelectorAll<HTMLElement>("[contenteditable='true']")) {
    if ((editable.textContent ?? "").trim().length > 0) return true;
  }

  return false;
}

function wouldLoseWork(): boolean {
  // The invisible half, and the expensive one: a streaming reply already paid
  // for, a recording that cannot be made twice, an upload mid-flight. None of
  // those is in the DOM, so the features that own them declare it.
  if (isWorkInFlight()) return true;

  // Anything that has said it is busy in the accessibility tree counts too.
  // It is the standard way to say "this region is mid-update", so honouring
  // it means a feature added later is covered without knowing this exists.
  if (document.querySelector('[aria-busy="true"]')) return true;

  return hasTyped && hasTextInAField();
}

export function DeploymentWatcher({ servedBy }: { servedBy: string }) {
  // -----------------------------------------------------------------
  // THE BUILD THAT RENDERED THIS DOCUMENT, handed down by the root layout.
  //
  // It used to be discovered: null at mount, then whatever the first poll
  // reported. That is wrong in the one window that matters. A tab that loads
  // WHILE a deployment is rolling gets its HTML from the old instance and its
  // first poll from the new one, adopts the new id as its own, and is then
  // exempt for as long as it stays open - holding old action hashes and old
  // chunk names while believing it is current. The server already knows the
  // answer, so it says so instead.
  //
  // A ref rather than state: nothing renders from it, and a re-render on
  // every poll would be pure waste.
  // -----------------------------------------------------------------
  const seenBuildId = useRef<string | null>(servedBy === UNKNOWN_BUILD_ID ? null : servedBy);

  const check = useCallback(async () => {
    let currentBuildId: string | null = null;

    try {
      // `no-store` on the request as well as the response: a browser or a
      // proxy caching this would make a tab believe it is current.
      const response = await fetch("/api/version", { cache: "no-store" });

      if (response.ok) {
        const body: unknown = await response.json();

        if (body && typeof body === "object" && "buildId" in body && typeof body.buildId === "string") {
          currentBuildId = body.buildId;
        }
      }
    } catch {
      // Offline, a deploy mid-flight, a transient blip. All of them mean "no
      // information", and the decision below treats that as no reason to act.
    }

    let reloadedForBuildId: string | null = null;

    try {
      reloadedForBuildId = window.sessionStorage.getItem(RELOADED_FOR_KEY);
    } catch {
      // Private browsing, or site data blocked. Losing the loop guard is
      // worse than losing the feature, so a tab that cannot remember what it
      // reloaded for does not reload at all.
      return;
    }

    const decision = decideDeploymentAction({
      seenBuildId: seenBuildId.current,
      currentBuildId,
      reloadedForBuildId,
      wouldLoseWork: wouldLoseWork(),
    });

    if (decision.action === "adopt") {
      seenBuildId.current = decision.buildId;
      return;
    }

    if (decision.action !== "reload") return;

    // Written BEFORE reloading, so a tab that comes back still disagreeing
    // about the build does not try again. See guard 2 in deployment-watch.
    try {
      window.sessionStorage.setItem(RELOADED_FOR_KEY, decision.buildId);
    } catch {
      return;
    }

    console.info(`[deployment-watch] build changed to ${decision.buildId}; reloading`);

    // `reload()` rather than assigning to href: it re-requests the document
    // rather than relying on whatever the cache holds for this URL.
    window.location.reload();
  }, []);

  useEffect(() => {
    // -----------------------------------------------------------------
    // PRODUCTION ONLY, and it does not merely no-op in development - it
    // never starts.
    //
    // The problem this solves does not exist in `next dev`: there is no
    // BUILD_ID, server actions are not hashed against a build that can be
    // replaced underneath a tab, and the dev server hot-reloads anyway. The
    // decision function would answer "wait" for ever there (an unknown build
    // is not a change), so nothing would happen - but a poll every minute in
    // every developer's tab is noise in the network panel and work nobody
    // asked for.
    //
    // `process.env.NODE_ENV` is inlined at build time, so this whole effect
    // is compiled out of a development bundle rather than being branched on
    // at runtime. `pnpm build && pnpm start` locally IS production and does
    // have a BUILD_ID, which is correct: that is a production build and the
    // watcher should behave exactly as it will when deployed.
    // -----------------------------------------------------------------
    if (process.env.NODE_ENV !== "production") return;

    // Capture, so it is seen even where a handler below stops propagation.
    // React's own onChange is built on this event, so anything typed into a
    // controlled input is covered without the feature knowing about it.
    document.addEventListener("input", noteTyping, true);

    // -----------------------------------------------------------------
    // THE POLL IS THE FLOOR, NOT THE ONLY WAY IN.
    //
    // A rejected server action is the tab being told outright that it is
    // stale, which is better evidence than anything a poll can produce and
    // arrives without being asked for. Both routes below feed the SAME check,
    // so the loop guard and the unsaved-work guard apply either way - this
    // only changes when the question gets asked, never the answer.
    // -----------------------------------------------------------------
    const releaseProbe = registerDeploymentProbe(() => void check());

    // The safety net for paths nobody routed anywhere. A server action that
    // fails in a `void somePromise()` with no catch surfaces here and nowhere
    // else, and those are exactly the background polls that would otherwise
    // keep posting a dead action id until the tab is closed.
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isStaleDeploymentError(event.reason)) void check();
    };

    window.addEventListener("unhandledrejection", onRejection);

    void check();

    const timer = setInterval(() => void check(), DEPLOYMENT_POLL_MS);

    // -----------------------------------------------------------------
    // ALSO ON EVERY VISIBILITY CHANGE, in both directions, and both matter.
    //
    // Hidden: a tab nobody is looking at is the easiest one to replace, and
    // it is where most stale tabs are - left open on a second monitor for
    // days across several deploys. It is NOT a licence to skip the checks
    // above; see the note in deployment-watch.ts about what a hidden tab can
    // still be holding.
    //
    // Visible: somebody coming back to a tab is about to use it, so this is
    // the last chance to be current before they press something. A poll on
    // an interval alone could leave them up to a minute of staleness at
    // exactly the wrong moment.
    // -----------------------------------------------------------------
    const onVisibility = () => void check();

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(timer);
      releaseProbe();
      window.removeEventListener("unhandledrejection", onRejection);
      document.removeEventListener("input", noteTyping, true);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [check]);

  return null;
}
