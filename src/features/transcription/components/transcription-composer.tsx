"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Download, FileAudio, Mic, Trash2, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TRANSCRIPTION_SOURCES } from "@/lib/data/kysely-database-types";
import { downloadBlob, safeDownloadName } from "@/lib/download-blob";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { deriveTranscriptionTitle } from "../transcription.mappers";
import {
  MAX_MEDIA_BYTES,
  MEDIA_ACCEPT_ATTRIBUTE,
  TITLE_MAX_CHARS,
  formatDuration,
  isGuaranteedFormat,
  mediaTypeForFileName,
} from "../transcription.types";
import { convertForTranscription, needsConversion } from "./audio-convert";
import {
  assembleRecording,
  discardRecording,
  listPendingRecordings,
  type PendingRecording,
} from "./recording-store";
import { TranscriptionRecorder, type FinishedRecording } from "./transcription-recorder";
import { useTranscriptionUpload } from "./use-transcription-upload";

// -------------------------------------------------------------------
// TranscriptionComposer
//
// The two ways in, side by side: upload a file that already exists, or
// record one now. They are tabs rather than two screens because they
// produce the same thing - a name and some bytes - and everything after
// that point is identical.
//
// Neither path sends media through this app. Both hand their bytes to
// useTranscriptionUpload, which puts them straight into storage. See the
// note there for why.
//
// A RECORDING IS NEVER THROWN AWAY. If the upload fails, the file stays on
// the device and this screen says so, with a button to save it and a button
// to try again - it is not discarded until the server has confirmed it. The
// same panel appears on load if a previous visit left one behind, which is
// what a crashed tab or a closed laptop looks like from here. A meeting
// cannot be recorded twice, so "it failed, start again" is not an answer
// this feature is allowed to give.
// -------------------------------------------------------------------

const MEGABYTE = 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < MEGABYTE) return `${Math.max(1, Math.round(bytes / 1024))} KB`;

  return `${(bytes / MEGABYTE).toFixed(1)} MB`;
}

export function TranscriptionComposer({ onStarted }: { onStarted: (transcriptionId: string) => void }) {
  const { upload, isUploading, progress } = useTranscriptionUpload();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  // A recording that is on this device and not yet safely uploaded. Set
  // when an upload fails, and on load when a previous visit left one - a
  // crashed tab, a closed laptop, a refresh mid-upload.
  const [pending, setPending] = useState<PendingRecording | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  // Decoding an hour of audio takes a few seconds and blocks nothing else,
  // so the screen has to say what it is doing or the file simply appears to
  // not attach.
  const [isConverting, setIsConverting] = useState(false);

  // The default name for a recording. A function, not a value, because it
  // reads the clock - computing it during render would differ between
  // server and client and break hydration.
  const defaultRecordingTitle = useCallback(() => `Meeting - ${formatDateTime(new Date())}`, []);

  // The newest held recording is the one worth offering. Anything older is
  // still in the store and still recoverable, but stacking a panel for
  // every one would bury the thing somebody just lost.
  const refreshPending = useCallback(
    () =>
      listPendingRecordings()
        .then((held) => setPending(held[0] ?? null))
        .catch((error) => console.warn("[composer] could not read the local recording store", error)),
    [],
  );

  // Checked once on mount. This is what turns a crashed tab from "an hour
  // of my meeting is gone" into a panel offering it back.
  //
  // The read is an external system, so the state lands in its callback
  // rather than in the effect body - and the cancelled flag means a store
  // that answers slowly cannot set state on an unmounted component.
  useEffect(() => {
    let cancelled = false;

    listPendingRecordings()
      .then((held) => {
        if (!cancelled) setPending(held[0] ?? null);
      })
      .catch((error) => console.warn("[composer] could not read the local recording store", error));

    return () => {
      cancelled = true;
    };
  }, []);

  const chooseFile = async (chosen: File | null) => {
    if (!chosen) return;

    // Checked here so an unusable file is refused before anybody waits for
    // an upload. The server derives the type again from the name it is
    // given and refuses the same way, so this is a courtesy rather than the
    // control.
    if (!mediaTypeForFileName(chosen.name)) {
      toast.error("That is not an audio or video file this can transcribe.");
      return;
    }

    if (chosen.size > MAX_MEDIA_BYTES) {
      toast.error(`That file is larger than the ${Math.round(MAX_MEDIA_BYTES / MEGABYTE)} MB limit.`);
      return;
    }

    // The title comes from the name the PERSON chose, not the converted
    // one - "Board meeting.m4a" and "Board meeting.wav" derive the same
    // title, but taking it before the swap keeps that true if the
    // conversion ever changes the stem.
    const chosenTitle = deriveTranscriptionTitle(chosen.name);

    // -------------------------------------------------------------------
    // MP4-family files are converted here, before upload.
    //
    // Azure Speech downloads an .m4a happily and then refuses it with
    // "InvalidData: The recordings URI contains invalid data" - it is AAC
    // in an MP4 container, and the batch decoder will not unwrap it. A
    // phone voice memo is the most common upload there is, so this is the
    // common path rather than an edge case.
    //
    // Converting in the browser avoids needing ffmpeg on the server, which
    // the App Service Node runtime does not have, and sends less over the
    // network besides: 16 kHz mono is about a tenth of what a phone
    // records.
    //
    // Anything that cannot be converted is uploaded untouched. The service
    // may still read a format this cannot, and refusing here would take a
    // recording of a meeting that already happened.
    // -------------------------------------------------------------------
    let toUpload = chosen;

    if (needsConversion(chosen.name)) {
      setIsConverting(true);

      try {
        const result = await convertForTranscription(chosen);

        if (result.converted) {
          toUpload = result.file;
        } else if (result.reason === "too-long") {
          toast.warning(
            "That recording is too long to convert in the browser. It will be uploaded as it is, and may not transcribe.",
          );
        } else if (result.reason !== "not-needed") {
          toast.warning("That file could not be converted. It will be uploaded as it is, and may not transcribe.");
        }
      } finally {
        setIsConverting(false);
      }
    }

    // Re-checked AFTER conversion. WAV is uncompressed, so a small
    // compressed file can come out of this larger than it went in - an
    // hour of 16 kHz mono is about 115 MB - and the server enforces the
    // same limit from storage regardless.
    if (toUpload.size > MAX_MEDIA_BYTES) {
      toast.error(
        `Converted, that recording is larger than the ${Math.round(MAX_MEDIA_BYTES / MEGABYTE)} MB limit. Try a shorter recording.`,
      );
      return;
    }

    setFile(toUpload);
    // Only if they have not named it themselves - retyping a title because
    // the file was swapped is a small thing done often.
    setTitle((current) => (current.trim().length === 0 ? chosenTitle : current));
  };

  const submitFile = async () => {
    if (!file) return;

    const transcriptionId = await upload({
      media: file,
      fileName: file.name,
      title: title.trim().length > 0 ? title.trim() : deriveTranscriptionTitle(file.name),
      source: TRANSCRIPTION_SOURCES.UPLOAD,
    });

    if (transcriptionId) {
      setFile(null);
      setTitle("");
      onStarted(transcriptionId);
    }
  };

  const submitRecording = async (recording: FinishedRecording) => {
    const transcriptionId = await upload({
      media: recording.media,
      // The extension is what the server derives the media type from, so it
      // has to be the one the recorder actually produced.
      fileName: `recording${recording.extension}`,
      // Named for when it was recorded when nobody has typed anything,
      // because that is the only fact known for certain about a meeting
      // that has just finished.
      title: title.trim().length > 0 ? title.trim() : defaultRecordingTitle(),
      source: TRANSCRIPTION_SOURCES.RECORDING,
    });

    if (transcriptionId) {
      // The server has it. Only now is the device copy dropped - this is
      // the single place that happens on a successful path.
      await discardRecording(recording.recordingId).catch((error) => {
        console.warn("[composer] could not clear the uploaded recording", error);
      });

      setTitle("");
      setPending(null);
      onStarted(transcriptionId);
      return;
    }

    // The upload failed and the reason has already been shown. The
    // recording is still on the device, so surface it rather than letting
    // the screen go quiet as though nothing had happened.
    await refreshPending();
  };

  // -------------------------------------------------------------------
  // Recovering a recording that is still on the device.
  // -------------------------------------------------------------------
  const retryPending = async () => {
    if (!pending) return;

    setIsRecovering(true);

    try {
      const media = await assembleRecording(pending);

      if (!media) {
        toast.error("That recording could not be read back from this device.");
        return;
      }

      const transcriptionId = await upload({
        media,
        fileName: `recording${pending.extension}`,
        title: title.trim().length > 0 ? title.trim() : pending.title,
        source: TRANSCRIPTION_SOURCES.RECORDING,
      });

      if (transcriptionId) {
        await discardRecording(pending.id);
        setTitle("");
        setPending(null);
        onStarted(transcriptionId);
      }
    } finally {
      setIsRecovering(false);
    }
  };

  const savePending = async () => {
    if (!pending) return;

    const media = await assembleRecording(pending);

    if (!media) {
      toast.error("That recording could not be read back from this device.");
      return;
    }

    downloadBlob(media, safeDownloadName(pending.title, pending.extension));
  };

  const dropPending = async () => {
    if (!pending) return;

    await discardRecording(pending.id);
    setPending(null);
    toast.success("Recording deleted from this device.");
  };

  const warnAboutFormat = file !== null && !isGuaranteedFormat(file.name);

  return (
    <div className="rounded-xl border border-border p-5">
      {/* Above the tabs, because a recording that has not made it off this
          device is more urgent than anything else on the screen. */}
      {pending ? (
        <PendingRecordingPanel
          recording={pending}
          isBusy={isUploading || isRecovering}
          onRetry={retryPending}
          onSave={savePending}
          onDiscard={dropPending}
        />
      ) : null}

      <Tabs defaultValue="upload">
        <TabsList>
          <TabsTrigger value="upload">
            <Upload size={15} aria-hidden="true" />
            Upload a file
          </TabsTrigger>
          <TabsTrigger value="record">
            <Mic size={15} aria-hidden="true" />
            Record
          </TabsTrigger>
        </TabsList>

        {/* ----------------------------------------------------------
            Upload
            ---------------------------------------------------------- */}
        <TabsContent value="upload" className="space-y-4">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              chooseFile(event.dataTransfer.files[0] ?? null);
            }}
            className={cn(
              "flex flex-col items-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
              isDragging ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FileAudio size={22} aria-hidden="true" />
            </span>

            {file ? (
              <>
                <p className="mt-3 max-w-full truncate text-sm font-medium text-foreground">{file.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{formatSize(file.size)}</p>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm font-medium text-foreground">Drop a recording here</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Audio or video, up to {Math.round(MAX_MEDIA_BYTES / MEGABYTE)} MB.
                </p>
              </>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept={MEDIA_ACCEPT_ATTRIBUTE}
              className="sr-only"
              onChange={(event) => {
                void chooseFile(event.target.files?.[0] ?? null);
                // Cleared so choosing the same file twice still fires a
                // change event - otherwise a re-pick after an error does
                // nothing at all.
                event.target.value = "";
              }}
            />

            <Button
              type="button"
              variant="outline"
              className="mt-4"
              disabled={isUploading || isConverting}
              onClick={() => fileInputRef.current?.click()}
            >
              {isConverting
                ? "Preparing..."
                : file
                  ? "Choose a different file"
                  : "Choose a file"}
            </Button>

            {isConverting ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Converting to a format the transcription service accepts. This can take a moment for a long
                recording.
              </p>
            ) : null}
          </div>

          {warnAboutFormat ? (
            // Said rather than blocked. MP4 and MOV usually work and are the
            // formats a phone or a meeting tool actually produces, so
            // refusing them outright would be wrong - but promising they
            // work would be too.
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                This format is not one the transcription service formally supports. It usually works, but if it
                fails, convert the file to MP3 or WAV and try again.
              </span>
            </p>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="transcription-title">Name</Label>
            <Input
              id="transcription-title"
              value={title}
              maxLength={TITLE_MAX_CHARS}
              placeholder="What was this meeting?"
              disabled={isUploading}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <UploadProgress progress={progress} />

          <div className="flex justify-end">
            <Button type="button" onClick={submitFile} disabled={!file || isUploading} loading={isUploading}>
              {isUploading ? "Uploading..." : "Transcribe"}
            </Button>
          </div>
        </TabsContent>

        {/* ----------------------------------------------------------
            Record
            ---------------------------------------------------------- */}
        <TabsContent value="record" className="space-y-4">
          <TranscriptionRecorder
            onRecorded={submitRecording}
            defaultTitle={defaultRecordingTitle}
            disabled={isUploading || isRecovering}
          />

          <div className="grid gap-2">
            <Label htmlFor="transcription-recording-title">Name (optional)</Label>
            <Input
              id="transcription-recording-title"
              value={title}
              maxLength={TITLE_MAX_CHARS}
              placeholder="Named with today's date if you leave this empty"
              disabled={isUploading}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <UploadProgress progress={progress} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// -------------------------------------------------------------------
// The upload bar.
//
// Shown for both paths, because the wait is the same either way and a
// recording of an hour-long meeting is the larger of the two.
// -------------------------------------------------------------------
function UploadProgress({ progress }: { progress: number | null }) {
  if (progress === null) return null;

  return (
    <div>
      <div
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Upload progress"
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">Uploading, {progress}%. Keep this page open.</p>
    </div>
  );
}

// -------------------------------------------------------------------
// A recording that is on this device and not yet on the server.
//
// THE POINT OF THIS COMPONENT is that a meeting cannot be recorded twice.
// Everything else in this feature can be retried from scratch; this cannot,
// so the recording is held rather than dropped, and the panel gives three
// ways out: send it again, save it to disk, or deliberately let it go.
//
// "Save a copy" is deliberately not the last resort. If the upload is
// failing because of something the reader cannot fix - storage
// misconfigured, no network at a client site - then getting the file onto
// their disk is the thing that actually rescues the meeting, and they can
// upload it from the other tab later.
// -------------------------------------------------------------------
function PendingRecordingPanel({
  recording,
  isBusy,
  onRetry,
  onSave,
  onDiscard,
}: {
  recording: PendingRecording;
  isBusy: boolean;
  onRetry: () => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      role="status"
      className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950"
    >
      <div className="flex items-start gap-2">
        <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
            A recording is still on this device
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
            <span className="font-medium">{recording.title}</span>
            {recording.durationSeconds > 0 ? ` - ${formatDuration(recording.durationSeconds)}` : ""}
            {recording.byteSize > 0 ? ` - ${formatSize(recording.byteSize)}` : ""}
          </p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
            {recording.complete
              ? "It has not been uploaded yet. Send it now, or save a copy first if you would rather not rely on this."
              : "It was interrupted before it finished, so the end may be missing. Everything captured up to that point is here."}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={onRetry} disabled={isBusy} loading={isBusy}>
              <Upload size={14} aria-hidden="true" />
              Upload and transcribe
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onSave} disabled={isBusy}>
              <Download size={14} aria-hidden="true" />
              Save a copy
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onDiscard} disabled={isBusy}>
              <Trash2 size={14} aria-hidden="true" />
              Delete
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
