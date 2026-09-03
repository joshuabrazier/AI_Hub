// -------------------------------------------------------------------
// Which transcript belongs to the meeting somebody actually clicked.
//
// THIS IS NOT THE QUESTION IT LOOKS LIKE, and the difference cost a real
// import. Every occurrence of a recurring Teams meeting shares ONE join
// URL, so resolving that URL gives the SERIES, and the transcripts hanging
// off it belong to any occurrence of it - not to the one on screen.
//
// The failure that followed was the quiet kind. A weekly meeting had been
// transcribed once, months earlier. Somebody opened today's occurrence,
// pressed import, and got that first meeting's conversation stored under
// today's date and title. Nothing errored. Nothing looked wrong. The only
// way to notice was to read it.
//
// Taking the newest transcript does not fix it either: that just moves the
// error to anybody importing an older occurrence, who would then be handed
// the most recent meeting instead. There is no ordering that answers the
// question, because the question is not "which is newest" but "which one is
// THIS meeting".
//
// So a transcript is matched to an occurrence by WHEN IT WAS MADE, and a
// meeting with nothing in its window is reported as having no transcript.
// Refusing is the whole point: handing somebody a different day's
// conversation is far worse than telling them there is nothing to import.
// -------------------------------------------------------------------

export type TranscriptCandidate = {
  id: string;
  /** When Teams created it. Null when Graph did not say. */
  createdAt: Date | null;
};

export type OccurrenceWindow = {
  startsAt: Date;
  endsAt: Date;
};

// -------------------------------------------------------------------
// How far outside the scheduled window a transcript may sit and still
// belong to it.
//
// Transcription is started from inside the meeting, so the timestamp lands
// near the start - but people join early, meetings overrun, and Teams
// finalises the record afterwards. The window is therefore generous in both
// directions and still far narrower than any sane recurrence: a daily
// series puts 24 hours between occurrences, and these total seven.
// -------------------------------------------------------------------
export const MATCH_BEFORE_START_MS = 60 * 60 * 1000;
export const MATCH_AFTER_END_MS = 6 * 60 * 60 * 1000;

export type TranscriptSelection =
  | { kind: "matched"; transcript: TranscriptCandidate }
  // Transcripts exist on the series, but none was made around this
  // occurrence. The ordinary case for a recurring meeting where only some
  // occurrences were transcribed.
  | { kind: "no-transcript-for-occurrence" }
  // Transcripts exist and carry no timestamp, so they cannot be placed
  // against an occurrence at all. Graph documents createdDateTime on a
  // transcript, so this should not happen - and if it ever does, guessing
  // is the one thing that must not happen.
  | { kind: "undateable" };

export function selectTranscriptForOccurrence(
  transcripts: readonly TranscriptCandidate[],
  occurrence: OccurrenceWindow,
): TranscriptSelection {
  if (transcripts.length === 0) return { kind: "no-transcript-for-occurrence" };

  const from = occurrence.startsAt.getTime() - MATCH_BEFORE_START_MS;
  const until = occurrence.endsAt.getTime() + MATCH_AFTER_END_MS;

  const dateable = transcripts.filter((transcript) => transcript.createdAt !== null);

  if (dateable.length === 0) return { kind: "undateable" };

  const within = dateable.filter((transcript) => {
    const at = (transcript.createdAt as Date).getTime();

    return at >= from && at <= until;
  });

  if (within.length === 0) return { kind: "no-transcript-for-occurrence" };

  // More than one inside a single occurrence's window means the meeting was
  // stopped and restarted. The later one is the fuller record, so it wins -
  // this is the only place "newest" is the right answer, because by now
  // every candidate is known to belong to the same meeting.
  const latest = within.reduce((best, candidate) =>
    (candidate.createdAt as Date).getTime() > (best.createdAt as Date).getTime() ? candidate : best,
  );

  return { kind: "matched", transcript: latest };
}
