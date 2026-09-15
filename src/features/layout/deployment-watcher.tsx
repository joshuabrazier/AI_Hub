"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  DEPLOYMENT_POLL_MS,
  RELOADED_FOR_KEY,
  decideDeploymentAction,
} from "./deployment-watch";

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

/**
 * Would reloading throw away work somebody is in the middle of?
 *
 * Deliberately conservative: it asks whether anything has been TYPED, not
 * whether a field is focused. Somebody who wrote half a message, clicked
 * away to read something and came back would otherwise lose it - and losing
 * a paragraph to save a click is a worse bug than the one this fixes.
 *
 * It does not try to be clever about which inputs matter. A search box with
 * a word in it delays the reload by one poll, which costs nothing; getting
 * it wrong the other way costs somebody their writing.
 */
function hasUnsavedWork(): boolean {
  const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  );

  for (const field of fields) {
    // Buttons and checkboxes carry a `value` that has nothing to do with
    // anything somebody typed.
    if (field instanceof HTMLInputElement && !["text", "search", "email", "url", "tel", "number", "password"].includes(field.type)) {
      continue;
    }

    if (field.value.trim().length > 0) return true;
  }

  // Rich text and anything else editable - the chat composer and the site
  // content editors both use one.
  for (const editable of document.querySelectorAll<HTMLElement>("[contenteditable='true']")) {
    if ((editable.textContent ?? "").trim().length > 0) return true;
  }

  return false;
}

export function DeploymentWatcher() {
  // The build this tab was served by. A ref rather than state: nothing
  // renders from it, and a re-render on every poll would be pure waste.
  const seenBuildId = useRef<string | null>(null);

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
      isVisible: document.visibilityState === "visible",
      hasUnsavedWork: hasUnsavedWork(),
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

    void check();

    const timer = setInterval(() => void check(), DEPLOYMENT_POLL_MS);

    // -----------------------------------------------------------------
    // ALSO ON EVERY VISIBILITY CHANGE, in both directions, and both matter.
    //
    // Hidden: the moment nobody is looking is the best moment to reload, and
    // it is where most stale tabs are - left open on a second monitor for
    // days across several deploys.
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
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [check]);

  return null;
}
