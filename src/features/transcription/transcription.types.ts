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
// Speech documents a specific list, and the MP4 family - .mp4, .m4a, .mov,
// .m4v, .3gp - is not on it, nor are .mkv, .avi, .wmv or .aiff.
//
// NOTHING HERE CONVERTS ANYTHING. The file is uploaded exactly as it
// arrived and Azure is handed a URL to it; all decoding happens on their
// side. The undocumented formats work because a container like .mp4 is only
// a wrapper around an audio stream the service can already decode, and its
// decoder unwraps more than the published list commits to. Microsoft
// documents GStreamer as the decoder for the SDK's compressed-audio path,
// where the accepted formats include "ANY for MP4 container or unknown
// media format" - but that is the SDK, not the batch REST API used here,
// whose internals are not documented at all. So these formats working is an
// OBSERVATION, not a promise, and that is exactly why they are flagged
// rather than listed as supported.
//
// They are accepted, flagged in the UI, and allowed to fail with the
// service's own message. Refusing them outright would be worse: between
// them they are what every phone, meeting tool and screen recorder actually
// produces, and a person holding a recording of a meeting that already
// happened is not helped by being told the extension is wrong.
//
// A browser recording picks from RECORDING_FORMAT_CANDIDATES below, which
// is a shorter and safer list - so the record path mostly avoids this
// problem, and never lands on MP4 video.
// -------------------------------------------------------------------
export const MEDIA_TYPES_BY_EXTENSION: Record<string, string> = {
  // Documented by Microsoft. ALAW and MULAW are also listed, but both live
  // inside a WAV container, so .wav already covers them.
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/opus",
  ".spx": "audio/ogg",
  ".wma": "audio/x-ms-wma",
  ".aac": "audio/aac",
  ".amr": "audio/amr",
  ".webm": "video/webm",

  // Not documented, accepted anyway - see the note above. These are what
  // real devices actually produce, in rough order of how often they turn up:
  // phone voice memos and meeting tools first, screen recorders after.
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".3gp": "video/3gpp",
  ".3gpp": "video/3gpp",
  ".mkv": "video/x-matroska",
  ".wmv": "video/x-ms-wmv",
  ".avi": "video/x-msvideo",
  ".aiff": "audio/aiff",
  ".aif": "audio/aiff",
};

// The formats Microsoft actually lists: WAV, MP3, OPUS/OGG, FLAC, WMA, AAC,
// ALAW and MULAW in a WAV container, AMR, WebM and SPEEX. Anything outside
// this is accepted but warned about, because it is the service that
// decides, not us.
//
// .m4a IS here, and it is the one entry on this list Microsoft does not
// spell out. It was previously excluded on the grounds that what they
// document is AAC, which conventionally means raw ADTS, and .m4a is AAC
// inside an MP4 container - so listing it was putting words in their mouth.
//
// That reasoning was right about the documentation and wrong about the
// cost. A phone voice memo is .m4a, which makes it the single most common
// thing anybody uploads here, and warning on the most common case trains
// people to ignore the warning - which then does not work for .mov or .avi,
// where it actually earns its place. A caveat shown to everybody is not a
// caveat.
//
// It is still an observation rather than a promise, and the honest place
// for that is this comment. If .m4a ever does start failing, the fix is a
// message naming the format, not a banner on every upload.
const GUARANTEED_EXTENSIONS = [
  ".wav",
  ".mp3",
  ".flac",
  ".ogg",
  ".oga",
  ".opus",
  ".spx",
  ".wma",
  ".aac",
  ".amr",
  ".webm",
  ".m4a",
];

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
// One Teams meeting somebody could import.
//
// Built from a calendar event, so it says nothing about whether a
// transcript actually EXISTS - Graph has no endpoint that answers that
// without resolving the meeting first, which is a call per row. `importedAs`
// is the one thing known for certain here: the id of the transcription this
// person already made from it, so the screen offers to open that instead of
// importing a second copy.
//
// `joinUrl` is deliberately absent. The import takes an event id and reads
// the URL back from Graph itself - see getTeamsMeeting.
// -------------------------------------------------------------------
export type TeamsMeetingDTO = {
  eventId: string;
  subject: string;
  startsAt: Date;
  endsAt: Date;
  organiser: string | null;
  importedAs: string | null;
};

// -------------------------------------------------------------------
// The Teams panel, in one answer.
//
// `isConfigured` false means this deployment has no Microsoft sign-in at
// all, which is the local-development case. Reported rather than throwing,
// because "not available here" is a sentence and an error is not.
// -------------------------------------------------------------------
export type TeamsMeetingsDTO = {
  isConfigured: boolean;
  lookbackDays: number;
  meetings: TeamsMeetingDTO[];
  // True when the calendar window held more ENTRIES than the one page asked
  // for. The online-meeting filter runs after that page is built, so this can
  // be set while every Teams meeting is already listed: it means older
  // meetings MAY be missing, never that any definitely are. Said out loud
  // rather than swallowed, because a list quietly missing the meeting
  // somebody wants reads as "the import is broken".
  truncated: boolean;
};

// The import carries ONLY an opaque calendar id. Everything else about the
// meeting - its join URL, its title - is read back from Graph, so nothing
// the browser sends can name a row or reach a meeting.
export const ImportTeamsMeetingSchema = z.object({
  eventId: z.string().trim().min(1).max(512),
});

export type ImportTeamsMeetingRequestDTO = z.infer<typeof ImportTeamsMeetingSchema>;

// -------------------------------------------------------------------
// Everything the screen renders in one pass.
//
// FOUR flags, because there are four different ways this can be not-ready
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
  // A FOURTH, and independent of the other three. Importing from Teams
  // uploads nothing, stores nothing and never asks the Speech service - it
  // needs Microsoft sign-in and nothing else. So a deployment can have this
  // and not the other two, or the other two and not this.
  isTeamsImportConfigured: boolean;
  transcriptions: TranscriptionSummaryDTO[];
  active: TranscriptionDetailDTO | null;
};

// -------------------------------------------------------------------
// Whether the person can record or upload here, and if not, why not.
//
// THREE WAYS TO BE NOT-READY, THREE DIFFERENT SENTENCES. Reducing them to
// one "not configured" would send somebody looking in the wrong place - and
// the third especially, because everything about that setup LOOKS right:
// the key is set, the storage is set, the recorder works, the upload
// succeeds. Only the job fails, minutes later, with a message from Azure
// about a URI.
//
// Derived HERE rather than in a component because two screens need the same
// answer: the panel shown when nothing works at all, and the note above the
// Teams tab when importing works but recording does not. Two copies of this
// reasoning would drift, and the failure mode is a wrong diagnosis.
//
// Null when recording and uploading are both fine.
// -------------------------------------------------------------------
export function recordingUnavailableReason(
  page: Pick<
    TranscriptionPageDTO,
    "isStorageConfigured" | "isSpeechConfigured" | "isStorageReachableByAzure"
  >,
): { title: string; detail: string } | null {
  if (!page.isStorageConfigured) {
    return {
      title: "Recording and uploading are not configured",
      detail:
        "There is nowhere to put a recording on this environment. Set AZURE_STORAGE_CONNECTION_STRING and restart.",
    };
  }

  if (!page.isSpeechConfigured) {
    return {
      title: "Recording and uploading are not configured",
      detail:
        "Recordings can be stored but nothing can transcribe them. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION and restart.",
    };
  }

  if (!page.isStorageReachableByAzure) {
    return {
      title: "Transcription cannot run against local storage",
      detail:
        "Azure downloads the recording itself and cannot reach the storage emulator on this machine. Everything else works locally - to transcribe, point AZURE_STORAGE_CONNECTION_STRING at a real storage account.",
    };
  }

  return null;
}

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
// TWO DIFFERENT KINDS OF CERTAINTY, in priority order. A Teams import
// carries a real name, because Teams transcribes each participant's own
// microphone against their signed-in identity - it is not clustering
// voices, it knows who is talking. Everything recorded or uploaded here
// gets a number instead: the Speech service separates voices but has no
// idea who they are, and null means it could not separate them at all,
// which is what a single microphone in a room usually produces.
//
// Taking the segment rather than the number is what keeps that order in one
// place. A caller reaching for `segment.speaker` on its own would silently
// print "Speaker 1" over a transcript that knows the person's name.
// -------------------------------------------------------------------
export function speakerLabel(segment: Pick<TranscriptionSegment, "speaker" | "speakerName">): string {
  if (segment.speakerName) return segment.speakerName;

  return segment.speaker === null ? "Speaker" : `Speaker ${segment.speaker}`;
}
