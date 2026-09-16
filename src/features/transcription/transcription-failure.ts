// -------------------------------------------------------------------
// ===================================================================
// WHY DID IT FAIL, AND IS THERE ANYTHING LEFT TO TRY?
// ===================================================================
//
// A failed transcription used to end at one sentence and a "Try again"
// button that did the identical thing again. For the commonest failure that
// button could never work: Azure had downloaded the file and been unable to
// decode it, so handing it the same bytes a second time produces the same
// refusal, slower.
//
// The kinds below are separated because each has a DIFFERENT next move, and
// collapsing them is what made every failure read as "transcription is
// broken again":
//
//   undecodable   the bytes reached Azure and it could not read them. The
//                 file has to CHANGE - re-encoding is the only thing that
//                 can help, and the app can do that itself.
//   unreachable   Azure could not fetch the blob at all. Nothing about the
//                 file is wrong; this is storage configuration, and no
//                 amount of retrying from a browser fixes it.
//   too-large     over the service's ceiling. Terminal, and the media has
//                 already been removed.
//   other         unclassified. Retried as-is, because a transient fault is
//                 the most likely thing behind a message nothing here
//                 recognises.
//
// MATCHED ON TEXT, WHICH IS WORTH BEING HONEST ABOUT. Azure's batch API
// reports `InvalidData` for several distinct faults and the distinguishing
// detail is in the prose, so there is no code to switch on. The strings are
// Azure's own documented error kinds and the messages seen in production,
// and the fallback is `other` - the kind that retries as-is - so a message
// that changes shape degrades to the old behaviour rather than to a wrong
// one.
// -------------------------------------------------------------------

export const TRANSCRIPTION_FAILURE_KINDS = {
  UNDECODABLE: "undecodable",
  UNREACHABLE: "unreachable",
  TOO_LARGE: "too-large",
  OTHER: "other",
} as const;

export type TranscriptionFailureKind =
  (typeof TRANSCRIPTION_FAILURE_KINDS)[keyof typeof TRANSCRIPTION_FAILURE_KINDS];

// -----------------------------------------------------------------
// ORDER MATTERS. `InvalidUri` and `InvalidData` both contain "invalid",
// and a file that is too large is refused with wording of its own - so the
// most specific phrases are tested first and the general ones last.
// -----------------------------------------------------------------
const SIGNATURES: { kind: TranscriptionFailureKind; phrases: string[] }[] = [
  {
    // Ours, written by startTranscriptionService before the media is
    // deleted. Nothing can follow it, so it must not be mistaken for a
    // decode failure by the word "invalid" appearing nowhere near it.
    kind: TRANSCRIPTION_FAILURE_KINDS.TOO_LARGE,
    phrases: ["larger than the", "too large"],
  },
  {
    // The blob could not be fetched. On a real deployment this is the
    // Speech resource missing Storage Blob Data Reader, a firewall rule, or
    // public network access turned off - contentUrl carries no SAS, so that
    // role is the only thing making the blob readable.
    kind: TRANSCRIPTION_FAILURE_KINDS.UNREACHABLE,
    phrases: [
      "invaliduri",
      "could not be downloaded",
      "failed to download",
      "uri is invalid",
      "does not exist",
      "unauthorized",
      "forbidden",
    ],
  },
  {
    // Downloaded, and not readable as audio. This is the one worth acting
    // on, and the one that was being shown to people as a dead end.
    kind: TRANSCRIPTION_FAILURE_KINDS.UNDECODABLE,
    phrases: [
      "invaliddata",
      "invalidaudioformat",
      "audio format is invalid",
      "cannot be detected",
      "contains invalid data",
      "unsupported audio format",
      "could not be decoded",
      "no audio",
    ],
  },
];

/**
 * What kind of failure this message describes.
 *
 * Takes the stored `error` text, which may be Azure's job-level message,
 * Azure's own per-file report, or one this app wrote itself.
 */
export function classifyTranscriptionFailure(error: string | null): TranscriptionFailureKind {
  if (!error) return TRANSCRIPTION_FAILURE_KINDS.OTHER;

  const text = error.toLowerCase();

  for (const signature of SIGNATURES) {
    if (signature.phrases.some((phrase) => text.includes(phrase))) return signature.kind;
  }

  return TRANSCRIPTION_FAILURE_KINDS.OTHER;
}

/**
 * Whether re-encoding the media and trying again could plausibly help.
 *
 * Only for a decode failure. Re-encoding an unreachable blob changes
 * nothing about why it could not be fetched, and re-encoding an oversized
 * one is pointless because the media has already been deleted - offering
 * either would be a button that spends somebody's battery to fail
 * identically.
 */
export function canRetryByReencoding(kind: TranscriptionFailureKind): boolean {
  return kind === TRANSCRIPTION_FAILURE_KINDS.UNDECODABLE;
}
