import {
  type AudioProbe,
  type AudioProblem,
  describeAudioProbe,
  fatalAudioProblem,
  looksLikeContainerStart,
  PROBE_HEAD_BYTES,
  probeAudioBytes,
} from "@/lib/media/audio-probe";

// -------------------------------------------------------------------
// ===================================================================
// IS THIS RECORDING FIT TO SEND, AND CAN IT BE MENDED IF NOT?
// ===================================================================
//
// Checked in the browser, on the bytes, before anything is uploaded. That
// placement is the whole value: the device has the file, the CPU and no
// network cost, so a malformed recording is caught in milliseconds rather
// than after an upload, a Speech job and a wait - which is how every one of
// these was found until now.
//
// WHAT IT KNOWS comes from audio-probe.ts, which is shared with the server
// so that the answer before an upload and the answer after a failure are
// produced by the same code. Two sniffers would drift, and the day they
// disagreed would be the day somebody needed them to agree.
//
// WHAT THIS ADDS is the two things the probe deliberately does not do:
// scanning the WHOLE file for a second container, and repairing one.
//
// THE FULL SCAN IS CHUNKED. A splice puts the second header wherever the
// first recording happened to end, which on a real meeting is tens of
// megabytes in - so the whole file has to be looked at, and reading a
// 500 MB recording into one array to do it would be worse than the fault.
// It is read in windows with an overlap, because a four byte marker split
// across two windows is invisible to both.
//
// IT REPAIRS RATHER THAN REFUSING WHERE IT CAN. A spliced file contains a
// perfectly good first recording; truncating at the second header recovers
// it. Half a meeting is worth a great deal more than an error message, and
// the person is told exactly what was kept and what was not.
//
// IT REFUSES ONLY WHAT CANNOT WORK. A container it does not recognise is
// passed straight through - the probe knows six formats and the upload
// accepts more - because refusing a file that would have transcribed
// perfectly is the one outcome worse than a slow failure.
// -------------------------------------------------------------------

/** The signatures a second copy of which means two recordings in one file. */
const CONTAINER_SIGNATURES: Record<string, { bytes: number[]; at: number }> = {
  WebM: { bytes: [0x1a, 0x45, 0xdf, 0xa3], at: 0 },
  MP4: { bytes: [0x66, 0x74, 0x79, 0x70], at: 4 },
};

/** 8 MB at a time, with enough overlap that no signature can fall between two windows. */
const SCAN_WINDOW_BYTES = 8 * 1024 * 1024;
const SCAN_OVERLAP_BYTES = 8;

// Enough to hold an EBML header through its DocType, or an ftyp box whole.
const VALIDATION_BYTES = 1024;

export type RecordingVerdict =
  /** Send it as it is. */
  | { kind: "ok"; probe: AudioProbe }
  /** Send `media` instead - the original had a second recording stuck on the end. */
  | { kind: "repaired"; probe: AudioProbe; media: Blob; message: string }
  /** Do not send it. `message` says exactly why, in terms somebody can act on. */
  | { kind: "refused"; probe: AudioProbe; message: string };

/**
 * Look at a recording and decide what to do with it.
 *
 * Never throws: a diagnostic that fails must not take the upload with it,
 * so anything unexpected ends as `ok` and the service gets its turn.
 */
export async function inspectRecording(
  media: Blob,
  options: {
    // -------------------------------------------------------------
    // WHOLE-FILE SCAN, OR JUST THE HEAD.
    //
    // On for a recording this app made, because the double-start bug is
    // ours and the join lands wherever the first take happened to end.
    //
    // Off for a file somebody CHOSE, where it would mean reading a
    // gigabyte through JavaScript before the upload can even begin, to
    // look for a fault that arrives with our own recorder. Such a file is
    // not left unprotected: the head probe still refuses what cannot
    // work, and a join that slips through is caught by the re-encode after
    // Azure refuses it - the browser's decoder reads the first stream and
    // produces exactly the repair this would have made.
    // -------------------------------------------------------------
    scanForSplice?: boolean;
  } = {},
): Promise<RecordingVerdict> {
  const { scanForSplice = true } = options;

  try {
    const head = new Uint8Array(await media.slice(0, PROBE_HEAD_BYTES).arrayBuffer());

    const probe = probeAudioBytes(head, { byteSize: media.size });

    // ---------------------------------------------------------------
    // The splice scan, which only happens for a container whose header is
    // distinctive enough to find reliably. Scanning a format whose
    // signature is short or common would report joins that are not there,
    // and a false positive here TRUNCATES somebody's meeting.
    // ---------------------------------------------------------------
    const signature = probe.container ? CONTAINER_SIGNATURES[probe.container] : undefined;

    const secondAt =
      scanForSplice && signature && probe.container
        ? await findSecondContainer(media, probe.container, signature.bytes, signature.at)
        : -1;

    if (secondAt > 0) {
      const cutAt = secondAt - signature!.at;

      const spliced: AudioProblem = {
        code: "spliced",
        detail: `This was saved as more than one take in a single file, which no transcription service can read.`,
        atByte: cutAt,
      };

      return {
        kind: "repaired",
        probe: { ...probe, problems: [...probe.problems, spliced] },
        // A Blob slice, so nothing is copied and the cut costs nothing
        // whatever the size. The result is a genuine, complete container -
        // not a truncated one - because the second header marks exactly
        // where the first document ended.
        media: media.slice(0, cutAt, media.type),
        message: `That recording was saved as separate takes in one file, which the transcription service cannot read. The first ${formatBytes(cutAt)} of it will be transcribed; the rest is in the saved copy only.`,
      };
    }

    // The list itself lives in audio-probe.ts, so the browser and the
    // server refuse exactly the same things.
    const fatal = fatalAudioProblem(probe);

    // The description goes with the refusal, because "this file has no
    // audio track" invites "are you sure?" and "MP4, H.264 video, about 3
    // minutes, 44 MB" answers it.
    if (fatal) {
      return {
        kind: "refused",
        probe,
        message: probe.container ? `${fatal.detail} ${describeAudioProbe(probe)}` : fatal.detail,
      };
    }

    return { kind: "ok", probe };
  } catch {
    // Reading the bytes failed - a revoked object URL, a file the device
    // moved. Not a reason to refuse an upload that might work.
    return {
      kind: "ok",
      probe: probeAudioBytes(new Uint8Array(0), { byteSize: media.size }),
    };
  }
}

/**
 * Where a second container actually starts, or -1.
 *
 * TWO SEPARATE JOBS, and conflating them is how this cuts a meeting in
 * half. The scan finds four matching bytes; the VALIDATION decides whether
 * they are a file beginning. A 500 MB recording contains a chance match
 * roughly one time in eight, and the caller truncates on a yes - so the
 * signature alone is nowhere near enough evidence.
 *
 * Read in overlapping windows, because a four byte marker split across two
 * reads is invisible to both - which would report a spliced file as clean,
 * the exact failure this exists to catch.
 */
async function findSecondContainer(
  media: Blob,
  container: string,
  signature: number[],
  signatureOffset: number,
): Promise<number> {
  // Anything at or before the file's own header is the file's own header.
  const from = signatureOffset + signature.length;

  for (let start = 0; start < media.size; start += SCAN_WINDOW_BYTES - SCAN_OVERLAP_BYTES) {
    const end = Math.min(start + SCAN_WINDOW_BYTES, media.size);
    const window = new Uint8Array(await media.slice(start, end).arrayBuffer());

    for (let offset = 0; offset <= window.length - signature.length; offset += 1) {
      const absolute = start + offset;

      if (absolute < from) continue;
      if (!matchesAt(window, signature, offset)) continue;

      // A fresh, small read around the candidate. The window may end a byte
      // after the match, and validation needs the header that follows it -
      // so this asks the blob rather than hoping the window reaches.
      const containerAt = absolute - signatureOffset;
      const context = new Uint8Array(
        await media.slice(containerAt, containerAt + VALIDATION_BYTES).arrayBuffer(),
      );

      if (looksLikeContainerStart(context, 0, container)) return absolute;
    }

    if (end >= media.size) break;
  }

  return -1;
}

function matchesAt(bytes: Uint8Array, signature: number[], at: number): boolean {
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[at + i] !== signature[i]) return false;
  }

  return true;
}

/**
 * The probe's findings as a sentence, for a message to somebody waiting.
 *
 * Re-exported rather than imported directly by the components so that the
 * feature has one place to reach for this, and the shared module stays a
 * dependency of this file rather than of every component.
 */
export function describeRecording(probe: AudioProbe): string {
  return describeAudioProbe(probe);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
