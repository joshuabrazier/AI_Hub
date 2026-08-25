import z from "zod";

import { TABLE_ID_LENGTH } from "@/lib/constants";
import type {
  TranscriptionSegment,
  TranscriptionSource,
  TranscriptionStatus,
} from "@/lib/data/kysely-database-types";

const transcriptionIdSchema = z.string().min(TABLE_ID_LENGTH);

// -------------------------------------------------------------------
// Bounds
//
// MAX_MEDIA_BYTES is the Speech service's own ceiling for one file in a
// batch job, not a number chosen here. It cannot be enforced by the upload
// URL - a SAS grants a write, it does not cap one - so it is checked after
// the upload lands and before a job is created, which is the first moment
// the size is actually known.
//
// TRANSCRIPTION_TIMEOUT_HOURS is what stops a job that never came back
// from sitting in the list saying "transcribing" forever. Generously more
// than any real meeting needs: three hours of audio finishes in tens of
// minutes, so anything still running at this point is not running.
// -------------------------------------------------------------------
export const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;
export const TRANSCRIPTION_TIMEOUT_HOURS = 6;
export const TITLE_MAX_CHARS = 120;

// -------------------------------------------------------------------
// What the browser may send, and what each one is stored as.
//
// The media type is derived from the extension HERE and never taken from
// the browser. It is not a security control in the way the chat
// attachment sniffer is - nothing serves these bytes back to a browser, so
// there is no content-type confusion to exploit - it is there so the value
// in the column is one of ours rather than whatever the client claimed.
//
// UPLOADS ARE THE RISKY HALF, and this table is where that shows. Azure
// Speech documents support for WAV, MP3, OPUS/OGG, FLAC, WMA, AAC, AMR,
// WebM and SPEEX. MP4 AND MOV ARE NOT ON THAT LIST. The service runs
// GStreamer underneath and in practice usually demuxes them, but Microsoft
// does not promise it - so they are accepted here, flagged in the UI, and
// allowed to fail with the service's own message rather than being
// silently rejected by us or silently promised to work.
//
// A browser recording picks from RECORDING_FORMAT_CANDIDATES below, which
// is a shorter and safer list - so the record path mostly avoids this
// problem, and never lands on MP4 video.
// -------------------------------------------------------------------
export const MEDIA_TYPES_BY_EXTENSION: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".wma": "audio/x-ms-wma",
  ".aac": "audio/aac",
  ".amr": "audio/amr",
  ".m4a": "audio/mp4",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

// The formats Microsoft actually lists. Anything outside this is accepted
// but warned about, because it is the service that decides, not us.
const GUARANTEED_EXTENSIONS = [".wav", ".mp3", ".flac", ".ogg", ".opus", ".wma", ".aac", ".amr", ".webm"];

export const SUPPORTED_MEDIA_EXTENSIONS = Object.keys(MEDIA_TYPES_BY_EXTENSION);

// The `accept` attribute on the file input. A hint to the picker, never a
// check - the server derives the type again from the name it is given.
export const MEDIA_ACCEPT_ATTRIBUTE = SUPPORTED_MEDIA_EXTENSIONS.join(",");

// -------------------------------------------------------------------
// What a browser recording is saved as, in preference order.
//
// MediaRecorder does not produce the same thing everywhere and there is no
// format every browser agrees on. Chrome, Edge and Firefox give WebM/Opus,
// which is both the smallest and a documented Speech format. SAFARI GIVES
// NEITHER - on iOS in particular it records MP4/AAC and reports WebM as
// unsupported - and "record it on your phone" is half the point of this
// feature, so the fallback is not optional.
//
// The recorder walks this list and takes the first the browser admits to
// supporting. The extension travels with the choice because the server
// derives the media type from the filename, and a WebM saved as .m4a would
// be stored as the wrong thing.
// -------------------------------------------------------------------
// Ordered documented-first, and the order is load-bearing: MP4/AAC is
// LAST because it is the only entry the Speech service does not list, so
// nothing takes that risk until there is nothing else left to try.
export const RECORDING_FORMAT_CANDIDATES = [
  { mimeType: "audio/webm;codecs=opus", extension: ".webm" },
  { mimeType: "audio/webm", extension: ".webm" },
  { mimeType: "audio/ogg;codecs=opus", extension: ".ogg" },
  { mimeType: "audio/mp4", extension: ".m4a" },
] as const;

function extensionOf(fileName: string): string {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf(".");

  return dot === -1 ? "" : lower.slice(dot);
}

/** The media type for a filename, or null if the extension is not one we take. */
export function mediaTypeForFileName(fileName: string): string | null {
  return MEDIA_TYPES_BY_EXTENSION[extensionOf(fileName)] ?? null;
}

// -------------------------------------------------------------------
// The extension for a stored media type, for naming a download.
//
// The reverse of the table above. Several extensions can share a type
// (.webm is the only one for video/webm, but .m4a and .mp4 are close
// cousins), so the FIRST match wins and the table order decides - which is
// why audio types are listed before video ones.
//
// Falls back to .bin rather than guessing. A file saved under the wrong
// extension is worse than one the person has to rename: the wrong extension
// makes a player refuse it and looks like a corrupt download.
// -------------------------------------------------------------------
export function extensionForMediaType(mediaType: string): string {
  const match = Object.entries(MEDIA_TYPES_BY_EXTENSION).find(([, type]) => type === mediaType);

  return match?.[0] ?? ".bin";
}

/** Whether Microsoft documents support for this format, as opposed to it merely tending to work. */
export function isGuaranteedFormat(fileName: string): boolean {
  return GUARANTEED_EXTENSIONS.includes(extensionOf(fileName));
}

// -------------------------------------------------------------------
// One transcription in the list.
//
// Carries no transcript, segments or summary: the list shows names and
// progress, and an hour of text per row would make the screen load
// megabytes nobody is reading.
// -------------------------------------------------------------------
export type TranscriptionSummaryDTO = {
  id: string;
  title: string;
  source: TranscriptionSource;
  status: TranscriptionStatus;
  durationSeconds: number | null;
  byteSize: number | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

// -------------------------------------------------------------------
// One transcription, opened.
//
// `summary` can be null on a completed row. A summary is a second model
// call after the transcript is already stored, and it is allowed to fail
// without taking the transcript down with it - `error` says so, and the
// UI offers to try again.
// -------------------------------------------------------------------
export type TranscriptionDetailDTO = TranscriptionSummaryDTO & {
  transcript: string | null;
  segments: TranscriptionSegment[];
  summary: string | null;
};

// -------------------------------------------------------------------
// Everything the screen renders in one pass.
//
// THREE flags, because there are three different ways this can be not-ready
// and each needs a different sentence. Storage can be configured without
// Speech, in which case media uploads and nothing transcribes it. Both can
// be configured and still not work, if the storage is the local emulator -
// Azure fetches the recording itself and cannot reach a laptop.
//
// They are reported separately rather than reduced to one "not configured"
// because naming the missing piece is the difference between a fixable
// message and an afternoon.
// -------------------------------------------------------------------
export type TranscriptionPageDTO = {
  isStorageConfigured: boolean;
  isSpeechConfigured: boolean;
  // False against Azurite or a private-network storage account. Everything
  // up to creating the job still works; the job itself cannot.
  isStorageReachableByAzure: boolean;
  transcriptions: TranscriptionSummaryDTO[];
  active: TranscriptionDetailDTO | null;
};

// What the browser needs to upload the media itself: where to put it, and
// which row to start once it has.
export type TranscriptionUploadTicketDTO = {
  transcriptionId: string;
  uploadUrl: string;
  mediaType: string;
};

// -------------------------------------------------------------------
// Schemas
//
// Every one carries an id from the client and none of them is proof of
// anything: the service re-resolves the row against the SESSION user
// before touching it.
// -------------------------------------------------------------------

// Step one of an upload or a recording. The row is created FIRST, in
// `awaiting_media`, so the upload URL can be scoped to a blob key that
// belongs to a row this user owns - rather than letting the client name
// its own destination in a shared container.
export const CreateTranscriptionSchema = z.object({
  title: z.string().trim().min(1, "Please give this a name").max(TITLE_MAX_CHARS),
  source: z.enum(["upload", "recording"]),
  // Used for display and to derive the media type. Never trusted as one.
  fileName: z.string().trim().min(1).max(255),
});

export type CreateTranscriptionRequestDTO = z.infer<typeof CreateTranscriptionSchema>;

export const TranscriptionIdSchema = z.object({
  transcriptionId: transcriptionIdSchema,
});

export type TranscriptionIdRequestDTO = z.infer<typeof TranscriptionIdSchema>;

export const RenameTranscriptionSchema = z.object({
  transcriptionId: transcriptionIdSchema,
  title: z.string().trim().min(1, "Please enter a name").max(TITLE_MAX_CHARS),
});

export type RenameTranscriptionRequestDTO = z.infer<typeof RenameTranscriptionSchema>;

// -------------------------------------------------------------------
// Formatting, shared by the list and the detail view so a duration or a
// timestamp reads the same in both.
// -------------------------------------------------------------------
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;

  return `${remainder}s`;
}

export function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  const base = `${minutes}:${String(seconds).padStart(2, "0")}`;

  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : base;
}

// -------------------------------------------------------------------
// A speaker's display name.
//
// The Speech service separates voices but has no idea who they are, so a
// speaker is a number. Null means it could not tell them apart at all,
// which happens on a single-microphone recording of a room.
// -------------------------------------------------------------------
export function speakerLabel(speaker: number | null): string {
  return speaker === null ? "Speaker" : `Speaker ${speaker}`;
}
