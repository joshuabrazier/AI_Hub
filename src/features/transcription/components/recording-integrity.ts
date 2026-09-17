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
// IT REPAIRS RATHER THAN REFUSING WHERE IT CAN, and it keeps the LARGEST
// recording rather than the first. Which one is the meeting is a question
// of evidence, not of position: when two recorders ran at once, only the
// first chunk each emitted carried a header, so the file came out as one
// ten-second timeslice followed by the entire meeting. Keeping the first
// document kept the ten seconds and reported success.
//
// AND THE DEVICE COPY SURVIVES A REPAIR. What gets uploaded is by
// definition not the whole recording, so the copy on the device is the only
// complete thing left - see `wasRepaired` handling in the composer.
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

/** One self-contained recording inside a file that holds more than one. */
export type RecordingSegment = { start: number; end: number; bytes: number };

export type RecordingVerdict =
  /** Send it as it is. */
  | { kind: "ok"; probe: AudioProbe }
  /**
   * Send `media` instead - the file held more than one recording and this is
   * the largest of them.
   *
   * `wasRepaired` is not decoration: the caller MUST NOT discard the device
   * copy after uploading this, because what is being uploaded is by
   * definition not the whole recording.
   */
  | {
      kind: "repaired";
      probe: AudioProbe;
      media: Blob;
      message: string;
      keptBytes: number;
      droppedBytes: number;
    }
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
    // On for a recording this app made, because the double-start bug was
    // ours and the joins land wherever the recorders happened to write.
    //
    // Off for a file somebody CHOSE, where it would mean reading a
    // gigabyte through JavaScript before the upload can even begin. Such
    // a file is not left unprotected: the head probe still refuses what
    // cannot work, still REPORTS a join it can see, and the re-encode
    // after a refusal salvages what it can.
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

    const segments =
      scanForSplice && signature && probe.container
        ? await findSegments(media, probe.container, signature.bytes, signature.at)
        : [{ start: 0, end: media.size, bytes: media.size }];

    if (segments.length > 1) return repairSpliced(media, probe, segments);

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

// -------------------------------------------------------------------
// ===================================================================
// WHICH OF THE RECORDINGS IS THE MEETING?
// ===================================================================
//
// THE ANSWER IS NOT "THE FIRST ONE", and believing it was cost a real
// meeting. This repair used to truncate at the first join on the reasoning
// that a spliced file contains a perfectly good FIRST recording - true when
// somebody records two takes end to end, and exactly inverted for the shape
// our own recorder produced.
//
// When two MediaRecorders ran at once, only the first chunk each one
// emitted carried a container header. So the file came out as one
// TIMESLICE, then a header, then everything else: a ten second stub
// followed by the whole meeting. Keeping the first document kept the ten
// seconds, uploaded it, transcribed it successfully, and reported success -
// which is worse than the error it replaced, because nothing anywhere said
// that 99.85% of the meeting had been thrown away.
//
// So the largest is kept, by evidence rather than by position. At a
// constant bitrate, bytes are a sound proxy for minutes.
//
// AND THE DEVICE COPY IS NEVER DISCARDED AFTER THIS. What is uploaded is
// not the whole recording, so the copy on the device is the only complete
// thing left - see `wasRepaired` on the verdict and its use in the
// composer. The old message promised exactly that and the next line of code
// deleted it.
// -------------------------------------------------------------------
function repairSpliced(media: Blob, probe: AudioProbe, segments: RecordingSegment[]): RecordingVerdict {
  const largest = segments.reduce((best, segment) => (segment.bytes > best.bytes ? segment : best));

  const droppedBytes = media.size - largest.bytes;
  const position = segments.indexOf(largest);

  const spliced: AudioProblem = {
    code: "spliced",
    detail: `This file holds ${segments.length} separate recordings (${segments.map((segment) => formatBytes(segment.bytes)).join(", ")}).`,
    atByte: largest.start,
  };

  return {
    kind: "repaired",
    probe: { ...probe, problems: [...probe.problems, spliced] },
    // A Blob slice, so nothing is copied and the cut costs nothing whatever
    // the size. Each segment is a genuine complete container, because a
    // container header is exactly where one document ends and the next
    // begins.
    media: media.slice(largest.start, largest.end, media.type),
    keptBytes: largest.bytes,
    droppedBytes,
    // -----------------------------------------------------------------
    // SAYS WHICH PART, HOW MUCH, AND WHAT IS STILL SAFE. The old wording
    // reported bytes and then pointed at a saved copy that the next line
    // of code deleted, which is the worst combination available: a
    // reassurance that is also false.
    // -----------------------------------------------------------------
    message: [
      `That recording was saved as ${segments.length} separate takes in one file, which the transcription service cannot read.`,
      `The longest take (${formatBytes(largest.bytes)} of ${formatBytes(media.size)}${position > 0 ? ", which is not the first one" : ""}) has been sent for transcription; ${formatBytes(droppedBytes)} has not, so part of the meeting will be missing from the transcript.`,
      `Your complete recording is still on this device - save a copy before you leave this page.`,
    ].join(" "),
  };
}

/**
 * Every self-contained recording in the file, in order.
 *
 * SCANS PAST THE FIRST JOIN. It used to stop at one, which was enough to
 * know a file was spliced and not enough to know which part was the
 * meeting - and a file can hold more than two, because somebody who clicks
 * a dead-looking button twice will click it three times.
 *
 * Read in overlapping windows, because a four byte marker split across two
 * reads is invisible to both - which would report a spliced file as clean,
 * the exact failure this exists to catch.
 */
async function findSegments(
  media: Blob,
  container: string,
  signature: number[],
  signatureOffset: number,
): Promise<RecordingSegment[]> {
  const starts: number[] = [0];

  // Anything at or before the file's own header is the file's own header.
  const from = signatureOffset + signature.length;

  for (let start = 0; start < media.size; start += SCAN_WINDOW_BYTES - SCAN_OVERLAP_BYTES) {
    const end = Math.min(start + SCAN_WINDOW_BYTES, media.size);
    const window = new Uint8Array(await media.slice(start, end).arrayBuffer());

    for (let offset = 0; offset <= window.length - signature.length; offset += 1) {
      const absolute = start + offset;

      if (absolute < from) continue;
      if (!matchesAt(window, signature, offset)) continue;

      const containerAt = absolute - signatureOffset;

      // The overlap means a hit inside it is seen twice.
      if (starts.includes(containerAt)) continue;

      // A fresh, small read around the candidate. The window may end a byte
      // after the match, and validation needs the header that follows it -
      // so this asks the blob rather than hoping the window reaches.
      const context = new Uint8Array(
        await media.slice(containerAt, containerAt + VALIDATION_BYTES).arrayBuffer(),
      );

      if (looksLikeContainerStart(context, 0, container)) starts.push(containerAt);
    }

    if (end >= media.size) break;
  }

  return starts.map((start, index) => {
    const end = starts[index + 1] ?? media.size;

    return { start, end, bytes: end - start };
  });
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
