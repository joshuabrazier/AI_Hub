"use client";

import { useCallback, useState } from "react";

import { toast } from "sonner";

import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { createTranscriptionAction, startTranscriptionAction } from "../transcription.actions";
import { MAX_MEDIA_BYTES, type CreateTranscriptionRequestDTO } from "../transcription.types";
import { uploadInBlocks } from "./blob-upload";

// -------------------------------------------------------------------
// useTranscriptionUpload
//
// The three-step dance that gets media from the browser to a running
// transcription job, in one place because BOTH ways in need it: uploading a
// file and finishing a recording differ only in where the bytes came from.
//
//   1. claim a row and get a write-only URL   (server action)
//   2. PUT the bytes straight to blob storage, in blocks (never through the app)
//   3. tell the server the file has landed    (server action)
//
// Step 2 is the reason this is a hook rather than an action. The media can
// be hundreds of megabytes: sending it through the app would tie up an
// instance for the whole transfer, and the browser can talk to storage
// directly with a credential that can do nothing else.
//
// It uses XMLHttpRequest, which is deliberate and the one place in this
// codebase that does. fetch cannot report upload progress - there is no
// event for it - and a person watching a long upload with no indication of
// whether it is moving will reload the page and lose the recording.
// -------------------------------------------------------------------

export type TranscriptionUploadRequest = {
  /** The bytes: a File from a picker, or a Blob from MediaRecorder. */
  media: Blob;
  /** Used to derive the media type server-side, so it must carry a real extension. */
  fileName: string;
  title: string;
  // Deliberately narrower than TranscriptionSource. A 'teams' transcription
  // arrives through Graph already complete - there is no media to upload -
  // so this path cannot produce one, and the type says so rather than
  // relying on nobody trying.
  source: CreateTranscriptionRequestDTO["source"];
};

// -------------------------------------------------------------------
// WHAT AN UPLOAD ENDED AS, and the two halves are not the same thing.
//
// `transcriptionId` means a ROW exists. `started` means a Speech JOB exists.
// A caller that treats a returned id as proof of both will delete the only
// copy on the device for a recording nothing is transcribing - which is how
// a meeting is lost, since the recovery panel is the only way back.
//
// Null is the third outcome: nothing was created at all, and the reason has
// already been shown.
// -------------------------------------------------------------------
export type UploadResult = { transcriptionId: string; started: boolean } | null;

export function useTranscriptionUpload() {
  const [isUploading, setIsUploading] = useState(false);
  // 0-100, or null when nothing is in flight. Null rather than 0 so the bar
  // can be hidden entirely rather than shown sitting at zero.
  const [progress, setProgress] = useState<number | null>(null);

  // -------------------------------------------------------------------
  // Returns the new transcription's id, or null if anything went wrong -
  // in which case the reason has already been shown.
  // -------------------------------------------------------------------
  const upload = useCallback(async (request: TranscriptionUploadRequest): Promise<UploadResult> => {
    // -----------------------------------------------------------------
    // REFUSED BEFORE THE ROW IS CLAIMED, against the ceiling that is
    // actually left: what SPEECH will accept. The 256 MiB single-PUT limit
    // is gone, because the upload is in blocks now.
    //
    // Checked here rather than only on the server so that a file which can
    // never transcribe is refused before somebody waits out its upload. The
    // server checks the same limit again after the bytes land, which is the
    // first moment IT knows the size - the two are at different points on
    // purpose and neither replaces the other.
    // -----------------------------------------------------------------
    if (request.media.size > MAX_MEDIA_BYTES) {
      toast.error(
        `That file is ${Math.round(request.media.size / (1024 * 1024))} MB, and the transcription service accepts up to ${Math.round(MAX_MEDIA_BYTES / (1024 * 1024))} MB. If it is a screen recording, export the audio on its own and upload that.`,
      );

      return null;
    }

    setIsUploading(true);
    setProgress(0);

    try {
      const created = await createTranscriptionAction({
        title: request.title,
        source: request.source,
        fileName: request.fileName,
      });

      if (!created.success) {
        toast.error(created.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
        return null;
      }

      const { transcriptionId, uploadUrl, mediaType } = created.data;

      // IN BLOCKS, ALWAYS. See uploadInBlocks: one path for every upload,
      // so the code that carries a five hour workshop is the same code that
      // carried the two minute test this morning.
      await uploadInBlocks(uploadUrl, request.media, mediaType, setProgress);

      // The bytes are in storage but nothing is transcribing them yet. This
      // is the step that confirms the file actually landed - the app never
      // saw it go past - and creates the job.
      const started = await startTranscriptionAction({ transcriptionId });

      if (!started.success) {
        toast.error(started.formError ?? MESSAGES.SOMETHING_WENT_WRONG);

        // THE ROW EXISTS AND THE JOB DOES NOT, and the caller has to be able
        // to tell those apart. It used to return the id here as well as on
        // success, so a caller checking truthiness read a failed start as
        // "the server has it" and deleted the copy on the device - see
        // `started` on the result type.
        return { transcriptionId, started: false };
      }

      toast.success(MESSAGES.TRANSCRIPTION_STARTED);

      return { transcriptionId, started: true };
    } catch (error) {
      handleFrontendErrorWithToast(error);
      return null;
    } finally {
      setIsUploading(false);
      setProgress(null);
    }
  }, []);

  return { upload, isUploading, progress };
}
