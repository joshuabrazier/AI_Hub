import "server-only";

import { getMediaInfo, readMediaRange } from "@/lib/storage/media-storage";

import {
  type AudioProbe,
  PROBE_HEAD_BYTES,
  PROBE_TAIL_BYTES,
  probeAudioBytes,
  probeMp4Tail,
} from "./audio-probe";

// -------------------------------------------------------------------
// ===================================================================
// WHAT IS IN THE BLOB WE ACTUALLY STORED?
// ===================================================================
//
// Asked at the moment a transcription fails, and it is the question nobody
// could previously answer. The row records a media type DERIVED FROM A
// FILENAME, which is a claim rather than a fact; Azure reports that the
// bytes were invalid without saying which part of them. Neither of those is
// the file. This is the file.
//
// IT IS WORTH THE TWO REQUESTS because the answers are so different in
// kind. "Your recording is a WebM containing a VP8 video track and no audio"
// ends an investigation. "InvalidData" starts one.
//
// RANGED AND BOUNDED. A meeting is hundreds of megabytes and this runs on a
// request that is already failing, so it reads a head and, where the format
// demands it, a tail - never the file. See readMediaRange.
//
// BEST EFFORT, ALWAYS. Every path returns null rather than throwing. The
// caller is reporting a failure; a diagnostic that raised its own would
// replace a bad outcome with a worse one and lose the original reason.
// -------------------------------------------------------------------
export async function probeStoredMedia(
  storageKey: string,
  // Passed by a caller that has just asked storage for it. The size is
  // otherwise read three times over on one request - once for the size
  // check, once here, once inside the ranged read - for a number that
  // cannot have changed between them.
  knownByteSize?: number | null,
): Promise<AudioProbe | null> {
  try {
    const byteSize = knownByteSize ?? (await getMediaInfo(storageKey)).byteSize;

    if (byteSize === null || byteSize === undefined) return null;

    const head = await readMediaRange(storageKey, 0, PROBE_HEAD_BYTES, byteSize);

    if (!head) return null;

    const probe = probeAudioBytes(head, { byteSize });

    // -----------------------------------------------------------------
    // An MP4 that was not written for streaming keeps its index at the END,
    // and that is the shape a phone writes - which makes it the shape of
    // the files that fail most often here. Without this second read the
    // report on a voice memo would be "MP4, and I could not see its
    // tracks", which is barely better than what Azure said.
    //
    // Only fetched when the head actually came up short, and only when
    // there is a tail to fetch that the head did not already cover.
    // -----------------------------------------------------------------
    const needsTail =
      probe.container === "MP4" &&
      probe.problems.some((problem) => problem.code === "header-not-in-range") &&
      byteSize > PROBE_HEAD_BYTES;

    if (!needsTail) return probe;

    const tailStart = Math.max(PROBE_HEAD_BYTES, byteSize - PROBE_TAIL_BYTES);
    const tail = await readMediaRange(storageKey, tailStart, PROBE_TAIL_BYTES, byteSize);

    return tail ? probeMp4Tail(probe, tail) : probe;
  } catch (error) {
    // Deliberately swallowed. See the note above: something is already
    // failing and this is extra detail, not the answer.
    console.warn(`[media] could not probe the stored recording ${storageKey}`, error);

    return null;
  }
}
