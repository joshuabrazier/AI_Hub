import type { Transcription } from "@/lib/data/kysely-database-types";

import { TITLE_MAX_CHARS } from "./transcription.types";
import type { TranscriptionDetailDTO, TranscriptionSummaryDTO } from "./transcription.types";

// The list query does not select the three heavy columns, so the row it
// returns is narrower than a full one. Typed as the difference rather than
// as a second interface, so adding a column to the table cannot leave this
// silently out of date.
type TranscriptionListRow = Omit<Transcription, "transcript" | "segments" | "summary">;

// -------------------------------------------------------------------
// Map a row to the list DTO.
//
// `title` is passed through untouched. It is either what the person typed
// or the name of a file from their own machine, so it is untrusted text
// and is rendered as a text node - never as markup.
//
// `error` is passed through too, and it is the one to be careful about: it
// carries a message from the Speech service or from Bedrock. It is bounded
// where it is written (see the service) so a service that returns a wall
// of text cannot fill the column, and it renders as a text node like
// everything else.
// -------------------------------------------------------------------
export function mapDBTranscriptionToSummaryDTO(row: TranscriptionListRow): TranscriptionSummaryDTO {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    status: row.status,
    durationSeconds: row.durationSeconds,
    byteSize: row.byteSize,
    error: row.error,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

// -------------------------------------------------------------------
// Map a full row to the detail DTO.
//
// `storageKey` and `speechJobId` are deliberately NOT carried across. They
// are the two values that address things outside this database - a blob and
// a job on the Speech service - and neither is any use to the browser. A
// DTO that cannot express them is a better guarantee than remembering not
// to send them.
// -------------------------------------------------------------------
export function mapDBTranscriptionToDetailDTO(row: Transcription): TranscriptionDetailDTO {
  return {
    ...mapDBTranscriptionToSummaryDTO(row),
    transcript: row.transcript,
    // JSONB, so this is already parsed. Null on a row whose job has not
    // finished, and on one the service could not separate speakers in.
    segments: row.segments ?? [],
    summary: row.summary,
  };
}

// -------------------------------------------------------------------
// A default name for an upload, from its filename.
//
// Strips any path the browser included and the extension, which is noise
// in a heading - the format is already shown next to the size. Falls back
// to a generic name rather than an empty one, because a file called
// ".webm" would otherwise leave the row with no title at all.
// -------------------------------------------------------------------
export function deriveTranscriptionTitle(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;

  // A leading dot is not an extension separator - ".webm" is a name that is
  // nothing BUT an extension, and slicing at index 0 would keep the whole
  // thing. Handled explicitly so it falls through to the default below.
  const dot = base.lastIndexOf(".");
  const withoutExtension = dot > 0 ? base.slice(0, dot) : dot === 0 ? "" : base;

  const collapsed = withoutExtension.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

  if (collapsed.length === 0) return "Recording";

  return collapsed.slice(0, TITLE_MAX_CHARS);
}
