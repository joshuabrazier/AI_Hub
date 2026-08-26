// -------------------------------------------------------------------
// Converting a recording into something Azure Speech will actually decode.
//
// WHY THIS EXISTS. Azure Speech documents WAV, MP3, OPUS/OGG, FLAC, WMA,
// AAC, AMR, WebM and SPEEX. An .m4a - a phone voice memo, and the most
// common thing anybody uploads here - is AAC inside an MP4 container, and
// the batch service refuses it outright:
//
//   InvalidData: The recordings URI contains invalid data.
//
// That is the service having downloaded the file and failed to decode it,
// which is a different thing from InvalidUri (could not fetch it at all).
// No amount of retrying or relabelling fixes it; the bytes have to change.
//
// WHY IN THE BROWSER. Converting on the server would need ffmpeg, which is
// not available on the App Service Node runtime - it would mean either a
// custom container for the whole app or a separate Function App. Doing it
// here needs neither, and it also means the file crossing the network is
// the SMALLER one: 16 kHz mono is roughly a tenth of what a phone records.
//
// WHAT IT PRODUCES. 16 kHz, mono, 16-bit PCM in a WAV container. That is
// the top of Azure's documented list, and 16 kHz mono is what speech
// recognition uses internally anyway - resampling higher costs bandwidth
// and buys nothing. Downmixing to mono is not a loss either: diarisation
// separates speakers from one channel, not from stereo placement.
//
// WHAT IT DOES NOT DO. It never silently drops a file. Anything it cannot
// decode is passed through untouched for Azure to judge, because a format
// this cannot read may still be one the service can - and refusing here
// would take away a recording of a meeting that already happened.
// -------------------------------------------------------------------

/** 16 kHz mono is what the recogniser works at. Anything more is wasted bytes. */
const TARGET_SAMPLE_RATE = 16_000;

// -------------------------------------------------------------------
// The containers Azure has been observed to refuse.
//
// Only the MP4 family. Everything on the documented list is left alone -
// converting a file the service already reads would be pure loss, both in
// quality and in the time somebody waits.
//
// .mp4 and .mov are here as well as .m4a: they are the same container with
// video in them, and a screen recording fails for the same reason.
// -------------------------------------------------------------------
const EXTENSIONS_NEEDING_CONVERSION = [".m4a", ".mp4", ".m4v", ".mov", ".3gp", ".3gpp"];

export function needsConversion(fileName: string): boolean {
  const lower = fileName.toLowerCase();

  return EXTENSIONS_NEEDING_CONVERSION.some((extension) => lower.endsWith(extension));
}

// -------------------------------------------------------------------
// Decoding holds the whole recording in memory as PCM, so there is a
// length beyond which this cannot run in a browser tab at all.
//
// At 16 kHz mono float32 an hour is about 230 MB, and the decoder needs
// the source and the result at once. Three hours is the point where a
// desktop starts failing and a phone has already failed, so it is refused
// with an explanation rather than crashing the tab half way through.
// -------------------------------------------------------------------
const MAX_CONVERTIBLE_SECONDS = 3 * 60 * 60;

export type ConversionResult =
  | { converted: true; file: File }
  // Left alone, with the reason. The caller uploads the original.
  | { converted: false; reason: "not-needed" | "unsupported" | "too-long" | "failed" };

// -------------------------------------------------------------------
// Convert if it needs it, otherwise hand the file straight back.
//
// Never throws. Every failure path returns `converted: false` and the
// caller uploads what the person chose - the conversion is an improvement
// on the odds, not a gate in front of the feature.
// -------------------------------------------------------------------
export async function convertForTranscription(file: File): Promise<ConversionResult> {
  if (!needsConversion(file.name)) return { converted: false, reason: "not-needed" };

  // Safari before 14.1 and anything without Web Audio. Rare, and the
  // original still gets its chance.
  const AudioContextClass =
    typeof window === "undefined"
      ? undefined
      : (window.OfflineAudioContext ??
        (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext);

  if (!AudioContextClass) return { converted: false, reason: "unsupported" };

  try {
    const sourceBytes = await file.arrayBuffer();

    // A one-frame context purely to borrow its decoder. Per the Web Audio
    // spec decodeAudioData resamples to the context's rate, so asking for
    // 16 kHz here is what avoids ever materialising 48 kHz stereo.
    const decodeContext = new AudioContextClass(1, 1, TARGET_SAMPLE_RATE);

    const decoded = await decodeContext.decodeAudioData(sourceBytes);

    if (decoded.duration > MAX_CONVERTIBLE_SECONDS) {
      return { converted: false, reason: "too-long" };
    }

    const mono = downmixToMono(decoded);

    const wav = encodeWav(mono, TARGET_SAMPLE_RATE);

    return {
      converted: true,
      file: new File([wav], replaceExtension(file.name, ".wav"), { type: "audio/wav" }),
    };
  } catch {
    // An unreadable container, a codec the browser has no decoder for
    // (ALAC on Chrome, for one), or memory. All of them mean the same
    // thing here: upload the original and let the service decide.
    return { converted: false, reason: "failed" };
  }
}

// -------------------------------------------------------------------
// Average the channels rather than taking the first.
//
// Taking channel 0 would silently drop anybody who happened to be on the
// other side of a stereo recording - which is exactly what a phone on a
// table between two people produces.
// -------------------------------------------------------------------
function downmixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);

  const length = buffer.length;
  const mixed = new Float32Array(length);

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);

    for (let index = 0; index < length; index += 1) {
      mixed[index] += data[index];
    }
  }

  for (let index = 0; index < length; index += 1) {
    mixed[index] /= buffer.numberOfChannels;
  }

  return mixed;
}

// -------------------------------------------------------------------
// Float samples to a 16-bit PCM WAV.
//
// Exported for its own test: it is the one piece here that is pure, and
// a header a byte out produces a file that looks fine locally and is
// rejected by the service - the failure this whole module exists to fix.
// -------------------------------------------------------------------
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const BYTES_PER_SAMPLE = 2;
  const CHANNELS = 1;
  const HEADER_BYTES = 44;

  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  // RIFF chunk descriptor.
  writeAscii(0, "RIFF");
  // Everything after this field, so the whole file minus the 8 bytes of
  // "RIFF" and this length itself.
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");

  // fmt sub-chunk.
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // format 1 = uncompressed PCM
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * CHANNELS * BYTES_PER_SAMPLE, true); // byte rate
  view.setUint16(32, CHANNELS * BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true); // bits per sample

  // data sub-chunk.
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);

  // Clamped before scaling. Decoded audio can sit slightly outside -1..1,
  // and letting it wrap turns a loud passage into white noise rather than
  // clipping it.
  let offset = HEADER_BYTES;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));

    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += BYTES_PER_SAMPLE;
  }

  return buffer;
}

// -------------------------------------------------------------------
// Swap the extension, because the SERVER derives the stored media type
// from the filename. A converted WAV still called .m4a would be stored as
// audio/mp4 and handed to Azure as the very thing it just refused.
// -------------------------------------------------------------------
export function replaceExtension(fileName: string, extension: string): string {
  const lastDot = fileName.lastIndexOf(".");

  return (lastDot === -1 ? fileName : fileName.slice(0, lastDot)) + extension;
}
