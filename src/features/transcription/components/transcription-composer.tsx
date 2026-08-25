"use client";

import { useRef, useState } from "react";

import { FileAudio, Mic, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TRANSCRIPTION_SOURCES } from "@/lib/data/kysely-database-types";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

import { deriveTranscriptionTitle } from "../transcription.mappers";
import {
  MAX_MEDIA_BYTES,
  MEDIA_ACCEPT_ATTRIBUTE,
  TITLE_MAX_CHARS,
  isGuaranteedFormat,
  mediaTypeForFileName,
} from "../transcription.types";
import { TranscriptionRecorder } from "./transcription-recorder";
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

  const chooseFile = (chosen: File | null) => {
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

    setFile(chosen);
    // Only if they have not named it themselves - retyping a title because
    // the file was swapped is a small thing done often.
    setTitle((current) => (current.trim().length === 0 ? deriveTranscriptionTitle(chosen.name) : current));
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

  const submitRecording = async (recording: { media: Blob; extension: string; durationSeconds: number }) => {
    // Named for when it was recorded, because nobody types a title before a
    // meeting and this is the only fact about it that is known for certain.
    // In the app timezone, via formatDateTime - never from a raw Date.
    const defaultTitle = `Meeting - ${formatDateTime(new Date())}`;

    const transcriptionId = await upload({
      media: recording.media,
      // The extension is what the server derives the media type from, so it
      // has to be the one the recorder actually produced.
      fileName: `recording${recording.extension}`,
      title: title.trim().length > 0 ? title.trim() : defaultTitle,
      source: TRANSCRIPTION_SOURCES.RECORDING,
    });

    if (transcriptionId) {
      setTitle("");
      onStarted(transcriptionId);
    }
  };

  const warnAboutFormat = file !== null && !isGuaranteedFormat(file.name);

  return (
    <div className="rounded-xl border border-border p-5">
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
                chooseFile(event.target.files?.[0] ?? null);
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
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {file ? "Choose a different file" : "Choose a file"}
            </Button>
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
          <TranscriptionRecorder onRecorded={submitRecording} disabled={isUploading} />

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
