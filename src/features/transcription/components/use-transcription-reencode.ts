"use client";

import { useCallback, useState } from "react";

import { toast } from "sonner";

import { MESSAGES } from "@/lib/constants";
import { handleFrontendErrorWithToast } from "@/lib/handle-errors";

import {
  finishTranscriptionMediaReplacementAction,
  replaceTranscriptionMediaAction,
} from "../transcription.actions";
import { MAX_MEDIA_BYTES, type TranscriptionDetailDTO } from "../transcription.types";
import { convertToWav } from "./audio-convert";
import { uploadInBlocks } from "./blob-upload";

// -------------------------------------------------------------------
// ===================================================================
// THE SECOND RUNG: CONVERT IT AND TRY AGAIN
// ===================================================================
//
// When the transcription service downloads a recording and cannot decode
// it, handing it the same bytes again cannot work - and that is exactly
// what "Try again" did. This is the thing to do instead: fetch the file
// back, re-encode it into the format the service documents first, put that
// in its place and start a new job.
//
// WHY 16 kHz MONO PCM WAV AND NOTHING ELSE. It is the top of Azure's
// documented list and it is the format with no codec in it at all - the
// bytes are the samples. There is no third format worth trying after it: if
// the service refuses uncompressed PCM, the problem is not the container or
// the codec, and cycling through MP3 and FLAC would spend somebody's
// afternoon proving that. So the ladder is honest and short - as recorded,
// then as PCM - rather than long and theatrical.
//
// WHY THE BROWSER DOES THE WORK. ffmpeg is not on the App Service Node
// runtime, so a server-side re-encode would mean a custom container or a
// separate Function App. The device can already do it, and the file it
// sends is usually far smaller than the one it fetched.
//
// WHAT IT COSTS, SAID PLAINLY. Decoding holds the whole meeting in memory
// as samples, so this is a minute or two of a laptop working hard on a long
// recording, and it is refused outright past three hours (see
// audio-convert.ts). That is why it is a second rung and not the first one.
//
// A FAILURE HERE IS INFORMATION, NOT JUST A FAILURE. If this browser cannot
// decode the file either, then two independent decoders have refused it and
// the recording itself is damaged - which is a far more useful thing to
// tell somebody than Azure's sentence about a URI.
// -------------------------------------------------------------------

/** What it is doing, for a line of text somebody can watch. */
export type ReencodeStage = "fetching" | "converting" | "uploading" | "starting" | null;

export const REENCODE_STAGE_LABELS: Record<NonNullable<ReencodeStage>, string> = {
  fetching: "Fetching the recording",
  converting: "Converting the audio - this can take a minute on a long meeting",
  uploading: "Uploading the converted recording",
  starting: "Starting the transcription again",
};

export function useTranscriptionReencode() {
  const [stage, setStage] = useState<ReencodeStage>(null);
  // 0-100 during the upload only. Converting has no progress to report -
  // decodeAudioData is one call that returns when it is done - so the label
  // says so rather than showing a bar that does not move.
  const [progress, setProgress] = useState<number | null>(null);

  const reencode = useCallback(
    async (transcriptionId: string): Promise<TranscriptionDetailDTO | null> => {
      setStage("fetching");
      setProgress(null);

      try {
        // The same route the Recording button uses, so it is the session
        // check and the ownership check that already guard it. A failed row
        // keeps its media precisely so this is possible.
        const response = await fetch(`/api/transcription/${transcriptionId}/media`, {
          cache: "no-store",
        });

        if (!response.ok) {
          toast.error(
            response.status === 404
              ? "That recording is no longer stored, so there is nothing left to convert."
              : "The recording could not be fetched to convert.",
          );

          return null;
        }

        const original = await response.blob();

        setStage("converting");

        // Named without an extension on purpose: convertToWav replaces it,
        // and the server derives the media type from the name it is given.
        const converted = await convertToWav(new File([original], "recording", { type: original.type }));

        if (!converted.converted) {
          toast.error(reasonForFailedConversion(converted.reason));

          return null;
        }

        // -------------------------------------------------------------
        // REFUSED HERE RATHER THAN AFTER THE UPLOAD. PCM is uncompressed -
        // roughly 115 MB an hour - so a long meeting that was well under
        // the ceiling as Opus can be over it as WAV. The server checks this
        // again when the bytes land, and deliberately refuses there without
        // touching the original; this check just saves the wait.
        // -------------------------------------------------------------
        if (converted.file.size > MAX_MEDIA_BYTES) {
          toast.error(
            `Converted, that recording comes to ${Math.round(converted.file.size / (1024 * 1024))} MB, which is over the ${Math.round(MAX_MEDIA_BYTES / (1024 * 1024))} MB the transcription service accepts. Your original recording is untouched.`,
          );

          return null;
        }

        const ticket = await replaceTranscriptionMediaAction({
          transcriptionId,
          fileName: converted.file.name,
        });

        if (!ticket.success) {
          toast.error(ticket.formError ?? MESSAGES.SOMETHING_WENT_WRONG);

          return null;
        }

        setStage("uploading");
        setProgress(0);

        // The same block upload a first upload uses, and for the same
        // reason - one path, exercised by every transfer.
        await uploadInBlocks(ticket.data.uploadUrl, converted.file, ticket.data.mediaType, setProgress);

        setStage("starting");
        setProgress(null);

        // Until this lands the row still points at the original, so a
        // failure here leaves the person exactly where they were.
        const finished = await finishTranscriptionMediaReplacementAction({
          transcriptionId,
          fileName: converted.file.name,
        });

        if (!finished.success) {
          toast.error(finished.formError ?? MESSAGES.SOMETHING_WENT_WRONG);

          return null;
        }

        toast.success("Converted and sent for transcription again.");

        return finished.data;
      } catch (error) {
        handleFrontendErrorWithToast(error);

        return null;
      } finally {
        setStage(null);
        setProgress(null);
      }
    },
    [],
  );

  return { reencode, stage, progress, isReencoding: stage !== null };
}

// -------------------------------------------------------------------
// Why it could not convert, in terms of what to do about it.
//
// "unsupported" and "failed" are genuinely different situations: one is
// this browser lacking a decoder, which another browser may have, and the
// other is two decoders in a row refusing the file, which says the
// recording is damaged.
// -------------------------------------------------------------------
function reasonForFailedConversion(reason: "not-needed" | "unsupported" | "too-long" | "failed"): string {
  switch (reason) {
    case "unsupported":
      return "This browser cannot convert audio. Try again in Chrome or Edge on a computer.";
    case "too-long":
      return "That recording is too long to convert in a browser. Download it and convert it to WAV or MP3 on your computer, then upload that.";
    default:
      return "This browser could not read that recording either, which means the file itself is damaged rather than just in an awkward format. Download it and see whether anything will play it.";
  }
}
