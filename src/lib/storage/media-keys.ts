// -------------------------------------------------------------------
// Where a recording lives in the container, as pure string work.
//
// SEPARATE FROM media-storage.ts because both a server service and a
// browser-bound mapper need to reason about these keys, and media-storage
// imports the Azure SDK at module scope - so importing it from anything a
// client component can reach would pull the whole SDK into that bundle.
// Nothing here touches storage, an environment variable or a network.
//
// It is also the reason the rules below can be tested at all: the attempt
// suffix decides whether a re-encode overwrites the only copy of a meeting,
// and that is not a thing to find out against a live container.
// -------------------------------------------------------------------

/** One recording, addressed by who it belongs to and which row claims it. */
export function mediaStorageKey(userId: string, transcriptionId: string): string {
  return `transcription/${userId}/${transcriptionId}`;
}

// -------------------------------------------------------------------
// A key ending in an attempt marker: `-r1`, `-r2`, and so on.
//
// Exported rather than inlined at the two places that ask, because the
// question "has this already been re-encoded?" is asked once by the server
// when it picks a destination and once by the screen when it decides
// whether converting again could possibly help. Those two answering
// differently is how a page ends up re-converting an hour-long meeting on
// every visit.
// -------------------------------------------------------------------
const ATTEMPT_SUFFIX = /-r(\d+)$/;

export function isReplacementMediaKey(key: string | null): boolean {
  return key !== null && ATTEMPT_SUFFIX.test(key);
}

// -------------------------------------------------------------------
// Where a RE-ENCODED recording goes.
//
// A NEW KEY RATHER THAN AN OVERWRITE, and the reason is what happens when
// the replacement does not finish. Writing over the original would leave a
// row pointing at a blob of a different type from the one it records, or -
// worse - at nothing, if the commit failed part way through. A separate key
// means the original stays claimed and intact until the row is switched
// over in one update, and an abandoned replacement is simply an unclaimed
// blob, which the retention job's reconciliation pass already removes.
//
// DERIVED FROM THE CURRENT KEY rather than stored, so the server computes
// it identically when it signs the upload URL and again when it accepts the
// result - the browser never names a destination.
//
// Still under the same `transcription/<user>/` prefix, because that prefix
// is what per-user cleanup and the orphan listing walk.
// -------------------------------------------------------------------
export function nextMediaStorageKey(currentKey: string): string {
  const attempt = ATTEMPT_SUFFIX.exec(currentKey);

  return attempt
    ? `${currentKey.slice(0, -attempt[0].length)}-r${Number(attempt[1]) + 1}`
    : `${currentKey}-r1`;
}
