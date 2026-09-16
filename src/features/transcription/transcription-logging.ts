import "server-only";

import type { Transcription } from "@/lib/data/kysely-database-types";
import { type AudioProbe, summariseAudioProbe } from "@/lib/media/audio-probe";

// -------------------------------------------------------------------
// ===================================================================
// WHAT A FAILURE LOOKS LIKE IN THE LOG
// ===================================================================
//
// Every transcription failure used to reach the log as whatever sentence
// happened to be in hand, sometimes with a stack, usually with no way to
// tell WHICH recording it was about or how far it had got. So the only
// question anybody could answer afterwards was "did it fail", and the
// questions worth asking - is it always the same source, always the same
// container, always past a certain size, always the same stage - could not
// be asked at all.
//
// ONE LINE, KEY=VALUE, ONE PREFIX. Deliberately greppable rather than
// pretty: the point of this format is that a month of failures can be
// filtered on any field without a log platform, which this deployment does
// not have.
//
// WHAT IS NEVER IN IT: the title, and the transcript. A title is typed by a
// person and routinely carries a client's name, and a transcript is the
// meeting itself. Ids, sizes, formats and stages identify a row without
// describing anybody's business - and a log that is safe to paste into a
// ticket is a log people will actually use.
// -------------------------------------------------------------------

/** Which part of the pipeline gave up. The first field anybody filters on. */
export type TranscriptionFailureStage =
  /** Creating the Speech job: size, reachability, or the API refusing. */
  | "start"
  /** The Speech job itself came back failed. */
  | "job"
  /** The job succeeded and its result could not be read or held no speech. */
  | "result"
  /** The transcript is stored and the summary would not generate. */
  | "summary"
  /** A job that never came back at all. */
  | "timeout"
  /** Replacing the media with a re-encoded copy. */
  | "reencode";

type FailureContext = {
  stage: TranscriptionFailureStage;
  transcription: Pick<
    Transcription,
    "id" | "userId" | "source" | "status" | "speechJobId" | "storageKey" | "mediaType" | "byteSize" | "createdAt" | "updatedAt"
  >;
  /** The message the person will see. Quoted in the line so it cannot break the fields. */
  reason: string;
  /** What the bytes actually are, where it was worth reading them. */
  probe?: AudioProbe | null;
  /** Anything stage-specific: an attempt number, an HTTP status. */
  extra?: Record<string, string | number | boolean | null | undefined>;
};

export function logTranscriptionFailure(context: FailureContext): void {
  const { transcription: row } = context;

  const startedAt = row.updatedAt ?? row.createdAt;

  const fields: [string, string | number | boolean | null | undefined][] = [
    ["stage", context.stage],
    ["id", row.id],
    ["user", row.userId],
    ["source", row.source],
    ["status", row.status],
    ["job", row.speechJobId],
    // The key carries the owner and the row id and nothing else, and it is
    // what an administrator needs to find the blob in the portal.
    ["key", row.storageKey],
    // DECLARED, not detected - it was derived from a filename at upload.
    // Named that way because the whole point of the probe beside it is that
    // the two can disagree.
    ["declaredType", row.mediaType],
    ["bytes", row.byteSize],
    ["ageMin", startedAt ? Math.round((Date.now() - startedAt.getTime()) / 60_000) : null],
    ...Object.entries(context.extra ?? {}),
  ];

  const line = fields
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([name, value]) => `${name}=${quoteIfNeeded(String(value))}`)
    .join(" ");

  const probe = context.probe ? ` ${summariseAudioProbe(context.probe)}` : "";

  console.error(`[transcription] failed ${line}${probe} reason=${quoteIfNeeded(context.reason)}`);
}

// -------------------------------------------------------------------
// A value with a space in it is quoted, so splitting a line on spaces can
// never silently produce the wrong field count - which is exactly what a
// reason like "the audio format is invalid" would otherwise do to every
// tool anybody points at this.
// -------------------------------------------------------------------
function quoteIfNeeded(value: string): string {
  const flattened = value.replace(/\s+/g, " ").trim();

  return /[\s"]/.test(flattened) ? `"${flattened.replace(/"/g, "'")}"` : flattened;
}
