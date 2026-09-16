// -------------------------------------------------------------------
// ===================================================================
// IS THIS RECORDING ACTUALLY ONE RECORDING?
// ===================================================================
//
// Checked in the browser, on the bytes, before anything is uploaded. That
// placement is the whole value: the device has the file, the CPU and no
// network cost, so a malformed recording is caught in milliseconds rather
// than after an upload, a Speech job and a wait - which is how every one of
// these was found until now.
//
// WHAT GOES WRONG, and it is not hypothetical. Two MediaRecorders running at
// once concatenate two independent streams into one file, so there is a
// second container header partway through. A tolerant player reads the first
// stream and stops, which is why such a file "plays fine" and why that
// reassurance sent four separate investigations down the wrong path. A strict
// decoder reaches the second header, finds a new document where a cluster
// should be, and reports that it cannot detect the format.
//
// The re-entry guard in transcription-recorder.tsx stops that happening. This
// is the belt to its braces, and it earns its place for two reasons beyond
// that bug: a file recovered from IndexedDB may have been written by an older
// build with no guard in it, and a chunk store that dropped its first record
// produces a file with no header at all.
//
// IT REPAIRS RATHER THAN REFUSING WHERE IT CAN. A spliced file contains a
// perfectly good first recording; truncating at the second header recovers
// it. Half a meeting is worth a great deal more than an error message, and
// the person is told exactly what was kept and what was not.
// -------------------------------------------------------------------

/**
 * The bytes a container starts with, and where they sit.
 *
 * `at` is the offset within the file at which this signature legitimately
 * appears - zero for WebM's EBML marker, four for MP4's `ftyp`, which follows
 * a length prefix. A signature found anywhere else is a second document.
 */
const CONTAINERS = [
  { name: "WebM", bytes: [0x1a, 0x45, 0xdf, 0xa3], at: 0 },
  { name: "MP4", bytes: [0x66, 0x74, 0x79, 0x70], at: 4 },
] as const;

export type RecordingIntegrity =
  /** One container, where it belongs. Nothing to do. */
  | { kind: "ok" }
  /**
   * Two or more recordings concatenated. `keepBytes` is the length of the
   * first one, which is a complete and playable file on its own.
   */
  | { kind: "spliced"; container: string; streams: number; keepBytes: number }
  /**
   * No container marker at the start. Usually a file whose first chunk was
   * never written, which no decoder can read - there is nothing to repair
   * because the part that says what the file IS is the part that is missing.
   */
  | { kind: "headerless" }
  /**
   * Not a container this knows. NOT an error: the upload accepts formats this
   * list does not cover, and refusing them here would reject files that work.
   */
  | { kind: "unknown" };

function matchesAt(bytes: Uint8Array, signature: readonly number[], offset: number): boolean {
  if (offset + signature.length > bytes.length) return false;

  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false;
  }

  return true;
}

/**
 * Where a signature appears, scanning the whole buffer.
 *
 * Deliberately not stopping at the second hit. A file spliced three times is
 * possible - three clicks - and the count is worth reporting honestly.
 */
function offsetsOf(bytes: Uint8Array, signature: readonly number[]): number[] {
  const found: number[] = [];

  for (let offset = 0; offset <= bytes.length - signature.length; offset += 1) {
    if (matchesAt(bytes, signature, offset)) found.push(offset);
  }

  return found;
}

/**
 * Inspect already-read bytes. Exported separately from the Blob version so
 * the decision is testable without a browser.
 */
export function inspectRecordingBytes(bytes: Uint8Array): RecordingIntegrity {
  for (const container of CONTAINERS) {
    if (!matchesAt(bytes, container.bytes, container.at)) continue;

    const offsets = offsetsOf(bytes, container.bytes);

    // The one at `at` is the real header; anything after it starts another
    // document. A marker BEFORE it cannot happen for WebM, and for MP4 would
    // be inside the length prefix, so only later ones count.
    const extra = offsets.filter((offset) => offset > container.at);

    if (extra.length === 0) return { kind: "ok" };

    return {
      kind: "spliced",
      container: container.name,
      streams: extra.length + 1,
      // Up to the start of the second document. For MP4 the marker sits four
      // bytes into its own box, so the cut is four bytes earlier.
      keepBytes: extra[0] - container.at,
    };
  }

  // Nothing matched at the start. If a known marker appears LATER, the file
  // began part way through a stream - the case where chunk zero was lost.
  for (const container of CONTAINERS) {
    if (offsetsOf(bytes, container.bytes).length > 0) return { kind: "headerless" };
  }

  return { kind: "unknown" };
}

/**
 * How much of the file to read.
 *
 * A second header lands where the first recording ended, which for a real
 * meeting is far beyond any fixed window - so this reads the WHOLE file. It
 * is already in memory: the Blob was just assembled from chunks that were in
 * memory, and the upload is about to stream it anyway.
 */
export async function inspectRecording(media: Blob): Promise<RecordingIntegrity> {
  const bytes = new Uint8Array(await media.arrayBuffer());

  return inspectRecordingBytes(bytes);
}

/**
 * The first complete recording out of a spliced file.
 *
 * A Blob slice, so nothing is copied and the cut costs nothing whatever the
 * size. The result is a genuine, complete container - not a truncated one -
 * because the second header marks exactly where the first document ended.
 */
export function firstStreamOf(media: Blob, integrity: RecordingIntegrity): Blob {
  if (integrity.kind !== "spliced") return media;

  return media.slice(0, integrity.keepBytes, media.type);
}
