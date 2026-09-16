// -------------------------------------------------------------------
// ===================================================================
// WHAT IS THIS FILE, ACTUALLY?
// ===================================================================
//
// "InvalidData: The audio format is invalid or cannot be detected" is a
// true sentence that helps nobody. It is what Azure says when it downloaded
// the bytes and could not make audio of them, and it is the same sentence
// whether the file is two recordings joined together, a container with no
// audio track in it, a video the microphone never reached, or forty
// megabytes of nothing.
//
// Those need different answers, and the bytes say which. So this reads the
// file itself and reports what is in it: the container, the codec, the
// channel count, the sample rate, the duration, and anything structurally
// wrong. The failure message then says what the file IS, next to what the
// service said about it.
//
// PURE AND ISOMORPHIC ON PURPOSE. The same function runs in the browser on
// the blob before it is uploaded, and on the server against the first slice
// of the stored blob when a job fails. Those two answers disagreeing is
// itself a finding - it means what arrived is not what was sent.
//
// IT READS A SLICE, NOT A FILE. Container headers live at the very start,
// so a few hundred kilobytes answers almost everything without pulling a
// meeting into memory. `byteSize` carries the real length so the report can
// distinguish "the file ends here" from "my window ends here" - a
// distinction that decides whether truncation can be claimed at all.
//
// IT NEVER THROWS. Every parser here is walking attacker-shaped data - a
// length field can say anything - and this runs while something is already
// failing. A diagnostic that crashes turns a bad outcome into a worse one,
// so every read is bounds-checked and an unparseable structure becomes a
// finding rather than an exception.
// -------------------------------------------------------------------

export type AudioProblemCode =
  /** Nothing at all. An upload that committed zero bytes. */
  | "empty"
  /** Too small to hold a container header, let alone audio. */
  | "too-short"
  /** No signature this knows, at the start or anywhere in the window. */
  | "unknown-container"
  /** A known signature appears, but not at the start - the beginning is missing. */
  | "headerless"
  /** Two or more complete files joined end to end. */
  | "spliced"
  /** A container this could read, with no audio track declared in it. */
  | "no-audio-track"
  /** Tracks were found and every one of them is video. */
  | "video-only"
  /** A length field promises more bytes than the file has. */
  | "truncated"
  /** The part that would answer this is outside the window that was read. */
  | "header-not-in-range"
  /** The container is recognised and its internals did not parse. */
  | "unreadable-structure";

export type AudioProblem = {
  code: AudioProblemCode;
  /** One sentence, written for the person who has to act on it. */
  detail: string;
  // -----------------------------------------------------------------
  // Where in the file the problem is, when that is a number rather than a
  // description. Present on `spliced`, where it is the exact byte the
  // second recording starts at - which is also the length of the first
  // one, and therefore where to cut to recover it.
  //
  // Structured as well as described because a caller REPAIRS from this. A
  // sentence with an offset in it is for a person; a repair needs the
  // number, and parsing it back out of prose is how the two drift apart.
  // -----------------------------------------------------------------
  atByte?: number;
};

export type AudioProbe = {
  /** The whole file's length, when the caller knows it. Null when only a slice was ever available. */
  byteSize: number | null;
  /** How much was actually looked at. */
  inspectedBytes: number;
  /** Whether the slice IS the file. Truncation cannot be claimed when it is not. */
  isComplete: boolean;
  /** "WebM", "MP4", "WAV", "MP3", "Ogg", "FLAC", or null. */
  container: string | null;
  /** The container's own self-description: a DocType, a brand, a format tag. */
  containerDetail: string | null;
  audioCodec: string | null;
  channels: number | null;
  sampleRate: number | null;
  bitsPerSample: number | null;
  durationSeconds: number | null;
  // -----------------------------------------------------------------
  // WHETHER THE DURATION WAS READ OR GUESSED.
  //
  // MP3 carries no length: it is derived from the file size and one
  // frame's bitrate, which is wrong for every variable-bitrate file - and
  // most are. Harmless in a sentence somebody reads; NOT harmless when a
  // caller refuses a recording for exceeding a length limit, which is a
  // decision that has to rest on a fact.
  // -----------------------------------------------------------------
  durationIsEstimated: boolean;
  trackCount: number | null;
  hasAudioTrack: boolean | null;
  problems: AudioProblem[];
};

// -------------------------------------------------------------------
// How much of a file is worth reading to answer all this.
//
// WebM and Ogg put their headers first, so a few kilobytes does it. MP4 is
// the reason this is not a few kilobytes: a file not written for streaming
// keeps its moov box - the codec, the duration, the tracks - at the END,
// and a phone writes exactly that shape. 512 KB covers the head of any of
// them, and the caller reads a tail separately where it matters.
// -------------------------------------------------------------------
export const PROBE_HEAD_BYTES = 512 * 1024;

/** Enough to catch an MP4 whose moov box sits after the audio. */
export const PROBE_TAIL_BYTES = 512 * 1024;

const EMPTY_PROBE: Omit<AudioProbe, "byteSize" | "inspectedBytes" | "isComplete" | "problems"> = {
  container: null,
  containerDetail: null,
  audioCodec: null,
  channels: null,
  sampleRate: null,
  bitsPerSample: null,
  durationSeconds: null,
  durationIsEstimated: false,
  trackCount: null,
  hasAudioTrack: null,
};

// -------------------------------------------------------------------
// Bounds-checked readers.
//
// Every one returns null past the end rather than NaN or undefined, so a
// truncated file produces missing facts instead of nonsense ones. A probe
// that confidently reports a sample rate of 3.4 billion is worse than one
// that says it could not tell.
// -------------------------------------------------------------------
function u8(bytes: Uint8Array, at: number): number | null {
  return at >= 0 && at < bytes.length ? bytes[at] : null;
}

function u16be(bytes: Uint8Array, at: number): number | null {
  if (at < 0 || at + 2 > bytes.length) return null;

  return (bytes[at] << 8) | bytes[at + 1];
}

function u32be(bytes: Uint8Array, at: number): number | null {
  if (at < 0 || at + 4 > bytes.length) return null;

  // >>> 0 because a top bit set would otherwise make this negative, and a
  // negative box size sends a walker backwards forever.
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function u16le(bytes: Uint8Array, at: number): number | null {
  if (at < 0 || at + 2 > bytes.length) return null;

  return bytes[at] | (bytes[at + 1] << 8);
}

function u32le(bytes: Uint8Array, at: number): number | null {
  if (at < 0 || at + 4 > bytes.length) return null;

  return ((bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0);
}

function ascii(bytes: Uint8Array, at: number, length: number): string | null {
  if (at < 0 || at + length > bytes.length) return null;

  let out = "";

  for (let i = 0; i < length; i += 1) out += String.fromCharCode(bytes[at + i]);

  return out;
}

function matchesAt(bytes: Uint8Array, signature: readonly number[], at: number): boolean {
  if (at < 0 || at + signature.length > bytes.length) return false;

  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[at + i] !== signature[i]) return false;
  }

  return true;
}

function indexOfSignature(bytes: Uint8Array, signature: readonly number[], from: number): number {
  for (let at = from; at <= bytes.length - signature.length; at += 1) {
    if (matchesAt(bytes, signature, at)) return at;
  }

  return -1;
}

const asciiBytes = (text: string): number[] => Array.from(text, (character) => character.charCodeAt(0));

// -------------------------------------------------------------------
// The probe itself.
// -------------------------------------------------------------------
export function probeAudioBytes(
  bytes: Uint8Array,
  options: { byteSize?: number | null } = {},
): AudioProbe {
  const byteSize = options.byteSize ?? null;
  const isComplete = byteSize === null ? true : bytes.length >= byteSize;

  const base: AudioProbe = {
    ...EMPTY_PROBE,
    byteSize,
    inspectedBytes: bytes.length,
    isComplete,
    problems: [],
  };

  if (bytes.length === 0) {
    return {
      ...base,
      problems: [
        {
          code: "empty",
          detail: "The file is empty - nothing was stored, so there is nothing to transcribe.",
        },
      ],
    };
  }

  // Sixteen bytes is smaller than every container signature plus the fields
  // immediately after it. Nothing useful can be said below that.
  if (bytes.length < 16) {
    return {
      ...base,
      problems: [
        {
          code: "too-short",
          detail: `The file is only ${bytes.length} bytes, which is far too small to be a recording.`,
        },
      ],
    };
  }

  // Ordered by how cheap and how certain the signature is. Each returns
  // null when its signature is absent, so the first match wins.
  const probe =
    probeWebm(bytes, base) ??
    probeMp4(bytes, base) ??
    probeWav(bytes, base) ??
    probeOgg(bytes, base) ??
    probeFlac(bytes, base) ??
    probeMp3(bytes, base);

  if (probe) return probe;

  // Nothing matched at the start. If a signature turns up LATER, the
  // beginning of the file is missing - which is a different fault from an
  // unrecognised format and has a different answer.
  const orphan = findLateSignature(bytes);

  if (orphan) {
    return {
      ...base,
      problems: [
        {
          code: "headerless",
          detail: `The file does not start with a recognisable header, but a ${orphan.container} header appears ${formatBytes(orphan.at)} in. The beginning of the recording was not saved, and nothing can read a file whose header is missing.`,
        },
      ],
    };
  }

  return {
    ...base,
    problems: [
      {
        code: "unknown-container",
        detail: `The file does not begin with any audio or video format this recognises (its first bytes are ${hexPreview(bytes, 12)}). It may not be a media file at all.`,
      },
    ],
  };
}

const LATE_SIGNATURES = [
  { container: "WebM", bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  { container: "MP4", bytes: asciiBytes("ftyp") },
  { container: "Ogg", bytes: asciiBytes("OggS") },
  { container: "WAV", bytes: asciiBytes("RIFF") },
  { container: "FLAC", bytes: asciiBytes("fLaC") },
] as const;

// -------------------------------------------------------------------
// A container header sitting somewhere OTHER than the start.
//
// VALIDATED, FOR THE SAME REASON THE SPLICE SCAN IS. `headerless` is
// fatal - the file is refused in the browser and never uploaded - and it
// fires on files this module does not parse at offset zero, which includes
// formats Azure Speech documents and accepts: AMR, WMA, raw AAC, Speex.
// Five four-byte patterns across a 512 KB window collide by chance about
// once in every sixteen hundred such files, and each collision was a
// recording refused with "the beginning was not saved" when nothing of the
// kind had happened.
//
// So a late signature now has to survive the same test a splice candidate
// does: it must look like a real file beginning, not like four familiar
// bytes.
// -------------------------------------------------------------------
function findLateSignature(bytes: Uint8Array): { container: string; at: number } | null {
  for (const signature of LATE_SIGNATURES) {
    for (let at = 1; at <= bytes.length - signature.bytes.length; at += 1) {
      if (!matchesAt(bytes, signature.bytes, at)) continue;

      const containerAt = signature.container === "MP4" ? at - 4 : at;

      if (containerAt > 0 && looksLikeContainerStart(bytes, containerAt, signature.container)) {
        return { container: signature.container, at: containerAt };
      }
    }
  }

  return null;
}

// ===================================================================
// WebM / Matroska
//
// EBML is a tree of (id, size, payload) where both id and size are
// variable-length integers, so nothing can be read at a fixed offset -
// every element has to be walked to. The rules that matter:
//
//   - the length of a VINT is given by its LEADING ZEROS: the first set bit
//     marks the end of the length prefix, so 0x1A (00011010) starts a
//     four-byte value.
//   - an element ID keeps its marker bits; an element SIZE has them
//     stripped. Treating them alike is the classic way to mis-parse this.
//   - a size of all ones means UNKNOWN, which is not corruption: it is what
//     MediaRecorder writes for its Segment, because a live recording does
//     not know its own length. A parser that rejects it rejects every
//     recording this app makes.
// ===================================================================

const EBML_HEADER = [0x1a, 0x45, 0xdf, 0xa3];

const EBML_IDS = {
  header: 0x1a45dfa3,
  docType: 0x4282,
  segment: 0x18538067,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  duration: 0x4489,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackType: 0x83,
  codecId: 0x86,
  audio: 0xe1,
  samplingFrequency: 0xb5,
  // What the DECODER outputs, which for Opus is the only honest answer -
  // SamplingFrequency beside it always reads 48000 because that is what
  // Opus is defined at, whatever the microphone did.
  outputSamplingFrequency: 0x78b5,
  channels: 0x9f,
  bitDepth: 0x6264,
  cluster: 0x1f43b675,
} as const;

/** Elements whose payload is more elements, so the walker descends rather than skipping. */
const EBML_MASTERS = new Set<number>([
  EBML_IDS.header,
  EBML_IDS.segment,
  EBML_IDS.info,
  EBML_IDS.tracks,
  EBML_IDS.trackEntry,
  EBML_IDS.audio,
]);

type Vint = { value: number; length: number };

/** An element ID, which keeps its marker bits. */
function readElementId(bytes: Uint8Array, at: number): Vint | null {
  const first = u8(bytes, at);

  if (first === null || first === 0) return null;

  let length = 1;

  while (length <= 4 && (first & (0x80 >> (length - 1))) === 0) length += 1;

  if (length > 4 || at + length > bytes.length) return null;

  let value = 0;

  for (let i = 0; i < length; i += 1) value = value * 256 + bytes[at + i];

  return { value, length };
}

/** An element size, whose marker bit is stripped. -1 means "unknown", which is legal. */
function readElementSize(bytes: Uint8Array, at: number): Vint | null {
  const first = u8(bytes, at);

  if (first === null || first === 0) return null;

  let length = 1;

  while (length <= 8 && (first & (0x80 >> (length - 1))) === 0) length += 1;

  if (length > 8 || at + length > bytes.length) return null;

  let value = first & (0xff >> length);
  let allOnes = value === (0xff >> length);

  for (let i = 1; i < length; i += 1) {
    const byte = bytes[at + i];

    if (byte !== 0xff) allOnes = false;

    value = value * 256 + byte;
  }

  return { value: allOnes ? -1 : value, length };
}

function readUint(bytes: Uint8Array, at: number, length: number): number | null {
  if (length <= 0 || length > 8 || at + length > bytes.length) return null;

  let value = 0;

  for (let i = 0; i < length; i += 1) value = value * 256 + bytes[at + i];

  return value;
}

function readFloat(bytes: Uint8Array, at: number, length: number): number | null {
  // CHECKED BEFORE THE DataView IS BUILT, not after. An EBML element size
  // of -1 means UNKNOWN, which is legal and which MediaRecorder writes -
  // and a DataView constructed with a negative length throws RangeError
  // out of the middle of the walk, taking the whole diagnostic with it.
  // A zero length is legal too and means "use the default".
  if (at < 0 || (length !== 4 && length !== 8)) return null;
  if (at + length > bytes.length) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset + at, length);

  const value = length === 4 ? view.getFloat32(0, false) : view.getFloat64(0, false);

  // A damaged file can hold a NaN or an infinity where a sample rate
  // belongs, and "NaN Hz" on a screen is worse than saying nothing.
  return Number.isFinite(value) ? value : null;
}

function readAscii(bytes: Uint8Array, at: number, length: number): string | null {
  const text = ascii(bytes, at, Math.min(length, 64));

  // CodecID is a null-padded string in some muxers.
  return text === null ? null : text.replace(/\0+$/, "");
}

type WebmFindings = {
  docType: string | null;
  timecodeScale: number | null;
  durationTicks: number | null;
  tracks: {
    type: number | null;
    codecId: string | null;
    channels: number | null;
    sampleRate: number | null;
    outputSampleRate: number | null;
    bitDepth: number | null;
  }[];
  sawCluster: boolean;
  ranOut: boolean;
  /** How far the largest over-claiming element ran past the end of the file. */
  overranBy: number;
};

function walkEbml(bytes: Uint8Array, start: number, end: number, findings: WebmFindings, depth: number): void {
  // Depth is bounded because a malformed size can make a child appear to
  // contain its own parent, and this must not recurse forever on bad input.
  if (depth > 6) return;

  let at = start;

  while (at < end) {
    const id = readElementId(bytes, at);

    if (!id) return;

    const size = readElementSize(bytes, at + id.length);

    if (!size) return;

    const payloadAt = at + id.length + size.length;

    // Unknown size: the element runs to the end of what we have. Normal for
    // a Segment written live, and the reason this is not treated as damage.
    const payloadEnd = size.value === -1 ? end : Math.min(end, payloadAt + size.value);

    // An element that claims more than is left. Clamped so nothing reads
    // past the end, and RECORDED - silently clamping is what let a
    // truncated recording produce a clean report. Not applied to an
    // unknown size, which promises nothing.
    if (size.value !== -1 && payloadAt + size.value > end) {
      findings.overranBy = Math.max(findings.overranBy, payloadAt + size.value - end);
    }

    if (payloadAt > end) {
      findings.ranOut = true;
      return;
    }

    switch (id.value) {
      case EBML_IDS.docType:
        findings.docType = readAscii(bytes, payloadAt, size.value);
        break;
      case EBML_IDS.timecodeScale:
        findings.timecodeScale = readUint(bytes, payloadAt, size.value);
        break;
      case EBML_IDS.duration:
        findings.durationTicks = readFloat(bytes, payloadAt, size.value);
        break;
      case EBML_IDS.trackEntry:
        findings.tracks.push({
          type: null,
          codecId: null,
          channels: null,
          sampleRate: null,
          outputSampleRate: null,
          bitDepth: null,
        });
        break;
      case EBML_IDS.trackType:
        lastTrack(findings, (track) => (track.type = readUint(bytes, payloadAt, size.value)));
        break;
      case EBML_IDS.codecId:
        lastTrack(findings, (track) => (track.codecId = readAscii(bytes, payloadAt, size.value)));
        break;
      case EBML_IDS.channels:
        lastTrack(findings, (track) => (track.channels = readUint(bytes, payloadAt, size.value)));
        break;
      case EBML_IDS.samplingFrequency:
        lastTrack(findings, (track) => (track.sampleRate = readFloat(bytes, payloadAt, size.value)));
        break;
      case EBML_IDS.outputSamplingFrequency:
        lastTrack(findings, (track) => (track.outputSampleRate = readFloat(bytes, payloadAt, size.value)));
        break;
      case EBML_IDS.bitDepth:
        lastTrack(findings, (track) => (track.bitDepth = readUint(bytes, payloadAt, size.value)));
        break;
      case EBML_IDS.cluster:
        // The audio itself starts here, so everything this wants has been
        // seen or is not present. Stopping saves walking a whole meeting.
        findings.sawCluster = true;
        return;
      default:
        break;
    }

    if (EBML_MASTERS.has(id.value)) {
      walkEbml(bytes, payloadAt, payloadEnd, findings, depth + 1);

      if (findings.sawCluster) return;
    }

    // A zero-length element is legal; a walker that does not advance past
    // one loops forever.
    const next = payloadEnd > at ? payloadEnd : at + id.length + size.length + 1;

    at = next;
  }
}

function lastTrack(findings: WebmFindings, apply: (track: WebmFindings["tracks"][number]) => void): void {
  const track = findings.tracks[findings.tracks.length - 1];

  if (track) apply(track);
}

// -------------------------------------------------------------------
// Matroska codec ids, WHICH CONTAIN SLASHES.
//
// The real ids are A_MPEG/L3 and A_PCM/INT/LIT, not A_MPEG_L3 - an
// underscored table never matches them and every MP3-in-WebM falls through
// to its raw id. Harmless-looking, and it means the one line a reader
// actually understands is missing from exactly the files that are unusual
// enough to be worth explaining.
//
// A prefix match rather than an exact one, because the PCM family alone has
// six ids (INT/LIT, INT/BIG, FLOAT/IEEE and so on) that all mean the same
// thing to somebody reading a failure message.
// -------------------------------------------------------------------
const MATROSKA_CODECS: [string, string][] = [
  ["A_OPUS", "Opus"],
  ["A_VORBIS", "Vorbis"],
  ["A_AAC", "AAC"],
  ["A_MPEG/L3", "MP3"],
  ["A_MPEG/L2", "MP2"],
  ["A_PCM", "PCM"],
  ["A_FLAC", "FLAC"],
  ["A_AC3", "Dolby Digital"],
  ["A_MS/ACM", "WMA"],
  ["V_VP8", "VP8 video"],
  ["V_VP9", "VP9 video"],
  ["V_AV1", "AV1 video"],
  ["V_MPEG4", "H.264 video"],
];

function matroskaCodecName(codecId: string): string {
  const match = MATROSKA_CODECS.find(([id]) => codecId.toUpperCase().startsWith(id));

  return match ? match[1] : codecId;
}

function probeWebm(bytes: Uint8Array, base: AudioProbe): AudioProbe | null {
  if (!matchesAt(bytes, EBML_HEADER, 0)) return null;

  const problems: AudioProblem[] = [];

  // A SECOND HEADER MEANS TWO RECORDINGS IN ONE FILE. A player reads the
  // first and stops, which is why such a file "plays fine"; a transcriber
  // reaches the second and finds a new document where a cluster should be.
  const second = findValidatedSignature(bytes, EBML_HEADER, 1, "WebM", 0);

  const findings: WebmFindings = {
    docType: null,
    timecodeScale: null,
    durationTicks: null,
    tracks: [],
    sawCluster: false,
    ranOut: false,
    overranBy: 0,
  };

  walkEbml(bytes, 0, second > 0 ? second : bytes.length, findings, 0);

  if (second > 0) {
    problems.push({
      code: "spliced",
      detail: `A second WebM header appears ${formatBytes(second)} into the file, so this is two separate recordings joined together. Only the first ${formatBytes(second)} is a readable recording.`,
      atByte: second,
    });
  }

  const audio = findings.tracks.filter((track) => track.type === 2);
  const video = findings.tracks.filter((track) => track.type === 1);

  if (findings.tracks.length === 0) {
    problems.push({
      code: findings.sawCluster || findings.ranOut ? "unreadable-structure" : "header-not-in-range",
      detail: findings.sawCluster
        ? "The file declares no tracks at all before the audio data begins, so nothing can tell what is in it."
        : "The track list was not found in the part of the file that was read.",
    });
  } else if (audio.length === 0) {
    problems.push({
      code: video.length > 0 ? "video-only" : "no-audio-track",
      detail:
        video.length > 0
          ? "This recording contains video and no audio track, so there is no speech in it to transcribe."
          : "This recording declares no audio track.",
    });
  }

  // -----------------------------------------------------------------
  // AN ELEMENT PROMISED MORE BYTES THAN THE FILE HAS.
  //
  // The walk clamps such a size so it cannot read past the end, and used to
  // clamp it silently - which meant the commonest shape of a damaged
  // recording, one whose upload or write stopped part way, produced a clean
  // report. Only claimed when the whole file was seen: against a head slice
  // every element legitimately overruns the window.
  // -----------------------------------------------------------------
  if (findings.overranBy > 0 && base.isComplete) {
    problems.push({
      code: "truncated",
      detail: `The file ends part way through a section that expected ${formatBytes(findings.overranBy)} more, so it was cut off before it finished being written. Whatever was recorded up to that point is still there.`,
    });
  }

  // Duration is in TimecodeScale units - nanoseconds by default.
  const scale = findings.timecodeScale ?? 1_000_000;
  const durationSeconds =
    findings.durationTicks === null ? null : (findings.durationTicks * scale) / 1_000_000_000;

  const codecId = audio[0]?.codecId ?? null;

  // -----------------------------------------------------------------
  // THE DEFAULTS ARE PART OF THE FORMAT, not a fallback invented here.
  // Matroska says an absent Channels means one and an absent
  // SamplingFrequency means 8000 - so reporting null for a file that simply
  // relied on the defaults would describe it as less known than it is.
  //
  // OutputSamplingFrequency wins where it exists, because Opus is DEFINED
  // at 48 kHz and always declares it: showing somebody 48,000 Hz for audio
  // their microphone captured at 16 kHz is true of the codec and misleading
  // about their hardware.
  // -----------------------------------------------------------------
  const track = audio[0];

  return {
    ...base,
    container: "WebM",
    containerDetail: findings.docType ? `DocType ${findings.docType}` : null,
    audioCodec: codecId ? matroskaCodecName(codecId) : null,
    channels: track ? (track.channels ?? 1) : null,
    sampleRate: track ? plausibleRate(track.outputSampleRate ?? track.sampleRate ?? 8_000) : null,
    bitsPerSample: track?.bitDepth ?? null,
    durationSeconds: durationSeconds !== null && Number.isFinite(durationSeconds) ? durationSeconds : null,
    trackCount: findings.tracks.length,
    hasAudioTrack: findings.tracks.length === 0 ? null : audio.length > 0,
    problems,
  };
}

// -------------------------------------------------------------------
// ===================================================================
// IS THIS REALLY A SECOND FILE, OR FOUR BYTES OF LUCK?
// ===================================================================
//
// THIS IS THE MOST DANGEROUS FUNCTION IN THE MODULE, because of what the
// caller does with a yes: it TRUNCATES the recording there. A wrong yes
// silently throws away half of a meeting that has already happened and
// cannot be held again.
//
// A four byte signature occurs by chance about once every four gigabytes,
// which sounds safe and is not: a 500 MB recording has roughly a one in
// eight chance of containing one somewhere in its compressed audio, and
// this feature exists to handle long recordings. Matching the signature
// alone would therefore cut a meeting in eight - not rarely, routinely.
//
// So a candidate has to look like a real file beginning, not merely like
// four familiar bytes:
//
//   WebM   the magic must be followed by a plausible EBML size and, within
//          the header, the DocType element 0x4282 naming webm or matroska.
//          Random audio does not spell "webm" four bytes after an element
//          id it also produced by chance.
//   MP4    the four bytes before `ftyp` must be a sane box size, and the
//          four after it must be a printable brand. Compressed audio
//          producing all three in the right places is vanishingly rare.
//
// The cost of a wrong NO is that a spliced file is uploaded and refused by
// Azure several minutes later, and then converted. The cost of a wrong YES
// is half a meeting. They are not comparable, and this leans accordingly.
// -------------------------------------------------------------------
/**
 * The first occurrence of `signature` from `from` that also PASSES
 * validation as a real container start.
 *
 * `signatureOffset` is how far into the container the signature sits -
 * zero for WebM's magic, four for MP4's `ftyp` - because validation needs
 * the container's own first byte, not the signature's.
 */
function findValidatedSignature(
  bytes: Uint8Array,
  signature: readonly number[],
  from: number,
  container: string,
  signatureOffset: number,
): number {
  for (let at = from; at <= bytes.length - signature.length; at += 1) {
    if (!matchesAt(bytes, signature, at)) continue;
    if (looksLikeContainerStart(bytes, at - signatureOffset, container)) return at;
  }

  return -1;
}

export function looksLikeContainerStart(bytes: Uint8Array, at: number, container: string): boolean {
  if (container === "WebM") return looksLikeEbmlHeader(bytes, at);
  if (container === "MP4") return looksLikeMp4Start(bytes, at);

  // The three below are only ever asked about by findLateSignature - the
  // splice scan deliberately covers WebM and MP4 alone, because those are
  // the containers this app's own recorder produces.
  if (container === "Ogg") {
    // "OggS", then a version byte that the format fixes at zero, then a
    // header-type byte with only three defined bits.
    return ascii(bytes, at, 4) === "OggS" && u8(bytes, at + 4) === 0 && ((u8(bytes, at + 5) ?? 0xff) & 0xf8) === 0;
  }

  if (container === "WAV") return ascii(bytes, at, 4) === "RIFF" && ascii(bytes, at + 8, 4) === "WAVE";

  if (container === "FLAC") {
    // "fLaC", then a metadata block header whose type is one of the seven
    // the format defines and whose 24-bit length is not absurd.
    if (ascii(bytes, at, 4) !== "fLaC") return false;

    const blockType = (u8(bytes, at + 4) ?? 0xff) & 0x7f;
    const blockLength = ((u8(bytes, at + 5) ?? 0) << 16) | ((u8(bytes, at + 6) ?? 0) << 8) | (u8(bytes, at + 7) ?? 0);

    return blockType <= 6 && blockLength > 0 && blockLength < 16 * 1024 * 1024;
  }

  return false;
}

function looksLikeEbmlHeader(bytes: Uint8Array, at: number): boolean {
  if (!matchesAt(bytes, EBML_HEADER, at)) return false;

  // The header's own size, which is small - a few dozen bytes - and must
  // parse. A chance match is usually followed by a byte that decodes as an
  // absurd length or as nothing at all.
  const size = readElementSize(bytes, at + EBML_HEADER.length);

  if (!size || size.value < 4 || size.value > 1024) return false;

  // DocType, naming the format in ASCII. This is the part chance does not
  // produce: an element id AND a length AND the letters "webm" where the
  // format says they belong.
  const headerEnd = Math.min(bytes.length, at + EBML_HEADER.length + size.length + size.value);

  for (let cursor = at + EBML_HEADER.length + size.length; cursor + 2 < headerEnd; cursor += 1) {
    if (bytes[cursor] !== 0x42 || bytes[cursor + 1] !== 0x82) continue;

    const docTypeSize = readElementSize(bytes, cursor + 2);

    if (!docTypeSize || docTypeSize.value < 4 || docTypeSize.value > 16) continue;

    const docType = ascii(bytes, cursor + 2 + docTypeSize.length, docTypeSize.value);

    if (docType === "webm" || docType?.startsWith("matroska")) return true;
  }

  return false;
}

function looksLikeMp4Start(bytes: Uint8Array, at: number): boolean {
  // `at` is the box start; `ftyp` is its type, four bytes in.
  if (ascii(bytes, at + 4, 4) !== "ftyp") return false;

  const size = u32be(bytes, at);

  // An ftyp box is a brand, a version and a short list of brands. Anything
  // outside this is not one.
  if (size === null || size < 16 || size > 1024) return false;

  const brand = ascii(bytes, at + 8, 4);

  // A brand is printable ASCII - "isom", "M4A ", "qt  ", "3gp4".
  return brand !== null && /^[\x20-\x7e]{4}$/.test(brand);
}

// ===================================================================
// MP4 / ISOBMFF - also .m4a, .mov, .3gp
//
// A tree of boxes: a 32-bit size, a four-character type, then a payload
// that is either fields or more boxes. Two sizes are special and both are
// easy to get wrong: 1 means the real size is a 64-bit value after the
// type, and 0 means "to the end of the file".
//
// THE HARD PART IS WHERE moov IS. A file written for streaming puts it
// first; a phone writes the audio and appends it, so on an .m4a the codec,
// the duration and the track list are all at the END. A probe reading only
// the head must say it could not see them rather than say there are none.
// ===================================================================

const MP4_CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "udta", "moof", "traf"]);

const MP4_CODECS: Record<string, string> = {
  mp4a: "AAC",
  alac: "Apple Lossless",
  "ac-3": "Dolby Digital",
  "ec-3": "Dolby Digital Plus",
  samr: "AMR",
  sowt: "PCM",
  twos: "PCM",
  lpcm: "PCM",
  avc1: "H.264 video",
  hvc1: "HEVC video",
  mp4v: "MPEG-4 video",
};

type Mp4Findings = {
  brand: string | null;
  timescale: number | null;
  durationUnits: number | null;
  handlers: string[];
  sampleFormats: string[];
  audioChannels: number | null;
  audioSampleRate: number | null;
  /** The track is DRM protected, which no transcriber can read. */
  encrypted: boolean;
  sawMoov: boolean;
  sawMoof: boolean;
  // -----------------------------------------------------------------
  // WHETHER THE WALK RAN OUT OF BUFFER MID-BOX.
  //
  // The difference between "this file has no audio track" and "I did not
  // get far enough to see one", and getting it wrong loses recordings. A
  // 1080p meeting recording has sample tables of hundreds of kilobytes, so
  // its VIDEO track alone can fill the whole head window - the walk then
  // ends inside stbl, having seen one handler, and a file with perfectly
  // good audio is refused as video-only. Matroska has carried this flag
  // from the start; MP4 did not, and that was the gap.
  // -----------------------------------------------------------------
  ranOut: boolean;
  /** The handler of the trak currently being walked, so a sample entry is only read as audio inside a sound track. */
  currentHandler: string | null;
};

function walkMp4(bytes: Uint8Array, start: number, end: number, findings: Mp4Findings, depth: number): void {
  if (depth > 8) return;

  let at = start;

  while (at + 8 <= end) {
    const declared = u32be(bytes, at);
    const type = ascii(bytes, at + 4, 4);

    if (declared === null || type === null) return;

    let headerBytes = 8;
    let size = declared;

    if (declared === 1) {
      // 64-bit largesize. Only the low 32 bits are read: a box over 4 GiB
      // cannot be inside a window this size anyway, and reading the high
      // word would need BigInt for a number that is always zero here.
      const high = u32be(bytes, at + 8);
      const low = u32be(bytes, at + 12);

      if (high === null || low === null || high !== 0) return;

      size = low;
      headerBytes = 16;
    } else if (declared === 0) {
      // To the end of the file.
      size = end - at;
    }

    if (size < headerBytes) return;

    const payloadAt = at + headerBytes;
    const payloadEnd = Math.min(end, at + size);

    // The box says it is longer than the buffer. Clamped so nothing reads
    // past the end, and RECORDED - see ranOut. A silent clamp here is what
    // turned "I could not reach the audio track" into "there is no audio
    // track", which is fatal and wrong.
    if (at + size > end) findings.ranOut = true;

    switch (type) {
      case "ftyp":
        findings.brand = (ascii(bytes, payloadAt, 4) ?? "").trim() || null;
        break;
      case "moov":
        findings.sawMoov = true;
        break;
      case "moof":
        findings.sawMoof = true;
        break;
      case "mvhd":
        readMvhd(bytes, payloadAt, findings);
        break;
      case "trak":
        // A new track: whatever the last one was handled, this one has not
        // said yet. Without this a sound track followed by a timecode track
        // would read the second one's sample entry as audio.
        findings.currentHandler = null;
        break;
      case "hdlr": {
        // version+flags (4), pre_defined (4), then the handler type.
        const handler = ascii(bytes, payloadAt + 8, 4);

        if (handler) {
          findings.handlers.push(handler);
          findings.currentHandler = handler;
        }
        break;
      }
      case "stsd":
        readStsd(bytes, payloadAt, payloadEnd, findings);
        break;
      default:
        break;
    }

    if (MP4_CONTAINERS.has(type)) walkMp4(bytes, payloadAt, payloadEnd, findings, depth + 1);

    if (payloadEnd <= at) return;

    at = payloadEnd;
  }
}

function readMvhd(bytes: Uint8Array, payloadAt: number, findings: Mp4Findings): void {
  const version = u8(bytes, payloadAt);

  if (version === null) return;

  // version+flags is 4 bytes; then creation and modification times, whose
  // width is what the version selects.
  if (version === 1) {
    findings.timescale = u32be(bytes, payloadAt + 4 + 16);
    // 64-bit duration: the high word is zero for anything short of 50,000
    // years at a normal timescale.
    const high = u32be(bytes, payloadAt + 4 + 20);
    const low = u32be(bytes, payloadAt + 4 + 24);

    findings.durationUnits = high === 0 && low !== null ? low : null;
    return;
  }

  findings.timescale = u32be(bytes, payloadAt + 4 + 8);
  findings.durationUnits = u32be(bytes, payloadAt + 4 + 12);
}

/** Every remaining Mp4Findings literal needs the same fields; kept together for that reason. */
const EMPTY_MP4_FINDINGS = (): Mp4Findings => ({
  brand: null,
  timescale: null,
  durationUnits: null,
  handlers: [],
  sampleFormats: [],
  audioChannels: null,
  audioSampleRate: null,
  encrypted: false,
  sawMoov: false,
  sawMoof: false,
  ranOut: false,
  currentHandler: null,
});

function readStsd(bytes: Uint8Array, payloadAt: number, payloadEnd: number, findings: Mp4Findings): void {
  // version+flags (4), entry_count (4), then the entries.
  const count = u32be(bytes, payloadAt + 4);

  if (count === null) return;

  let at = payloadAt + 8;

  // MULTIPLE ENTRIES ARE LEGAL - a track whose codec configuration changes
  // part way has more than one - so this collects them all rather than
  // reading the first and assuming.
  for (let index = 0; index < count && at + 8 <= payloadEnd; index += 1) {
    const size = u32be(bytes, at);
    const declared = ascii(bytes, at + 4, 4);

    if (size === null || declared === null || size < 8) return;

    // -------------------------------------------------------------
    // `enca` AND `encv` ARE NOT CODECS. They mean the track is encrypted,
    // and the real format is kept in the entry's own sinf -> frma box.
    // Reporting "enca" as the codec sends somebody looking up a format
    // that does not exist, when the useful answer is "this is DRM".
    // -------------------------------------------------------------
    const encrypted = declared === "enca" || declared === "encv";

    // The child boxes - sinf, esds, wave - begin AFTER the fixed fields,
    // and where that is depends on the sound description version. Scanning
    // from the start of the payload instead reads the reserved bytes as a
    // box header, finds nothing, and reports "enca" as though it were a
    // codec.
    const format = encrypted
      ? (originalFormatOf(bytes, at + sampleEntryChildOffset(bytes, at), Math.min(payloadEnd, at + size)) ??
        declared)
      : declared;

    findings.sampleFormats.push(format);

    if (encrypted) findings.encrypted = true;

    // ONLY INSIDE A SOUND TRACK. It used to be "anything not on the video
    // denylist", so a timecode track, a subtitle track or any video codec
    // the list does not name wrote its bytes into the audio sample rate -
    // producing a confident wrong number rather than a blank.
    if (findings.currentHandler === "soun") readAudioSampleEntry(bytes, at, findings);

    at += size;
  }
}

/**
 * The real four-character format of an encrypted track, from sinf -> frma.
 */
function originalFormatOf(bytes: Uint8Array, start: number, end: number, depth = 0): string | null {
  // Bounded like every other walk here. A crafted file can nest sinf
  // inside sinf indefinitely, and unbounded recursion on attacker-shaped
  // data is a crash rather than a finding.
  if (depth > 4) return null;

  for (let at = start; at + 8 <= end; ) {
    const size = u32be(bytes, at);
    const type = ascii(bytes, at + 4, 4);

    if (size === null || type === null || size < 8) return null;

    if (type === "frma") return ascii(bytes, at + 8, 4);

    // sinf holds frma among its children, so descend rather than skip.
    if (type === "sinf") {
      const inner = originalFormatOf(bytes, at + 8, Math.min(end, at + size), depth + 1);

      if (inner) return inner;
    }

    at += size;
  }

  return null;
}

// -------------------------------------------------------------------
// Channel count and sample rate out of an AudioSampleEntry.
//
// THE VERSION FIELD DECIDES THE LAYOUT, and ignoring it is how a parser
// reports 3 channels at 1 Hz. QuickTime sound description version 2 moved
// the real values because the legacy sample-rate field is 16.16 fixed
// point and cannot express 96 kHz at all - so it parks a constant in the
// old fields and puts the truth further in.
// -------------------------------------------------------------------
function readAudioSampleEntry(bytes: Uint8Array, at: number, findings: Mp4Findings): void {
  // 6 reserved + 2 data_reference_index, then the version.
  const version = u16be(bytes, at + 16);

  if (version === 2) {
    const rate = readFloat(bytes, at + 40, 8);
    const channels = u32be(bytes, at + 48);

    if (rate !== null && rate > 0) findings.audioSampleRate = Math.round(rate);
    if (channels !== null && channels > 0) findings.audioChannels = channels;

    return;
  }

  // Versions 0 and 1 share the legacy fields: version/revision/vendor (8),
  // channelcount, samplesize, pre_defined, reserved, then a 16.16
  // fixed-point rate whose integer part is the half worth having.
  const channels = u16be(bytes, at + 24);
  const rate = u16be(bytes, at + 32);

  if (channels !== null && channels > 0) findings.audioChannels = channels;
  if (rate !== null && rate > 0) findings.audioSampleRate = rate;
}

// -------------------------------------------------------------------
// How far into an AudioSampleEntry its child boxes start.
//
// Version 1 appends four more fixed fields to version 0, and version 2
// replaces the lot with a larger structure - so a single hardcoded offset
// finds no esds and no sinf on a large share of .mov and Apple-written
// .m4a files, which is to say on phone voice memos.
// -------------------------------------------------------------------
function sampleEntryChildOffset(bytes: Uint8Array, at: number): number {
  const version = u16be(bytes, at + 16);

  if (version === 2) return 72;
  if (version === 1) return 52;

  return 36;
}

function isVideoFormat(format: string): boolean {
  const name = MP4_CODECS[format];

  return name !== undefined && name.endsWith("video");
}

// -------------------------------------------------------------------
// Whether this is an ISOBMFF file at all.
//
// `ftyp` IS OPTIONAL, and requiring it rejects real files: QuickTime .mov
// - which is the parent format, and what a Mac screen recording is -
// legally begins with moov, mdat, wide, free, skip or pnot. There is no
// magic number at offset 0 in this format; the first four bytes are a
// length. So the test is "the first eight bytes parse as a plausible box
// header of a type this format defines".
// -------------------------------------------------------------------
const ISOBMFF_FIRST_BOXES = ["ftyp", "styp", "moov", "mdat", "wide", "free", "skip", "pnot"];

function looksLikeIsobmff(bytes: Uint8Array): boolean {
  const size = u32be(bytes, 0);
  const type = ascii(bytes, 4, 4);

  if (size === null || type === null) return false;
  if (!ISOBMFF_FIRST_BOXES.includes(type)) return false;

  // size 1 means a 64-bit length follows; size 0 means "to end of file",
  // which is only legal on the last box but is legal.
  return size === 0 || size === 1 || size >= 8;
}

/** 32-bit and 64-bit all-ones both mean "unknown", not a 27-hour recording. */
const MP4_UNKNOWN_DURATION = 0xffffffff;

function probeMp4(bytes: Uint8Array, base: AudioProbe): AudioProbe | null {
  if (!looksLikeIsobmff(bytes)) return null;

  const problems: AudioProblem[] = [];

  const findings = EMPTY_MP4_FINDINGS();

  walkMp4(bytes, 0, bytes.length, findings, 0);

  // A second ftyp is another file appended to this one - the MP4 form of
  // the double-start bug. Validated rather than merely matched: see
  // looksLikeContainerStart for why a bare signature match here would cut
  // a long recording in half by chance.
  const second = findValidatedSignature(bytes, asciiBytes("ftyp"), 5, "MP4", 4);

  if (second > 0) {
    problems.push({
      code: "spliced",
      detail: `A second MP4 header appears ${formatBytes(second - 4)} into the file, so this is two separate recordings joined together.`,
      // `ftyp` sits four bytes into its own box, so the file itself starts
      // four bytes earlier than the signature does.
      atByte: second - 4,
    });
  }

  const audioFormats = findings.sampleFormats.filter((format) => !isVideoFormat(format));
  const hasSoundHandler = findings.handlers.includes("soun");

  if (!findings.sawMoov) {
    problems.push({
      code: "header-not-in-range",
      detail: base.isComplete
        ? "This MP4 has no moov box, which is the index every player needs. The recording was probably cut off before it was finished being written."
        : "The part of this MP4 that describes its tracks sits after the audio, beyond the section that was read.",
    });
  } else if (findings.ranOut && !hasSoundHandler) {
    // -----------------------------------------------------------------
    // THE WALK STOPPED EARLY AND FOUND NO SOUND TRACK, which are two
    // different statements and must not be collapsed into the fatal one.
    //
    // A 1080p meeting recording has sample tables of hundreds of
    // kilobytes, so its VIDEO track alone fills the head window; the walk
    // ends inside stbl having seen a single "vide" handler, and the audio
    // track it never reached is declared not to exist. That refusal is
    // terminal and classifies as unusable, so no conversion is offered
    // either - a recording with perfectly good audio in it becomes
    // permanently untranscribable.
    //
    // header-not-in-range is NOT fatal, and it is what makes
    // probeStoredMedia go back for the tail.
    // -----------------------------------------------------------------
    problems.push({
      code: "header-not-in-range",
      detail: "This file's track list is larger than the section that was read, so what it contains could not be determined here.",
    });
  } else if (findings.handlers.length > 0 && !hasSoundHandler) {
    problems.push({
      code: findings.handlers.includes("vide") ? "video-only" : "no-audio-track",
      detail: findings.handlers.includes("vide")
        ? "This file contains video and no audio track, so there is no speech in it to transcribe."
        : `This file declares no audio track (its tracks are: ${findings.handlers.join(", ")}).`,
    });
  }

  if (findings.encrypted) {
    problems.push({
      code: "unreadable-structure",
      detail:
        "This recording is encrypted (DRM), so no transcription service can decode it. That is a property of the file rather than a fault in it.",
    });
  }

  // -----------------------------------------------------------------
  // A FRAGMENTED FILE'S HEADER IS SUPPOSED TO BE EMPTY, and reporting its
  // zero duration as a fact is a wrong answer that looks right. The sample
  // tables live in each fragment so that the header can be written before
  // any media exists - which is the whole point of the format - and the
  // duration is simply not there to be read.
  // -----------------------------------------------------------------
  const isFragmented = findings.sawMoof || (findings.sawMoov && findings.durationUnits === 0);

  const durationKnown =
    findings.durationUnits !== null &&
    findings.durationUnits !== MP4_UNKNOWN_DURATION &&
    !(isFragmented && findings.durationUnits === 0);

  const durationSeconds =
    durationKnown && findings.timescale && findings.timescale > 0
      ? findings.durationUnits! / findings.timescale
      : null;

  const codec = audioFormats[0] ?? findings.sampleFormats[0] ?? null;

  return {
    ...base,
    container: "MP4",
    containerDetail: [findings.brand ? `brand ${findings.brand}` : null, isFragmented ? "fragmented" : null]
      .filter(Boolean)
      .join(", ") || null,
    audioCodec: codec ? (MP4_CODECS[codec] ?? codec) : null,
    channels: findings.audioChannels,
    sampleRate: findings.audioSampleRate,
    bitsPerSample: null,
    durationSeconds,
    trackCount: findings.handlers.length > 0 ? findings.handlers.length : null,
    hasAudioTrack: findings.handlers.length > 0 ? hasSoundHandler : null,
    problems,
  };
}

// -------------------------------------------------------------------
// An MP4 whose index is at the END, read from a tail slice.
//
// WHY THIS IS NEEDED AT ALL. A file written for streaming puts moov first;
// everything else appends it, because a muxer cannot write the sample
// tables until it has seen the last sample. So anything recorded or piped
// puts moov after the audio - and a phone voice memo, the commonest thing
// anybody uploads here, is written exactly that way. On precisely the files
// that fail most often, the codec, the duration and the track list are
// nowhere near the start, and a head-only probe can only say it did not see
// them.
//
// THE SLICE STARTS MID-BOX, so box walking cannot begin at its start: the
// first four bytes are the middle of something. The moov box has to be
// found by signature instead - and a raw signature search is exactly what
// the MP4 spec work warns against, because those four ASCII bytes occur by
// chance inside compressed audio. So a candidate is only accepted when the
// four bytes BEFORE it are a sane box size and the walk that follows
// actually learns something. Anything less confident is discarded and the
// probe keeps its honest "I could not see the tracks".
// -------------------------------------------------------------------
export function probeMp4Tail(probe: AudioProbe, tail: Uint8Array): AudioProbe {
  if (probe.container !== "MP4") return probe;

  const findings = findMoovIn(tail);

  if (!findings) return probe;

  const audioFormats = findings.sampleFormats.filter((format) => !isVideoFormat(format));
  const codec = audioFormats[0] ?? findings.sampleFormats[0] ?? null;
  const hasSoundHandler = findings.handlers.includes("soun");

  const durationKnown =
    findings.durationUnits !== null && findings.durationUnits !== MP4_UNKNOWN_DURATION && findings.durationUnits > 0;

  const durationSeconds =
    durationKnown && findings.timescale && findings.timescale > 0
      ? findings.durationUnits! / findings.timescale
      : probe.durationSeconds;

  // The head's complaint that it could not reach the tracks is answered now.
  const problems = probe.problems.filter((problem) => problem.code !== "header-not-in-range");

  // Same rule as the head walk: a conclusion about what tracks exist is
  // only safe from a walk that reached the end of the moov.
  if (findings.handlers.length > 0 && !hasSoundHandler && !findings.ranOut) {
    problems.push({
      code: findings.handlers.includes("vide") ? "video-only" : "no-audio-track",
      detail: findings.handlers.includes("vide")
        ? "This file contains video and no audio track, so there is no speech in it to transcribe."
        : `This file declares no audio track (its tracks are: ${findings.handlers.join(", ")}).`,
    });
  }

  if (findings.encrypted) {
    problems.push({
      code: "unreadable-structure",
      detail:
        "This recording is encrypted (DRM), so no transcription service can decode it. That is a property of the file rather than a fault in it.",
    });
  }

  return {
    ...probe,
    audioCodec: codec ? (MP4_CODECS[codec] ?? codec) : probe.audioCodec,
    channels: findings.audioChannels ?? probe.channels,
    sampleRate: findings.audioSampleRate ?? probe.sampleRate,
    durationSeconds,
    trackCount: findings.handlers.length > 0 ? findings.handlers.length : probe.trackCount,
    hasAudioTrack: findings.handlers.length > 0 ? hasSoundHandler : probe.hasAudioTrack,
    problems,
  };
}

/**
 * Walk from every plausible moov in `tail` and return the first walk that
 * actually learned something.
 *
 * "Learned something" is the guard against a chance match: a real moov
 * yields a handler or a timescale, where four lucky bytes inside compressed
 * audio yield an empty findings object.
 */
function findMoovIn(tail: Uint8Array): Mp4Findings | null {
  const signature = asciiBytes("moov");

  for (let at = 4; at <= tail.length - signature.length; at += 1) {
    if (!matchesAt(tail, signature, at)) continue;

    const boxAt = at - 4;
    const size = u32be(tail, boxAt);

    // A moov holds at least an mvhd, so it is never tiny; and it cannot
    // claim more than the slice has, because a file's moov ends with it.
    if (size === null || size < 32 || boxAt + size > tail.length) continue;

    const findings = EMPTY_MP4_FINDINGS();

    walkMp4(tail, boxAt, Math.min(tail.length, boxAt + size), findings, 0);

    if (findings.sawMoov && (findings.handlers.length > 0 || findings.timescale !== null)) {
      return findings;
    }
  }

  return null;
}

// -------------------------------------------------------------------
// ===================================================================
// RIFF / WAVE
//
// The one this app WRITES, when it re-encodes a recording the service
// could not read - so a fault here is the app's own, and worth catching.
//
// The trap is the pad byte: a chunk with an odd size is followed by one
// byte of padding that is not counted in the size. A walker that ignores it
// is misaligned for every chunk after the first odd one.
// ===================================================================

const WAV_FORMATS: Record<number, string> = {
  1: "PCM",
  3: "IEEE float",
  6: "A-law",
  7: "mu-law",
  0xfffe: "PCM (extensible)",
};

function probeWav(bytes: Uint8Array, base: AudioProbe): AudioProbe | null {
  const riff = ascii(bytes, 0, 4);

  // -----------------------------------------------------------------
  // THE NEIGHBOURS ARE NAMED RATHER THAN MISPARSED. RIFX is the same
  // layout with every field big-endian, RF64 is the 64-bit variant for
  // files over 4 GB, and Sony Wave64 opens with a GUID whose first four
  // bytes spell "riff" in lower case. A little-endian RIFF walker pointed
  // at any of them does not fail - it reports a four gigabyte file at
  // 16 MHz, which reads as corruption and sends somebody looking for
  // damage that is not there.
  // -----------------------------------------------------------------
  if (riff === "RIFX" || riff === "RF64" || riff === "riff") {
    return {
      ...base,
      container: "WAV",
      containerDetail: riff === "riff" ? "Sony Wave64" : riff,
      audioCodec: null,
      channels: null,
      sampleRate: null,
      bitsPerSample: null,
      durationSeconds: null,
      trackCount: 1,
      hasAudioTrack: true,
      problems: [
        {
          code: "unknown-container",
          detail: `This is a ${riff === "riff" ? "Sony Wave64" : riff} file - a WAV variant with a different internal layout. It may still transcribe, but nothing here can describe its contents.`,
        },
      ],
    };
  }

  if (riff !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return null;

  const problems: AudioProblem[] = [];
  const riffSize = u32le(bytes, 4);

  let formatTag: number | null = null;
  let channels: number | null = null;
  let sampleRate: number | null = null;
  let bitsPerSample: number | null = null;
  let declaredDataBytes: number | null = null;
  let dataAt: number | null = null;

  let at = 12;

  // Only TOP-LEVEL chunks count. LIST and its INFO sub-chunks are a nested
  // namespace, and a walker that descended into one could find a 'fmt '
  // inside somebody's metadata and believe it.
  while (at + 8 <= bytes.length) {
    const id = ascii(bytes, at, 4);
    const size = u32le(bytes, at + 4);

    if (id === null || size === null) break;

    if (id === "fmt ") {
      formatTag = u16le(bytes, at + 8);
      channels = u16le(bytes, at + 10);
      sampleRate = u32le(bytes, at + 12);
      bitsPerSample = u16le(bytes, at + 22);
    } else if (id === "data") {
      declaredDataBytes = size;
      dataAt = at + 8;
    }

    // The pad byte: an odd chunk size is followed by one byte the size does
    // not count. Miss it and every chunk after the first odd one is read
    // from the wrong place - silently, producing plausible wrong answers.
    const next = at + 8 + size + (size % 2);

    // A size field can say anything. Requiring the walk to move forward is
    // what stops a malformed file spinning here forever.
    if (next <= at) break;

    at = next;
  }

  // -----------------------------------------------------------------
  // A BROWSER-WRITTEN WAV OFTEN HAS THE WRONG SIZES IN IT, and this app
  // writes browser WAVs - so this case is ours, not a stranger's.
  //
  // Both size fields describe bytes that do not exist yet when the 44-byte
  // header is emitted. An encoder that has all the samples in hand fills
  // them in; a STREAMING one cannot, because nothing in a browser pipeline
  // can seek backwards to patch them, so it writes a placeholder and hopes
  // to return. If the tab was closed or the upload interrupted, it never
  // did - and that is byte for byte indistinguishable from truncation.
  //
  // Which is why the samples that ARE present are used rather than the
  // claim, and the disagreement is reported as a header that was never
  // finished rather than as lost audio. The audio decodes perfectly, and
  // refusing it would throw away a recording of a meeting that already
  // happened.
  // -----------------------------------------------------------------
  const presentDataBytes =
    dataAt === null ? null : Math.max(0, (base.byteSize ?? bytes.length) - dataAt);

  const effectiveDataBytes =
    declaredDataBytes === null
      ? null
      : presentDataBytes === null
        ? declaredDataBytes
        : Math.min(declaredDataBytes, presentDataBytes);

  if (
    base.isComplete &&
    declaredDataBytes !== null &&
    presentDataBytes !== null &&
    declaredDataBytes > presentDataBytes
  ) {
    problems.push({
      code: "truncated",
      detail: `The header says there are ${formatBytes(declaredDataBytes)} of audio and ${formatBytes(presentDataBytes)} are present. Either the recording was cut off, or whatever wrote it never went back to correct the header. The audio that is there will still transcribe.`,
    });
  }

  if (base.isComplete && riffSize !== null && base.byteSize !== null && riffSize + 8 > base.byteSize) {
    problems.push({
      code: "truncated",
      detail: `The file says it is ${formatBytes(riffSize + 8)} and only ${formatBytes(base.byteSize)} is there.`,
    });
  }

  if (declaredDataBytes === 0 || effectiveDataBytes === 0) {
    problems.push({ code: "empty", detail: "This is a valid WAV container with no audio in it at all." });
  }

  const bytesPerSecond =
    sampleRate && channels && bitsPerSample ? (sampleRate * channels * bitsPerSample) / 8 : null;

  const formatName = formatTag === null ? null : (WAV_FORMATS[formatTag] ?? `format ${formatTag}`);

  return {
    ...base,
    container: "WAV",
    containerDetail: formatName,
    audioCodec: formatName,
    channels,
    sampleRate,
    bitsPerSample,
    durationSeconds: effectiveDataBytes !== null && bytesPerSecond ? effectiveDataBytes / bytesPerSecond : null,
    trackCount: 1,
    hasAudioTrack: effectiveDataBytes !== null && effectiveDataBytes > 0,
    problems,
  };
}

// ===================================================================
// Ogg - Opus or Vorbis
//
// Duration is deliberately not reported. It lives in the granule position
// of the LAST page, which is not in a head slice, and a guess would be
// worse than a blank.
// ===================================================================

function probeOgg(bytes: Uint8Array, base: AudioProbe): AudioProbe | null {
  if (ascii(bytes, 0, 4) !== "OggS") return null;

  const problems: AudioProblem[] = [];

  const opusAt = indexOfSignature(bytes, asciiBytes("OpusHead"), 0);
  const vorbisAt = indexOfSignature(bytes, [0x01, ...asciiBytes("vorbis")], 0);

  if (opusAt >= 0) {
    return {
      ...base,
      container: "Ogg",
      containerDetail: "OpusHead",
      audioCodec: "Opus",
      // OpusHead: version (1), channel count (1), pre-skip (2), then the
      // ORIGINAL INPUT sample rate as a little-endian 32.
      //
      // That field is documentation about the source material, not the
      // rate anything decodes at: Opus is defined at 48 kHz and always
      // runs there. It is reported because it is the only statement the
      // file makes about the microphone, and it is the more useful of the
      // two to somebody asking why their recording sounds thin.
      channels: u8(bytes, opusAt + 9),
      sampleRate: u32le(bytes, opusAt + 12) || null,
      bitsPerSample: null,
      durationSeconds: null,
      trackCount: 1,
      hasAudioTrack: true,
      problems,
    };
  }

  if (vorbisAt >= 0) {
    return {
      ...base,
      container: "Ogg",
      containerDetail: "Vorbis identification header",
      audioCodec: "Vorbis",
      // After the 7-byte packet type and signature: version (4), then
      // channels (1) and sample rate (4, little-endian).
      channels: u8(bytes, vorbisAt + 11),
      sampleRate: u32le(bytes, vorbisAt + 12) || null,
      bitsPerSample: null,
      durationSeconds: null,
      trackCount: 1,
      hasAudioTrack: true,
      problems,
    };
  }

  problems.push({
    code: "no-audio-track",
    detail: "This is an Ogg file, and the first stream in it is not Opus or Vorbis audio.",
  });

  return {
    ...base,
    container: "Ogg",
    containerDetail: null,
    audioCodec: null,
    channels: null,
    sampleRate: null,
    bitsPerSample: null,
    durationSeconds: null,
    trackCount: null,
    hasAudioTrack: false,
    problems,
  };
}

// ===================================================================
// FLAC
//
// STREAMINFO is not byte aligned - sample rate is 20 bits, channels 3,
// bit depth 5, total samples 36 - so every field here is a shift and a
// mask rather than a read. Getting the boundaries wrong produces a
// plausible wrong number, which is the worst kind.
// ===================================================================

function probeFlac(bytes: Uint8Array, base: AudioProbe): AudioProbe | null {
  // Some taggers prepend an ID3v2 tag even though the FLAC spec forbids it,
  // and a parser that only looks at offset 0 calls those files invalid.
  const start = ascii(bytes, 0, 3) === "ID3" ? 10 + synchsafe(bytes, 6) : 0;

  if (ascii(bytes, start, 4) !== "fLaC") return null;

  // METADATA_BLOCK_HEADER: the top bit is the last-block flag, so the type
  // is the low seven. Reading the raw byte makes a STREAMINFO that is also
  // the only block look like type 128, and a valid file gets rejected.
  const blockType = (u8(bytes, start + 4) ?? 0xff) & 0x7f;

  const problems: AudioProblem[] = [];

  if (blockType !== 0) {
    return {
      ...base,
      container: "FLAC",
      containerDetail: null,
      audioCodec: "FLAC",
      channels: null,
      sampleRate: null,
      bitsPerSample: null,
      durationSeconds: null,
      trackCount: 1,
      hasAudioTrack: true,
      problems: [
        {
          code: "unreadable-structure",
          detail: "This FLAC file does not begin with its stream information block, which every valid FLAC file must.",
        },
      ],
    };
  }

  // "fLaC" (4) plus the 4-byte block header, then STREAMINFO itself.
  const info = start + 8;

  const b = (offset: number): number => u8(bytes, info + offset) ?? 0;

  // -----------------------------------------------------------------
  // NOTHING HERE IS BYTE ALIGNED. After the four frame-size fields comes
  // 20 bits of sample rate, 3 of channels-minus-one, 5 of bits-per-sample-
  // minus-one and 36 of total samples. A DataView-only reading of this
  // produces a sample rate in the tens of millions that looks like a
  // number rather than like an error.
  //
  // The minus-ones are part of the format: stored 0 means 1 channel.
  // -----------------------------------------------------------------
  const sampleRate = (b(10) << 12) | (b(11) << 4) | (b(12) >> 4);
  const channels = ((b(12) >> 1) & 0x07) + 1;
  const bitsPerSample = (((b(12) & 0x01) << 4) | (b(13) >> 4)) + 1;

  // 36 bits. `(b13 & 0x0F) << 32` silently evaluates as << 0 in JavaScript,
  // so this multiplies instead; the maximum is exactly representable as a
  // Number, so BigInt is not needed.
  const totalSamples =
    (b(13) & 0x0f) * 2 ** 32 + (((b(14) << 24) >>> 0) + (b(15) << 16) + (b(16) << 8) + b(17));

  // ZERO MEANS UNKNOWN, NOT ZERO. A stream encoded live has no total sample
  // count to write, and reporting that as a nought-second recording is a
  // false alarm about a perfectly good file.
  return {
    ...base,
    container: "FLAC",
    containerDetail: "STREAMINFO",
    audioCodec: "FLAC",
    channels,
    sampleRate: sampleRate || null,
    bitsPerSample,
    durationSeconds: sampleRate > 0 && totalSamples > 0 ? totalSamples / sampleRate : null,
    trackCount: 1,
    hasAudioTrack: true,
    problems,
  };
}

/** An ID3v2 length: seven bits per byte, so a tag can never contain a frame sync. */
function synchsafe(bytes: Uint8Array, at: number): number {
  return (
    (((u8(bytes, at) ?? 0) & 0x7f) << 21) |
    (((u8(bytes, at + 1) ?? 0) & 0x7f) << 14) |
    (((u8(bytes, at + 2) ?? 0) & 0x7f) << 7) |
    ((u8(bytes, at + 3) ?? 0) & 0x7f)
  );
}

// ===================================================================
// MP3
//
// The ID3v2 size field is SYNCHSAFE - seven bits per byte, with the top
// bit always clear so a tag can never contain a byte sequence that looks
// like a frame sync. Reading it as a plain big-endian 32 overshoots by up
// to 268 bytes per megabyte of tag, and lands in the middle of the audio.
// ===================================================================

const MP3_BITRATES_V1_L1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0];
const MP3_BITRATES_V1_L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0];
const MP3_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MP3_BITRATES_V2_L1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0];
// MPEG-2 and MPEG-2.5 share ONE table for Layers II and III, and its
// values do not overlap MPEG-1's at all - so using the MPEG-1 table on a
// MPEG-2 file gives a plausible bitrate, a wrong frame length, and a walk
// that desynchronises immediately.
const MP3_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MP3_RATES_V1 = [44100, 48000, 32000, 0];
const MP3_RATES_V2 = [22050, 24000, 16000, 0];
const MP3_RATES_V25 = [11025, 12000, 8000, 0];

function probeMp3(bytes: Uint8Array, base: AudioProbe): AudioProbe | null {
  let at = 0;

  if (ascii(bytes, 0, 3) === "ID3") at = 10 + synchsafe(bytes, 6);

  // The first frame may not be exactly where the tag ends - some writers
  // leave padding - so a short scan follows.
  const sync = findMp3Sync(bytes, at);

  if (sync < 0) return null;

  const frame = readMp3Frame(bytes, sync);

  if (!frame) return null;

  // Constant-bitrate duration from the file size. A VBR file's Xing header
  // would give a better answer; this is reported as an ESTIMATE rather than
  // dressed up as exact, because a caller that refuses a file for being too
  // long must not do it on a guess.
  const audioBytes = base.byteSize === null ? null : base.byteSize - sync;
  const durationSeconds = audioBytes !== null ? audioBytes / ((frame.bitrateKbps * 1000) / 8) : null;

  return {
    ...base,
    container: "MP3",
    containerDetail: `MPEG layer ${frame.layer}, ${frame.bitrateKbps} kbps`,
    audioCodec: "MP3",
    // Channel mode 3 is single channel; the other three are all two.
    channels: frame.channelMode === 3 ? 1 : 2,
    sampleRate: frame.sampleRate,
    bitsPerSample: null,
    durationSeconds,
    // Derived from the file size and one frame's bitrate, so it is wrong
    // for every variable-bitrate file - which is most of them. Flagged
    // rather than hidden: see durationIsEstimated.
    durationIsEstimated: durationSeconds !== null,
    trackCount: 1,
    hasAudioTrack: true,
    // An MP3 that reached here has three chained frame headers behind it,
    // which is as much structural confidence as the format offers - it has
    // no index and no declared length, so there is nothing else to check.
    problems: [],
  };
}

// -------------------------------------------------------------------
// One MPEG audio frame header, decoded, or null if those four bytes are
// not one.
//
// Everything about an MP3 hangs off this, and the fields are laid out to
// catch a naive reader: the layer bits run backwards (01 is Layer III),
// MPEG-2 and 2.5 share a bitrate table that does not overlap MPEG-1's, and
// MPEG-2/2.5 Layer III packs 576 samples per frame rather than 1152 - so a
// frame length computed with the MPEG-1 constant is twice too long and the
// walk desynchronises on the very next frame.
// -------------------------------------------------------------------
type Mp3Frame = {
  versionBits: number;
  layer: number;
  bitrateKbps: number;
  sampleRate: number;
  channelMode: number;
  frameLength: number;
};

function readMp3Frame(bytes: Uint8Array, at: number): Mp3Frame | null {
  const header = u32be(bytes, at);

  if (header === null) return null;

  // Eleven bits of sync, not twelve: MPEG-2.5's version bits are 00, so a
  // twelve-bit test silently rejects every 2.5 file.
  if ((header & 0xffe00000) >>> 0 !== 0xffe00000) return null;

  const versionBits = (header >> 19) & 0x03;
  const layerBits = (header >> 17) & 0x03;
  const bitrateIndex = (header >> 12) & 0x0f;
  const rateIndex = (header >> 10) & 0x03;
  const padding = (header >> 9) & 0x01;
  const channelMode = (header >> 6) & 0x03;

  // 01 is reserved for both fields, and a free-format bitrate (0) or a
  // reserved rate (3) cannot have its frame length computed.
  if (versionBits === 1 || layerBits === 0) return null;
  if (bitrateIndex === 0 || bitrateIndex === 0x0f || rateIndex === 0x03) return null;

  const layer = layerBits === 1 ? 3 : layerBits === 2 ? 2 : 1;

  const rates = versionBits === 3 ? MP3_RATES_V1 : versionBits === 2 ? MP3_RATES_V2 : MP3_RATES_V25;
  const sampleRate = rates[rateIndex];

  if (!sampleRate) return null;

  const bitrateKbps = bitrateFor(versionBits, layer, bitrateIndex);

  if (!bitrateKbps) return null;

  // samplesPerFrame / 8, which is the constant every frame-length formula
  // is really made of.
  const samplesPerFrame = layer === 1 ? 384 : layer === 2 ? 1152 : versionBits === 3 ? 1152 : 576;

  const frameLength =
    layer === 1
      ? (Math.floor((12 * bitrateKbps * 1000) / sampleRate) + padding) * 4
      : Math.floor(((samplesPerFrame / 8) * bitrateKbps * 1000) / sampleRate) + padding;

  if (frameLength < 8) return null;

  return { versionBits, layer, bitrateKbps, sampleRate, channelMode, frameLength };
}

function bitrateFor(versionBits: number, layer: number, index: number): number {
  if (versionBits === 3) {
    return layer === 1
      ? MP3_BITRATES_V1_L1[index]
      : layer === 2
        ? MP3_BITRATES_V1_L2[index]
        : MP3_BITRATES_V1_L3[index];
  }

  // MPEG-2 and MPEG-2.5 share one table for Layers II and III, and a
  // separate one for Layer I.
  return layer === 1 ? MP3_BITRATES_V2_L1[index] : MP3_BITRATES_V2_L3[index];
}

// -------------------------------------------------------------------
// The first frame that is followed by ANOTHER frame where it says it will
// be.
//
// ONE SYNC IS NOT EVIDENCE. Eleven set bits plus a handful of non-reserved
// field values occur constantly in compressed or encrypted data, so
// accepting a single header meant roughly four in five unrecognised
// binaries were reported as MP3 - with an invented sample rate and an
// invented duration, which is exactly the confident-wrong-answer this
// module exists to avoid.
//
// A chain of three is the evidence. A real stream's frames abut exactly,
// so each header predicts where the next one starts; random data almost
// never satisfies that twice in a row.
// -------------------------------------------------------------------
function findMp3Sync(bytes: Uint8Array, from: number): number {
  const limit = Math.min(bytes.length - 4, from + 8192);

  for (let at = Math.max(0, from); at <= limit; at += 1) {
    if (bytes[at] !== 0xff) continue;

    const first = readMp3Frame(bytes, at);

    if (!first) continue;

    let offset = at;
    let frame: Mp3Frame | null = first;
    let chained = 0;

    while (frame && chained < 2) {
      const next = readMp3Frame(bytes, offset + frame.frameLength);

      // A stream does not change its version, layer or sample rate part way
      // through, so a "frame" that does is a coincidence rather than a
      // continuation.
      if (
        !next ||
        next.versionBits !== first.versionBits ||
        next.layer !== first.layer ||
        next.sampleRate !== first.sampleRate
      ) {
        break;
      }

      offset += frame.frameLength;
      frame = next;
      chained += 1;
    }

    // Two confirmations, or the end of the buffer reached while still
    // chaining - a short file is allowed to be short.
    if (chained >= 2 || offset + (frame?.frameLength ?? 0) >= bytes.length) return at;
  }

  return -1;
}

// -------------------------------------------------------------------
// The problems that mean this file cannot be transcribed, ever.
//
// DELIBERATELY SHORT, and the list is the whole policy. Everything absent
// from it is either survivable - a truncated recording still holds the
// speech that made it - or unknown, and an unknown file gets its chance
// with the service. The probe knows six containers and the upload accepts
// more, so refusing what it cannot parse would throw away recordings that
// transcribe perfectly.
//
// Shared rather than copied because it is applied twice, minutes and a
// network apart: once in the browser before an upload, once on the server
// before a Speech job is created. The two disagreeing would mean a file
// refused in one place and accepted in the other.
// -------------------------------------------------------------------
const FATAL_PROBLEMS: ReadonlySet<AudioProblemCode> = new Set([
  "empty",
  "too-short",
  "headerless",
  "video-only",
  "no-audio-track",
]);

export function fatalAudioProblem(probe: AudioProbe): AudioProblem | null {
  return probe.problems.find((problem) => FATAL_PROBLEMS.has(problem.code)) ?? null;
}

// -------------------------------------------------------------------
// The report, as one sentence somebody can act on.
//
// WRITTEN FOR THE PERSON WAITING, not for a log. It leads with what the
// file IS, because that is what turns "the audio format is invalid" into
// something a reader can check against what they think they recorded - and
// it puts the problems last, because those are the part worth acting on.
// -------------------------------------------------------------------
export function describeAudioProbe(probe: AudioProbe): string {
  const parts: string[] = [];

  if (probe.container) {
    parts.push(probe.containerDetail ? `${probe.container} (${probe.containerDetail})` : probe.container);
  }

  if (probe.audioCodec) parts.push(probe.audioCodec);

  if (probe.channels !== null) {
    parts.push(probe.channels === 1 ? "mono" : probe.channels === 2 ? "stereo" : `${probe.channels} channels`);
  }

  if (probe.sampleRate !== null) parts.push(`${Math.round(probe.sampleRate).toLocaleString()} Hz`);

  if (probe.durationSeconds !== null && probe.durationSeconds > 0) {
    parts.push(formatDurationApprox(probe.durationSeconds));
  }

  if (probe.byteSize !== null) parts.push(formatBytes(probe.byteSize));

  const what = parts.length > 0 ? `The stored file is ${parts.join(", ")}.` : "";
  const problems = probe.problems.map((problem) => problem.detail).join(" ");

  return [what, problems].filter((text) => text.length > 0).join(" ");
}

// -------------------------------------------------------------------
// The same facts as key=value pairs, for a log line.
//
// Separate from the sentence above because they are read by different
// people for different reasons: one is shown to somebody whose meeting did
// not transcribe, the other is grepped weeks later by whoever is asking
// which failures have something in common.
// -------------------------------------------------------------------
export function summariseAudioProbe(probe: AudioProbe): string {
  const fields: [string, string | number | null][] = [
    ["container", probe.container],
    ["detail", probe.containerDetail],
    ["codec", probe.audioCodec],
    ["channels", probe.channels],
    ["sampleRate", probe.sampleRate === null ? null : Math.round(probe.sampleRate)],
    ["bits", probe.bitsPerSample],
    ["seconds", probe.durationSeconds === null ? null : Math.round(probe.durationSeconds)],
    ["tracks", probe.trackCount],
    ["audioTrack", probe.hasAudioTrack === null ? null : String(probe.hasAudioTrack)],
    ["bytes", probe.byteSize],
    ["inspected", probe.inspectedBytes],
    ["complete", String(probe.isComplete)],
    ["problems", probe.problems.length === 0 ? "none" : probe.problems.map((p) => p.code).join("+")],
  ];

  return fields
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([name, value]) => `${name}=${typeof value === "string" && value.includes(" ") ? `"${value}"` : value}`)
    .join(" ");
}

/**
 * A sample rate, or null when the number is not one.
 *
 * A damaged header yields values like 3.4 billion or zero, and a probe that
 * reports those has done worse than fail - somebody reads a figure and acts
 * on it. Bounded generously: 8 kHz telephony at the bottom, 384 kHz studio
 * at the top, and anything outside that is a misread rather than a rate.
 */
function plausibleRate(rate: number | null): number | null {
  if (rate === null || !Number.isFinite(rate)) return null;

  return rate >= 1_000 && rate <= 384_000 ? rate : null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDurationApprox(seconds: number): string {
  if (seconds < 60) return `about ${Math.round(seconds)} seconds`;

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return `about ${hours}h ${rest.toString().padStart(2, "0")}m`;
}

function hexPreview(bytes: Uint8Array, count: number): string {
  return Array.from(bytes.slice(0, count), (byte) => byte.toString(16).padStart(2, "0")).join(" ");
}
