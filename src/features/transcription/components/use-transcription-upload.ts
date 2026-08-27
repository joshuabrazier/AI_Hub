"use client";

import { useCallback, useState } from "react";

import { toast } from "sonner";

import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { createTranscriptionAction, startTranscriptionAction } from "../transcription.actions";
import type { CreateTranscriptionRequestDTO } from "../transcription.types";

// -------------------------------------------------------------------
// useTranscriptionUpload
//
// The three-step dance that gets media from the browser to a running
// transcription job, in one place because BOTH ways in need it: uploading a
// file and finishing a recording differ only in where the bytes came from.
//
//   1. claim a row and get a write-only URL   (server action)
//   2. PUT the bytes straight to blob storage (never through the app)
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

// Azure requires this on a PUT to say what kind of blob is being created.
// Without it the request is rejected outright.
const BLOB_TYPE_HEADER = "x-ms-blob-type";

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

export function useTranscriptionUpload() {
  const [isUploading, setIsUploading] = useState(false);
  // 0-100, or null when nothing is in flight. Null rather than 0 so the bar
  // can be hidden entirely rather than shown sitting at zero.
  const [progress, setProgress] = useState<number | null>(null);

  // -------------------------------------------------------------------
  // Returns the new transcription's id, or null if anything went wrong -
  // in which case the reason has already been shown.
  // -------------------------------------------------------------------
  const upload = useCallback(async (request: TranscriptionUploadRequest): Promise<string | null> => {
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

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.open("PUT", uploadUrl, true);
        xhr.setRequestHeader(BLOB_TYPE_HEADER, "BlockBlob");
        // The type the SERVER derived from the filename, not one the
        // browser guessed. Nothing serves these bytes back, so this is for
        // tidiness in the container rather than for safety - but there is
        // no reason to write the browser's guess when the server has
        // already decided.
        xhr.setRequestHeader("Content-Type", mediaType);

        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            setProgress(Math.round((event.loaded / event.total) * 100));
          }
        });

        xhr.addEventListener("load", () => {
          // Azure answers 201 on a successful create. Anything else is a
          // failure, including a 403 from a SAS that has expired - which is
          // what an upload slower than the signed window looks like.
          if (xhr.status === 201) resolve();
          else reject(new Error(`The upload was rejected (${xhr.status}).`));
        });

        // Status 0 with an error event is what a BLOCKED CROSS-ORIGIN
        // request looks like from here. The browser refuses to tell a page
        // why - that is the point of the same-origin policy - so there is
        // no status, no headers, and nothing distinguishing it from the
        // network being down. It is named anyway, because the two fixes are
        // completely different and only one of them is the reader's to make:
        // a dropped connection is theirs, a missing CORS rule on the
        // storage account is an administrator's. The real reason is printed
        // in the browser console by the browser itself.
        xhr.addEventListener("error", () =>
          reject(
            new Error(
              "The upload could not reach storage. Check your connection - and if this keeps happening, storage may not be configured to accept uploads from this site.",
            ),
          ),
        );
        // Fired when the page navigates away mid-transfer. Rejecting rather
        // than hanging means the row is left in "Uploading" and can be
        // retried, instead of a promise nothing ever settles.
        xhr.addEventListener("abort", () => reject(new Error("The upload was cancelled.")));

        xhr.send(request.media);
      });

      // The bytes are in storage but nothing is transcribing them yet. This
      // is the step that confirms the file actually landed - the app never
      // saw it go past - and creates the job.
      const started = await startTranscriptionAction({ transcriptionId });

      if (!started.success) {
        toast.error(started.formError ?? MESSAGES.SOMETHING_WENT_WRONG);
        // The row still exists, sitting in "Uploading", and the person can
        // retry it from the list rather than losing the recording.
        return transcriptionId;
      }

      toast.success(MESSAGES.TRANSCRIPTION_STARTED);

      return transcriptionId;
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
