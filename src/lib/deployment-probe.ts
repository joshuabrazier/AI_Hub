// ===================================================================
// A FAILED SERVER ACTION IS PROOF THE TAB IS STALE. USE IT.
//
// The deployment watcher asks `/api/version` once a minute and reloads a tab
// that has outlived its build. That is the general case. This is the specific
// one, and it is both faster and more certain: when Next answers "Failed to
// find Server Action", the tab has just been TOLD it is running against a
// build the server has never heard of. No polling required - the evidence
// arrived on its own.
//
// -------------------------------------------------------------------
// WHY IT WAS NEEDED ON TOP OF THE POLL.
//
// Production logs after a deploy showed one action id rejected every few
// seconds for seven minutes straight. It was the transcription workspace
// sweep, which runs on a six-second interval and swallows its own errors -
// deliberately, because a toast every six seconds during a network blip is
// worse than the blip. So the tab was told it was stale roughly seventy
// times and discarded the message every time, while nobody saw a toast,
// because nothing had been clicked.
//
// The version poll would eventually have caught that tab. "Eventually" is up
// to a minute of an error per six seconds in a log somebody has to read.
//
// -------------------------------------------------------------------
// IT PROBES RATHER THAN RELOADS, and that distinction is the whole design.
//
// Reloading straight from here would bypass both guards that make an
// automatic reload safe: the once-per-build loop guard, and the check for
// work that would be destroyed. So this only says "look again, now" - the
// same decision function runs, with the same rules, and may well answer
// "wait". A tab holding a half-written message keeps holding it.
// ===================================================================

/**
 * Does this error mean the tab predates the running build?
 *
 * Matched on the message because that is all Next gives us: the request is
 * rejected before any application code runs, so there is no code, no status
 * worth branching on, and nothing of ours in the response.
 */
export function isStaleDeploymentError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");

  return message.includes("Failed to find Server Action");
}

// The watcher's own check, once it has mounted. Null before that and in
// development, where the watcher never starts - and a probe with nothing
// registered is a no-op rather than an error, because callers are ordinary
// error paths that must not care whether this feature exists.
let probe: (() => void) | null = null;

/** Called by the deployment watcher. Not for general use. */
export function registerDeploymentProbe(check: () => void): () => void {
  probe = check;

  return () => {
    if (probe === check) probe = null;
  };
}

/** Ask the deployment watcher to check now, if one is running. */
export function probeForNewDeployment(): void {
  probe?.();
}

/**
 * Probe if this error is the stale-deployment one, and do nothing otherwise.
 *
 * Made for the catch blocks that deliberately swallow - a background poll, a
 * sweep on a timer. They should go on swallowing: retrying is useless and a
 * toast from something nobody started is noise. Losing the SIGNAL is the part
 * that was wrong.
 */
export function noteIfStaleDeployment(error: unknown): void {
  if (isStaleDeploymentError(error)) probeForNewDeployment();
}
