// -------------------------------------------------------------------
// ===================================================================
// WHEN A TAB HAS OUTLIVED THE BUILD THAT SERVED IT
// ===================================================================
//
// Next.js identifies a server action by a hash of the build it came from.
// Deploy while somebody has a page open and their tab keeps posting the OLD
// hash, which the new server has never heard of - it answers "Failed to find
// Server Action" and rejects the request before any application code runs.
// Lazily-loaded chunks go the same way: the filenames changed, so the old
// ones 404 and a panel simply never appears.
//
// handle-errors.ts already catches the first of those and offers a Reload
// toast. That is REACTIVE: it fires when somebody clicks something and the
// click fails, so the first thing they do after every deploy is dead, and
// they find out by pressing a button that appears to do nothing. This is the
// other half - noticing before they touch anything.
//
// -------------------------------------------------------------------
// THE DECISION IS A PURE FUNCTION BECAUSE THE FAILURE MODE IS A RELOAD LOOP.
//
// Anything that reloads the page on a condition it re-evaluates after
// reloading can reload for ever, and a loop in production is far worse than
// the staleness it was meant to fix - the app becomes unusable and the only
// way out is closing the tab. So the rule is written here, on its own, with
// no timers or `window` in sight, and tested directly.
//
// Three guards against it, and each is load-bearing:
//
//   1. COMPARE AGAINST WHAT THIS TAB STARTED WITH, not against a stored
//      "latest". A reload makes the tab adopt the new build, so the
//      comparison is then equal and the reason to reload is gone.
//   2. RELOAD ONCE PER BUILD. If the tab reloads for build X and still does
//      not consider itself on X, something is wrong in a way more reloading
//      cannot fix - so it stops and leaves the reactive toast to catch it.
//   3. AN UNKNOWN BUILD IS NEVER A REASON. A failed poll, a dev server with
//      no BUILD_ID, or a blank answer all mean "no information", and no
//      information must never be grounds for throwing a page away.
// -------------------------------------------------------------------

export type DeploymentState = {
  /** The build this tab was served by. Null until the first poll answers. */
  seenBuildId: string | null;
  /** The build the server is on now. Null when the poll failed or is unknown. */
  currentBuildId: string | null;
  /** The build this tab has already reloaded for, from sessionStorage. */
  reloadedForBuildId: string | null;
  /** False when the tab is in the background - nobody is looking at it. */
  isVisible: boolean;
  /**
   * True when something would be lost by reloading: text typed into an input
   * or a textarea, or a request in flight.
   */
  hasUnsavedWork: boolean;
};

export type DeploymentDecision =
  | { action: "wait" }
  | { action: "adopt"; buildId: string }
  | { action: "reload"; buildId: string };

export function decideDeploymentAction(state: DeploymentState): DeploymentDecision {
  const { currentBuildId, seenBuildId } = state;

  // Guard 3. No information is not a reason to do anything, and there are
  // TWO ways to have none. `null` is a poll that failed; UNKNOWN_BUILD_ID is
  // a server that answered and could not say - `next dev`, which has no
  // BUILD_ID at all, or a deployment that cannot read its own.
  //
  // Both were described as equivalent in the note above and only the first
  // was implemented. The gap is not theoretical: a production tab that got
  // one "unknown" answer would have seen it as a build change and thrown the
  // page away, and a deployment whose BUILD_ID became unreadable would have
  // done it to everybody at once.
  if (!currentBuildId || currentBuildId === UNKNOWN_BUILD_ID) return { action: "wait" };

  // The first answer only establishes what this tab is running. It is never
  // a reason to reload: the tab was served by this build moments ago.
  if (!seenBuildId) return { action: "adopt", buildId: currentBuildId };

  // Guard 1. Same build, nothing to do. This is the overwhelmingly common
  // case and the one that has to be cheap.
  if (currentBuildId === seenBuildId) return { action: "wait" };

  // Guard 2. Already tried for this build and still here. More reloading
  // will not help, and the Reload toast in handle-errors.ts still covers the
  // click that eventually fails.
  if (state.reloadedForBuildId === currentBuildId) return { action: "wait" };

  // -----------------------------------------------------------------
  // A NEW BUILD IS OUT. Reloading is now a question of WHEN, not whether.
  //
  // A HIDDEN TAB RELOADS AT ONCE, and this is the case worth having: it is
  // where most stale tabs are, nobody is looking, and there is nothing on
  // screen to interrupt. The tab is already fresh by the time it is looked
  // at again.
  // -----------------------------------------------------------------
  if (!state.isVisible) return { action: "reload", buildId: currentBuildId };

  // -----------------------------------------------------------------
  // AND IT WAITS FOR SOMEBODY MID-SENTENCE.
  //
  // This is not a softening of "reload automatically" - it is what makes an
  // automatic reload safe enough to do at all. Throwing away a half-written
  // chat message to save somebody a click is a worse bug than the one being
  // fixed, and it would be this app doing it to them rather than a deploy.
  //
  // The wait is short by nature: the state is re-evaluated on every poll and
  // whenever the tab is hidden or focused, so it reloads the moment the box
  // is cleared, sent, or the tab is put in the background.
  // -----------------------------------------------------------------
  if (state.hasUnsavedWork) return { action: "wait" };

  return { action: "reload", buildId: currentBuildId };
}

/** Where a tab remembers what it has already reloaded for. Per tab, by design. */
export const RELOADED_FOR_KEY = "deployment-watch:reloaded-for";

/** How often to ask. Cheap - a route handler reading one cached string. */
export const DEPLOYMENT_POLL_MS = 60_000;

/** The build id a server that cannot determine one reports. Never a reason to reload. */
export const UNKNOWN_BUILD_ID = "unknown";
