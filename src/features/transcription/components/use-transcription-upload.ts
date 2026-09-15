"use client";

import { useCallback, useState } from "react";

import { toast } from "sonner";

import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import { createTranscriptionAction, startTranscriptionAction } from "../transcription.actions";
import { MAX_MEDIA_BYTES, type CreateTranscriptionRequestDTO } from "../transcription.types";

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
// ===================================================================
// SENDING THE BYTES IN BLOCKS
// ===================================================================
//
// This replaced a single `PUT Blob`, which Azure caps at 256 MiB. That
// ceiling was reached by a real meeting: a long workshop recorded at the
// browser's default bitrate came to over 300 MB, and the upload was rejected
// after running to completion. A recording that cannot be uploaded is the
// worst outcome this feature has, because the meeting is already over and
// cannot be recorded again.
//
// ALWAYS IN BLOCKS, EVEN FOR A SMALL FILE, and that is the important
// decision. A path used only by rare large uploads is a path that is never
// exercised - so the first time it runs is the day somebody is trying to
// save a five hour workshop, which is precisely when it must not be the
// first time. One path, every recording, exercised constantly. A 5 MB file
// costs one extra request for it.
//
// THE SAS ALREADY ALLOWS THIS. It is granted "cw" on one blob: Put Block and
// Put Block List both need `w`, so nothing about the credential changes and
// it is still write-only, still one blob, still an hour.
//
// BLOCK IDS MUST ALL BE THE SAME LENGTH before base64, which Azure requires
// and which is easy to get wrong the moment a file needs more than ten
// blocks. They are padded to six digits, so the scheme holds to 999,999
// blocks - far past the 50,000 Azure allows and the 1 GiB Speech accepts.
// -------------------------------------------------------------------

// Eight megabytes, which is a compromise rather than a tuned figure. Smaller
// blocks mean more round trips on a slow connection; larger ones mean more
// to redo when one fails. Azure's own tooling defaults to this region.
const BLOCK_BYTES = 8 * 1024 * 1024;

function blockIdFor(index: number): string {
  // Fixed width, so every id is the same length once encoded. Azure rejects
  // a block list whose ids differ in length.
  return btoa(String(index).padStart(6, "0"));
}

/**
 * One request, with progress. XMLHttpRequest rather than fetch for the same
 * reason the rest of this file uses it: fetch cannot report upload progress,
 * and somebody watching a long upload with no sign of movement reloads the
 * page and loses the recording.
 */
function putWithProgress(
  url: string,
  body: Blob | string,
  headers: Record<string, string>,
  onProgress: (loaded: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("PUT", url, true);

    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    });

    xhr.addEventListener("load", () => {
      // 201 for both Put Block and Put Block List. Anything else is a
      // failure, including a 403 from a SAS that expired mid-upload - which
      // is what a transfer slower than the signed window looks like.
      if (xhr.status === 201) resolve();
      else reject(new Error(`The upload was rejected (${xhr.status}).`));
    });

    // Status 0 with an error event is a BLOCKED CROSS-ORIGIN request. The
    // browser will not say why - that is the point of the same-origin policy
    // - so there is no status and nothing to distinguish it from the network
    // being down. Named anyway, because the two fixes are different and only
    // one of them is the reader's to make.
    xhr.addEventListener("error", () =>
      reject(
        new Error(
          "The upload could not reach storage. Check your connection - and if this keeps happening, storage may not be configured to accept uploads from this site.",
        ),
      ),
    );

    xhr.addEventListener("abort", () => reject(new Error("The upload was cancelled.")));

    xhr.send(body);
  });
}

/**
 * Send `media` to `uploadUrl` as blocks, then commit them.
 *
 * `onProgress` receives 0-100 across the WHOLE file rather than per block,
 * because a bar that restarts every eight megabytes tells somebody nothing
 * about how long is left.
 */
async function uploadInBlocks(
  uploadUrl: string,
  media: Blob,
  mediaType: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  const blockIds: string[] = [];
  let completedBytes = 0;

  for (let start = 0, index = 0; start < media.size; start += BLOCK_BYTES, index += 1) {
    const block = media.slice(start, Math.min(start + BLOCK_BYTES, media.size));
    const blockId = blockIdFor(index);

    blockIds.push(blockId);

    // The SAS URL already carries a query string, so every extra parameter
    // is appended with & rather than ?.
    await putWithProgress(
      `${uploadUrl}&comp=block&blockid=${encodeURIComponent(blockId)}`,
      block,
      {},
      (loaded) => {
        // Bytes finished in earlier blocks, plus progress through this one.
        const total = completedBytes + loaded;

        onProgress(Math.min(99, Math.round((total / media.size) * 100)));
      },
    );

    completedBytes += block.size;
  }

  // -----------------------------------------------------------------
  // COMMIT. Until this lands the blocks are staged and the blob does not
  // exist - which is the property that makes a failed upload leave nothing
  // behind rather than a half file. Azure discards uncommitted blocks on its
  // own after a week.
  //
  // The blob's content type is set HERE and not on the blocks, because the
  // blocks have no type of their own: the committed blob takes what this
  // request gives it.
  // -----------------------------------------------------------------
  const blockList =
    `<?xml version="1.0" encoding="utf-8"?><BlockList>` +
    blockIds.map((id) => `<Latest>${id}</Latest>`).join("") +
    `</BlockList>`;

  await putWithProgress(
    `${uploadUrl}&comp=blocklist`,
    blockList,
    {
      "Content-Type": "application/xml",
      // The type the SERVER derived from the filename, not one the browser
      // guessed. Nothing serves these bytes back to a browser, so this is
      // for tidiness in the container rather than for safety - but there is
      // no reason to write a guess when the server has already decided.
      "x-ms-blob-content-type": mediaType,
    },
    () => {},
  );

  onProgress(100);
}

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
