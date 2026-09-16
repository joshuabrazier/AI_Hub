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
//   unusable      the file is fine and contains no speech to transcribe -
//                 a video track with no audio, an encrypted recording, an
//                 empty container. Re-encoding a video with no sound
//                 produces silence, so this must NOT be offered one.
//   unreachable   Azure could not fetch the BLOB. Nothing about the file is
//                 wrong; this is a storage role assignment, and no amount
//                 of retrying from a browser fixes it.
//   service-credentials
//                 the Speech SERVICE refused us - a rotated key, a deleted
//                 resource. Also unfixable from a browser, and a different
//                 blade of the portal from the one above: telling somebody
//                 to check a storage role when the key has expired sends
//                 the one person who could fix it to the wrong place.
//   too-large     over the service's ceiling, by size or by length.
//                 Terminal, and for size the media has already been removed.
//   other         unclassified. Retried as-is, because a transient fault is
//                 the most likely thing behind a message nothing here
//                 recognises.
//
// MATCHED ON TEXT, AND IT IS WORTH BEING HONEST ABOUT WHY THAT IS SECOND
// BEST. This runs against the message STORED on the row, which is all a
// list view or a page render has - the structured code was available at the
// moment of failure and is written into that message rather than kept
// beside it.
//
// The `errorKind` values are NOT a documented enum. The report they come
// from is a blob artifact rather than a REST response type, so it appears
// in no published schema and Azure's own example shows none of its values.
// The `DetailedErrorCode` values below ARE documented, and are matched
// first for that reason - a code is a contract in a way that English is
// not. The fallback is `other`, which retries as-is, so a message that
// changes shape degrades to the old behaviour rather than to a wrong one.
// -------------------------------------------------------------------

export const TRANSCRIPTION_FAILURE_KINDS = {
  UNDECODABLE: "undecodable",
  UNUSABLE: "unusable",
  UNREACHABLE: "unreachable",
  SERVICE_CREDENTIALS: "service-credentials",
  TOO_LARGE: "too-large",
  OTHER: "other",
} as const;

export type TranscriptionFailureKind =
  (typeof TRANSCRIPTION_FAILURE_KINDS)[keyof typeof TRANSCRIPTION_FAILURE_KINDS];

// -----------------------------------------------------------------
// ORDER MATTERS, and it is most specific first.
//
// `InvalidUri` and `InvalidData` both contain "invalid"; a file that is too
// large is refused with wording of its own; and a recording this app has
// already read and found to contain no audio must be recognised before
// anything about it can be mistaken for a decoding problem.
// -----------------------------------------------------------------
const SIGNATURES: { kind: TranscriptionFailureKind; phrases: string[] }[] = [
  {
    // Ours, written before the media is deleted, plus Azure's own documented
    // length ceiling - which is 240 minutes whenever diarization is on, and
    // this app always turns it on.
    kind: TRANSCRIPTION_FAILURE_KINDS.TOO_LARGE,
    // "minutes in one file" and "minutes long" are the words THIS APP
    // writes when it refuses an over-length recording. They were missing,
    // so its own refusal classified as OTHER and the screen offered two
    // buttons for a dead end. The test below pins the literal message.
    phrases: [
      "larger than the",
      "too large",
      "audiolengthlimitexceeded",
      "longer than the",
      "minutes in one file",
      "minutes long",
    ],
  },
  {
    // The file is intact and there is nothing in it to transcribe.
    // Converting one of these produces a smaller file with the same
    // absence, so the screen must not offer to.
    kind: TRANSCRIPTION_FAILURE_KINDS.UNUSABLE,
    phrases: [
      "no audio track",
      "video and no audio",
      "no speech in it to transcribe",
      "encrypted",
      "emptyaudiofile",
      "no audio in it at all",
    ],
  },
  {
    // -----------------------------------------------------------------
    // THE SERVICE ITSELF REFUSED US, which is a different fault from the
    // service being unable to reach the storage account - and the advice
    // differs completely. One is a Speech key that has been rotated or a
    // resource that has been deleted; the other is a missing Storage Blob
    // Data Reader role. Telling somebody to check a storage role when the
    // key has expired sends the one person who could fix it to the wrong
    // blade of the portal.
    //
    // Tested BEFORE the storage case, because both mention access.
    // -----------------------------------------------------------------
    kind: TRANSCRIPTION_FAILURE_KINDS.SERVICE_CREDENTIALS,
    phrases: ["credentials problem", "speech api 401", "speech api 403", "invalid subscription key"],
  },
  {
    // The blob could not be fetched. On a real deployment this is the
    // Speech resource missing Storage Blob Data Reader, a firewall rule, or
    // public network access turned off - contentUrl carries no SAS, so that
    // role is the only thing making the blob readable.
    kind: TRANSCRIPTION_FAILURE_KINDS.UNREACHABLE,
    phrases: [
      "invalidrecordingsuri",
      "invaliduri",
      "could not be downloaded",
      "failed to download",
      "uri is invalid",
      "does not exist",
      "unauthorized",
      "forbidden",
      "storage blob data reader",
    ],
  },
  {
    // Downloaded, and not readable as audio. This is the one worth acting
    // on, and the one that was being shown to people as a dead end.
    kind: TRANSCRIPTION_FAILURE_KINDS.UNDECODABLE,
    phrases: [
      "invalidaudioformat",
      "badchannelconfiguration",
      "invalidchannel",
      "invaliddata",
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
 * Azure's own per-file report, this app's reading of the bytes, or several
 * of those joined into a paragraph.
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
 * nothing about why it could not be fetched; re-encoding an oversized one
 * is pointless because the media has already been deleted; and re-encoding
 * a video with no sound in it produces a smaller file with no sound in it.
 * Offering any of those is a button that spends somebody's battery to fail
 * identically.
 */
export function canRetryByReencoding(kind: TranscriptionFailureKind): boolean {
  return kind === TRANSCRIPTION_FAILURE_KINDS.UNDECODABLE;
}
