import { describe, expect, it } from "vitest";

import { describeAudioProbe, probeAudioBytes, summariseAudioProbe } from "./audio-probe";

// -------------------------------------------------------------------
// Fixtures built byte by byte, because that is the only honest way to test
// a parser: a file produced by the same assumptions the parser holds would
// agree with it whether or not either was right.
//
// The failure mode this guards against is a probe that reports a plausible
// WRONG number. "48000 Hz" when the file says 44100 is worse than "could
// not tell" - somebody acts on it.
// -------------------------------------------------------------------

const bytes = (...parts: (number[] | Uint8Array)[]): Uint8Array => {
  const flat: number[] = [];

  for (const part of parts) flat.push(...Array.from(part));

  return Uint8Array.from(flat);
};

const ascii = (text: string): number[] => Array.from(text, (character) => character.charCodeAt(0));

// ---- EBML builders -------------------------------------------------

/** An EBML element size as a variable-length integer. */
const vint = (value: number): number[] => {
  if (value < 0x7f) return [0x80 | value];
  if (value < 0x3fff) return [0x40 | (value >> 8), value & 0xff];

  return [0x10, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
};

const el = (id: number[], payload: number[]): number[] => [...id, ...vint(payload.length), ...payload];

/** A master element whose size is UNKNOWN, which is what MediaRecorder writes for Segment. */
const openEl = (id: number[], payload: number[]): number[] => [...id, 0xff, ...payload];

const uint = (value: number): number[] => {
  const out: number[] = [];
  let remaining = value;

  do {
    out.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  } while (remaining > 0);

  return out;
};

const f32 = (value: number): number[] => {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, value, false);

  return Array.from(new Uint8Array(buffer));
};

const f64 = (value: number): number[] => {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, false);

  return Array.from(new Uint8Array(buffer));
};

const f64be = (value: number): number[] => {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, false);

  return Array.from(new Uint8Array(buffer));
};

const ID = {
  ebml: [0x1a, 0x45, 0xdf, 0xa3],
  docType: [0x42, 0x82],
  segment: [0x18, 0x53, 0x80, 0x67],
  info: [0x15, 0x49, 0xa9, 0x66],
  timecodeScale: [0x2a, 0xd7, 0xb1],
  duration: [0x44, 0x89],
  tracks: [0x16, 0x54, 0xae, 0x6b],
  trackEntry: [0xae],
  trackType: [0x83],
  codecId: [0x86],
  audio: [0xe1],
  samplingFrequency: [0xb5],
  channels: [0x9f],
  cluster: [0x1f, 0x43, 0xb6, 0x75],
};

function webmFile(
  options: {
    docType?: string;
    durationMs?: number;
    trackType?: number;
    codecId?: string;
    channels?: number;
    sampleRate?: number;
    omitTracks?: boolean;
  } = {},
): number[] {
  const {
    docType = "webm",
    durationMs = 23_000,
    trackType = 2,
    codecId = "A_OPUS",
    channels = 1,
    sampleRate = 48_000,
    omitTracks = false,
  } = options;

  const trackEntry = el(ID.trackEntry, [
    ...el(ID.trackType, uint(trackType)),
    ...el(ID.codecId, ascii(codecId)),
    ...el(ID.audio, [...el(ID.samplingFrequency, f32(sampleRate)), ...el(ID.channels, uint(channels))]),
  ]);

  return [
    ...el(ID.ebml, el(ID.docType, ascii(docType))),
    ...openEl(ID.segment, [
      // TimecodeScale is nanoseconds per tick, and Duration is in ticks -
      // so the default 1,000,000 makes Duration milliseconds.
      ...el(ID.info, [...el(ID.timecodeScale, uint(1_000_000)), ...el(ID.duration, f64(durationMs))]),
      ...(omitTracks ? [] : el(ID.tracks, trackEntry)),
      ...el(ID.cluster, [0x00, 0x11, 0x22, 0x33]),
    ]),
  ];
}

// ---- MP4 builders --------------------------------------------------

const be32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff,
];

const be16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff];

const box = (type: string, payload: number[]): number[] => [
  ...be32(payload.length + 8),
  ...ascii(type),
  ...payload,
];

function mp4File(
  options: { brand?: string; handler?: string; format?: string; channels?: number; sampleRate?: number } = {},
): number[] {
  const { brand = "M4A ", handler = "soun", format = "mp4a", channels = 1, sampleRate = 44_100 } = options;

  // AudioSampleEntry: 6 reserved, 2 data_reference_index, 8 of
  // version/revision/vendor, then channelcount, samplesize, pre_defined,
  // reserved, and a 16.16 fixed-point sample rate.
  const sampleEntry = box(format, [
    ...new Array(6).fill(0),
    ...be16(1),
    ...new Array(8).fill(0),
    ...be16(channels),
    ...be16(16),
    ...be16(0),
    ...be16(0),
    ...be16(sampleRate),
    ...be16(0),
  ]);

  const stsd = box("stsd", [...be32(0), ...be32(1), ...sampleEntry]);

  return [
    ...box("ftyp", [...ascii(brand), ...be32(512), ...ascii("isom")]),
    ...box("moov", [
      // mvhd version 0: creation, modification, timescale, duration.
      ...box("mvhd", [
        0x00,
        0x00,
        0x00,
        0x00,
        ...be32(0),
        ...be32(0),
        ...be32(1_000),
        ...be32(23_000),
        ...new Array(80).fill(0),
      ]),
      ...box("trak", [
        ...box("mdia", [
          // hdlr: version+flags, pre_defined, handler type.
          ...box("hdlr", [...be32(0), ...be32(0), ...ascii(handler), ...new Array(12).fill(0)]),
          ...box("minf", [...box("stbl", stsd)]),
        ]),
      ]),
    ]),
    ...box("mdat", [0x00, 0x01, 0x02, 0x03]),
  ];
}

// ---- WAV -----------------------------------------------------------

const le32 = (value: number): number[] => [
  value & 0xff,
  (value >>> 8) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 24) & 0xff,
];

const le16 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff];

function wavFile(options: { dataBytes?: number; declaredDataBytes?: number } = {}): number[] {
  const { dataBytes = 32_000, declaredDataBytes = dataBytes } = options;

  const fmt = [...le16(1), ...le16(1), ...le32(16_000), ...le32(32_000), ...le16(2), ...le16(16)];

  const body = [
    ...ascii("WAVE"),
    ...ascii("fmt "),
    ...le32(fmt.length),
    ...fmt,
    ...ascii("data"),
    ...le32(declaredDataBytes),
    ...new Array(dataBytes).fill(0),
  ];

  return [...ascii("RIFF"), ...le32(body.length), ...body];
}

// ---- Tests ---------------------------------------------------------

describe("probeAudioBytes - nothing to read", () => {
  it("names an empty file as empty rather than as an unknown format", () => {
    const probe = probeAudioBytes(new Uint8Array(0), { byteSize: 0 });

    expect(probe.problems[0].code).toBe("empty");
  });

  it("names a file far too small to be a recording", () => {
    const probe = probeAudioBytes(Uint8Array.from([1, 2, 3, 4]), { byteSize: 4 });

    expect(probe.problems[0].code).toBe("too-short");
    expect(probe.problems[0].detail).toContain("4 bytes");
  });

  it("shows the first bytes of something it cannot identify, so it can be looked up", () => {
    const probe = probeAudioBytes(Uint8Array.from(new Array(64).fill(0x7a)), { byteSize: 64 });

    expect(probe.problems[0].code).toBe("unknown-container");
    expect(probe.problems[0].detail).toContain("7a 7a");
  });

  it("separates a missing header from an unrecognised one", () => {
    // A recording whose first chunk never reached the device. The header is
    // not absent from the FILE, it is absent from the START of it - which is
    // a different fault with a different answer.
    const headless = bytes(new Array(200).fill(0x22), webmFile());
    const probe = probeAudioBytes(headless, { byteSize: headless.length });

    expect(probe.problems[0].code).toBe("headerless");
    expect(probe.problems[0].detail).toContain("WebM");
  });
});

describe("probeAudioBytes - WebM", () => {
  const file = Uint8Array.from(webmFile());

  it("reads the container, codec, channels and sample rate", () => {
    const probe = probeAudioBytes(file, { byteSize: file.length });

    expect(probe.container).toBe("WebM");
    expect(probe.containerDetail).toBe("DocType webm");
    expect(probe.audioCodec).toBe("Opus");
    expect(probe.channels).toBe(1);
    expect(probe.sampleRate).toBe(48_000);
  });

  it("converts Duration through TimecodeScale rather than reporting raw ticks", () => {
    // Duration is in TimecodeScale units, not seconds. Reporting 23000
    // seconds for a 23 second clip is exactly the plausible-wrong-number
    // failure this file exists to prevent.
    const probe = probeAudioBytes(file, { byteSize: file.length });

    expect(probe.durationSeconds).toBeCloseTo(23, 3);
  });

  it("copes with the UNKNOWN Segment size MediaRecorder writes", () => {
    // A live recording does not know its own length, so its Segment size is
    // all ones. A parser that treats that as corruption rejects every
    // recording this app makes.
    const probe = probeAudioBytes(file, { byteSize: file.length });

    expect(probe.problems).toEqual([]);
    expect(probe.trackCount).toBe(1);
  });

  it("catches two recordings joined together and says where the join is", () => {
    const first = webmFile();
    const spliced = Uint8Array.from([...first, ...first]);

    const probe = probeAudioBytes(spliced, { byteSize: spliced.length });
    const splice = probe.problems.find((problem) => problem.code === "spliced");

    expect(splice).toBeDefined();
    // Still reads the FIRST recording's details rather than giving up.
    expect(probe.audioCodec).toBe("Opus");
  });

  it("says video-only rather than 'invalid' when there is no audio track", () => {
    const video = Uint8Array.from(webmFile({ trackType: 1, codecId: "V_VP8" }));
    const probe = probeAudioBytes(video, { byteSize: video.length });

    expect(probe.problems.map((problem) => problem.code)).toContain("video-only");
    expect(probe.hasAudioTrack).toBe(false);
  });

  it("reports an unknown codec id verbatim rather than calling it nothing", () => {
    const odd = Uint8Array.from(webmFile({ codecId: "A_SOMETHING_NEW" }));
    const probe = probeAudioBytes(odd, { byteSize: odd.length });

    expect(probe.audioCodec).toBe("A_SOMETHING_NEW");
  });

  it("does not claim tracks it never saw when the window ended early", () => {
    const full = Uint8Array.from(webmFile());
    // Only the EBML header survives the cut.
    const head = full.slice(0, 12);

    const probe = probeAudioBytes(head, { byteSize: full.length });

    expect(probe.isComplete).toBe(false);
    expect(probe.hasAudioTrack).toBeNull();
  });
});

describe("probeAudioBytes - MP4", () => {
  const file = Uint8Array.from(mp4File());

  it("finds the brand, codec, channels and sample rate", () => {
    const probe = probeAudioBytes(file, { byteSize: file.length });

    expect(probe.container).toBe("MP4");
    expect(probe.containerDetail).toBe("brand M4A");
    expect(probe.audioCodec).toBe("AAC");
    expect(probe.channels).toBe(1);
    expect(probe.sampleRate).toBe(44_100);
  });

  it("divides duration by the movie timescale", () => {
    const probe = probeAudioBytes(file, { byteSize: file.length });

    expect(probe.durationSeconds).toBeCloseTo(23, 3);
  });

  it("says a video-only file has no speech in it", () => {
    const video = Uint8Array.from(mp4File({ handler: "vide", format: "avc1" }));
    const probe = probeAudioBytes(video, { byteSize: video.length });

    expect(probe.problems.map((problem) => problem.code)).toContain("video-only");
  });

  it("distinguishes 'moov is further in' from 'moov is missing'", () => {
    // A phone writes the audio and appends the index, so on an .m4a the
    // track list is at the END. Reading only the head and then announcing
    // the file has no tracks would be a confident lie.
    const full = Uint8Array.from(mp4File());
    const head = full.slice(0, 16);

    const partial = probeAudioBytes(head, { byteSize: full.length });
    const complete = probeAudioBytes(head, { byteSize: head.length });

    expect(partial.problems[0].detail).toContain("beyond the section that was read");
    expect(complete.problems[0].detail).toContain("no moov box");
  });

  it("catches a second MP4 appended to the first", () => {
    const doubled = Uint8Array.from([...mp4File(), ...mp4File()]);
    const probe = probeAudioBytes(doubled, { byteSize: doubled.length });

    expect(probe.problems.map((problem) => problem.code)).toContain("spliced");
  });
});

describe("probeAudioBytes - WAV", () => {
  it("reads the format this app writes when it re-encodes a recording", () => {
    const file = Uint8Array.from(wavFile());
    const probe = probeAudioBytes(file, { byteSize: file.length });

    expect(probe.container).toBe("WAV");
    expect(probe.audioCodec).toBe("PCM");
    expect(probe.channels).toBe(1);
    expect(probe.sampleRate).toBe(16_000);
    expect(probe.bitsPerSample).toBe(16);
    // 32,000 bytes of 16-bit mono at 16 kHz is exactly one second.
    expect(probe.durationSeconds).toBeCloseTo(1, 3);
  });

  it("catches a WAV whose data chunk promises more than is there", () => {
    // The classic truncated-WAV signature, and one this app could produce
    // itself if an encode were interrupted.
    const file = Uint8Array.from(wavFile({ dataBytes: 1_000, declaredDataBytes: 500_000 }));
    const probe = probeAudioBytes(file, { byteSize: file.length });

    expect(probe.problems.map((problem) => problem.code)).toContain("truncated");
  });

  it("notices a container with no audio in it", () => {
    const file = Uint8Array.from(wavFile({ dataBytes: 0 }));
    const probe = probeAudioBytes(file, { byteSize: file.length });

    expect(probe.problems.map((problem) => problem.code)).toContain("empty");
  });
});

describe("probeAudioBytes - Ogg and FLAC", () => {
  it("reads channel count and rate out of an OpusHead", () => {
    const file = bytes(
      ascii("OggS"),
      [0x00, 0x02],
      new Array(20).fill(0),
      [0x01, 0x13],
      ascii("OpusHead"),
      [0x01, 0x02],
      le16(312),
      le32(48_000),
    );

    const probe = probeAudioBytes(file, { byteSize: file.length });

    expect(probe.container).toBe("Ogg");
    expect(probe.audioCodec).toBe("Opus");
    expect(probe.channels).toBe(2);
    expect(probe.sampleRate).toBe(48_000);
  });

  it("reads FLAC's bit-packed stream information", () => {
    // 44,100 Hz is 20 bits, then 3 bits of channels-minus-one and 5 of
    // bit-depth-minus-one. None of it is byte aligned, and a boundary off
    // by one produces a number that looks fine.
    const rate = 44_100;
    const channels = 2;
    const bits = 16;
    const totalSamples = 44_100 * 3;

    const packed = [
      (rate >> 12) & 0xff,
      (rate >> 4) & 0xff,
      ((rate & 0x0f) << 4) | ((channels - 1) << 1) | (((bits - 1) >> 4) & 0x01),
      (((bits - 1) & 0x0f) << 4) | ((totalSamples / 2 ** 32) & 0x0f),
      (totalSamples >>> 24) & 0xff,
      (totalSamples >>> 16) & 0xff,
      (totalSamples >>> 8) & 0xff,
      totalSamples & 0xff,
    ];

    const file = bytes(ascii("fLaC"), [0x00, 0x00, 0x00, 0x22], new Array(10).fill(0), packed);

    const probe = probeAudioBytes(file, { byteSize: file.length });

    expect(probe.container).toBe("FLAC");
    expect(probe.sampleRate).toBe(44_100);
    expect(probe.channels).toBe(2);
    expect(probe.bitsPerSample).toBe(16);
    expect(probe.durationSeconds).toBeCloseTo(3, 3);
  });
});

describe("probeAudioBytes - MP3", () => {
  it("skips an ID3v2 tag using its SYNCHSAFE length", () => {
    // Seven bits per byte. Read as a plain big-endian 32 this overshoots and
    // lands in the audio, so the frame is never found and a perfectly good
    // MP3 is reported as an unknown format.
    const tagBytes = 200;
    const synchsafe = [
      (tagBytes >> 21) & 0x7f,
      (tagBytes >> 14) & 0x7f,
      (tagBytes >> 7) & 0x7f,
      tagBytes & 0x7f,
    ];

    const file = bytes(
      ascii("ID3"),
      [0x03, 0x00, 0x00],
      synchsafe,
      new Array(tagBytes).fill(0),
      // MPEG-1 Layer III, 128 kbps, 44.1 kHz, joint stereo.
      [0xff, 0xfb, 0x90, 0x44],
      new Array(400).fill(0),
    );

    const probe = probeAudioBytes(file, { byteSize: file.length });

    expect(probe.container).toBe("MP3");
    expect(probe.sampleRate).toBe(44_100);
    expect(probe.containerDetail).toContain("layer 3");
    expect(probe.containerDetail).toContain("128 kbps");
  });

  it("reads a mono frame as one channel", () => {
    // Channel mode 3 is single channel. The bits sit in the fourth header
    // byte, which is the one most easily read from the wrong offset.
    const file = bytes([0xff, 0xfb, 0x90, 0xc4], new Array(400).fill(0));
    const probe = probeAudioBytes(file, { byteSize: file.length });

    expect(probe.channels).toBe(1);
  });
});

describe("describeAudioProbe", () => {
  it("leads with what the file is, which is the part Azure never says", () => {
    const file = Uint8Array.from(webmFile());
    const sentence = describeAudioProbe(probeAudioBytes(file, { byteSize: file.length }));

    expect(sentence).toContain("WebM");
    expect(sentence).toContain("Opus");
    expect(sentence).toContain("mono");
    expect(sentence).toContain("48,000 Hz");
    expect(sentence).toContain("23 seconds");
  });

  it("puts the problem after the description, because that is the actionable half", () => {
    const first = webmFile();
    const spliced = Uint8Array.from([...first, ...first]);

    const sentence = describeAudioProbe(probeAudioBytes(spliced, { byteSize: spliced.length }));

    expect(sentence.indexOf("WebM")).toBeLessThan(sentence.indexOf("two separate recordings"));
  });

  it("says something useful even when nothing could be identified", () => {
    const junk = Uint8Array.from(new Array(64).fill(0x5a));
    const sentence = describeAudioProbe(probeAudioBytes(junk, { byteSize: 64 }));

    expect(sentence.length).toBeGreaterThan(0);
    expect(sentence).toContain("does not begin with any audio or video format");
  });
});

describe("summariseAudioProbe", () => {
  it("writes one greppable line with no spaces inside a value", () => {
    const file = Uint8Array.from(webmFile());
    const line = summariseAudioProbe(probeAudioBytes(file, { byteSize: file.length }));

    expect(line).toContain("container=WebM");
    expect(line).toContain("codec=Opus");
    expect(line).toContain("channels=1");
    expect(line).toContain("problems=none");
    // A value containing a space is quoted, so splitting the line on spaces
    // cannot silently produce a wrong field count.
    expect(line).toContain('detail="DocType webm"');
  });

  it("names every problem found, joined, so one line answers 'what was wrong'", () => {
    const first = webmFile({ trackType: 1, codecId: "V_VP8" });
    const spliced = Uint8Array.from([...first, ...first]);

    const line = summariseAudioProbe(probeAudioBytes(spliced, { byteSize: spliced.length }));

    expect(line).toContain("problems=spliced+video-only");
  });
});

// -------------------------------------------------------------------
// The corrections. Each of these was a real defect in the first version of
// this parser, and each produced a confidently wrong answer rather than an
// error - which is the only failure mode that matters in a diagnostic.
// -------------------------------------------------------------------

describe("probeAudioBytes - not fooled by four lucky bytes", () => {
  it("does not call a recording spliced because its audio contains the magic number", () => {
    // THE MOST DANGEROUS FALSE POSITIVE IN THE MODULE. Four bytes recur by
    // chance about once every 4 GB, so a 500 MB meeting has roughly a one
    // in eight chance of containing the EBML magic somewhere in its
    // compressed audio - and the caller TRUNCATES on a yes.
    const payload = [...ID.ebml, 0x01, 0x02, 0x03, 0x04, ...new Array(200).fill(0x77)];
    const file = Uint8Array.from([...webmFile(), ...payload]);

    const probe = probeAudioBytes(file, { byteSize: file.length });

    expect(probe.problems.map((problem) => problem.code)).not.toContain("spliced");
  });

  it("still catches a real second recording, which carries a DocType", () => {
    // The distinguishing evidence: an element id AND a length AND the
    // letters "webm" where the format says they belong. Chance does not
    // produce that.
    const doubled = Uint8Array.from([...webmFile(), ...webmFile()]);

    expect(probeAudioBytes(doubled, { byteSize: doubled.length }).problems.map((p) => p.code)).toContain(
      "spliced",
    );
  });

  it("does not call an MP4 spliced on a stray ftyp in its payload", () => {
    const file = Uint8Array.from([...mp4File(), ...ascii("ftyp"), ...new Array(200).fill(0x41)]);

    expect(probeAudioBytes(file, { byteSize: file.length }).problems.map((p) => p.code)).not.toContain(
      "spliced",
    );
  });
});

describe("probeAudioBytes - WebM corrections", () => {
  it("reads codec ids that contain SLASHES, which the real ones do", () => {
    // The ids are A_MPEG/L3 and A_PCM/INT/LIT. An underscored lookup table
    // never matches them, so every MP3-in-WebM fell through to its raw id.
    const file = Uint8Array.from(webmFile({ codecId: "A_MPEG/L3" }));

    expect(probeAudioBytes(file, { byteSize: file.length }).audioCodec).toBe("MP3");
  });

  it("matches the whole PCM family, which has six ids meaning one thing", () => {
    const file = Uint8Array.from(webmFile({ codecId: "A_PCM/FLOAT/IEEE" }));

    expect(probeAudioBytes(file, { byteSize: file.length }).audioCodec).toBe("PCM");
  });

  it("applies the format's own defaults rather than reporting them as unknown", () => {
    // Matroska says an absent Channels means one and an absent
    // SamplingFrequency means 8000. Reporting null describes the file as
    // less known than it is.
    const bare = [
      ...el(ID.ebml, el(ID.docType, ascii("webm"))),
      ...openEl(ID.segment, [
        ...el(ID.tracks, el(ID.trackEntry, [...el(ID.trackType, uint(2)), ...el(ID.codecId, ascii("A_OPUS"))])),
        ...el(ID.cluster, [0x11]),
      ]),
    ];

    const probe = probeAudioBytes(Uint8Array.from(bare), { byteSize: bare.length });

    expect(probe.channels).toBe(1);
    expect(probe.sampleRate).toBe(8_000);
  });

  it("prefers the OUTPUT sample rate, because Opus always claims 48 kHz", () => {
    // Opus is defined at 48 kHz and declares it whatever the microphone
    // did, so showing that figure to somebody as evidence about their
    // hardware is misleading.
    const withOutput = [
      ...el(ID.ebml, el(ID.docType, ascii("webm"))),
      ...openEl(ID.segment, [
        ...el(
          ID.tracks,
          el(ID.trackEntry, [
            ...el(ID.trackType, uint(2)),
            ...el(ID.codecId, ascii("A_OPUS")),
            ...el(ID.audio, [
              ...el(ID.samplingFrequency, f32(48_000)),
              ...el([0x78, 0xb5], f32(16_000)),
              ...el(ID.channels, uint(1)),
            ]),
          ]),
        ),
        ...el(ID.cluster, [0x11]),
      ]),
    ];

    expect(probeAudioBytes(Uint8Array.from(withOutput), { byteSize: withOutput.length }).sampleRate).toBe(
      16_000,
    );
  });

  it("reports an element that claims more bytes than the file has", () => {
    // The walk clamps such a size so nothing reads past the end, and used
    // to clamp it silently - so the commonest shape of a damaged recording
    // produced a clean report.
    const full = webmFile();
    const cut = Uint8Array.from(full.slice(0, full.length - 40));

    const probe = probeAudioBytes(cut, { byteSize: cut.length });

    expect(probe.problems.map((problem) => problem.code)).toContain("truncated");
  });

  it("does not call a HEAD SLICE truncated, which every one of them is", () => {
    const full = Uint8Array.from(webmFile());
    const head = full.slice(0, 60);

    const probe = probeAudioBytes(head, { byteSize: full.length });

    expect(probe.problems.map((problem) => problem.code)).not.toContain("truncated");
  });
});

describe("probeAudioBytes - MP4 corrections", () => {
  it("accepts a QuickTime file that does not begin with ftyp", () => {
    // .mov is the parent format and legally opens with moov, mdat, wide,
    // free, skip or pnot. Requiring ftyp rejects real files - a Mac screen
    // recording among them.
    const mov = [...box("wide", [0, 0, 0, 0]), ...mp4File().slice(0)];

    expect(probeAudioBytes(Uint8Array.from(mov), { byteSize: mov.length }).container).toBe("MP4");
  });

  it("treats an all-ones duration as unknown rather than as 27 hours", () => {
    const unknown = [
      ...box("ftyp", [...ascii("M4A "), ...be32(512), ...ascii("isom")]),
      ...box("moov", [
        ...box("mvhd", [
          0,
          0,
          0,
          0,
          ...be32(0),
          ...be32(0),
          ...be32(1_000),
          ...be32(0xffffffff),
          ...new Array(80).fill(0),
        ]),
      ]),
    ];

    expect(probeAudioBytes(Uint8Array.from(unknown), { byteSize: unknown.length }).durationSeconds).toBeNull();
  });

  it("reads a version 2 sound description, whose real fields moved", () => {
    // The legacy sample rate is 16.16 fixed point and cannot hold 96 kHz,
    // which is why version 2 exists - it parks 3 and 1 in the old fields
    // and puts the truth further in. A parser reading the old offsets
    // reports "3 channels at 1 Hz" and looks like it worked.
    const v2Entry = box("mp4a", [
      ...new Array(6).fill(0),
      ...be16(1),
      ...be16(2),
      ...be16(0),
      ...be32(0),
      ...be16(3),
      ...be16(16),
      ...be16(0),
      ...be16(0),
      ...be16(1),
      ...be16(0),
      // sizeOfStructOnly, which the real values sit after.
      ...be32(72),
      ...f64be(96_000),
      ...be32(2),
      ...new Array(20).fill(0),
    ]);

    const file = [
      ...box("ftyp", [...ascii("M4A "), ...be32(512), ...ascii("isom")]),
      ...box("moov", [
        ...box("mvhd", [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(1_000), ...be32(1_000), ...new Array(80).fill(0)]),
        ...box("trak", [
          ...box("mdia", [
            ...box("hdlr", [...be32(0), ...be32(0), ...ascii("soun"), ...new Array(12).fill(0)]),
            ...box("minf", [...box("stbl", box("stsd", [...be32(0), ...be32(1), ...v2Entry]))]),
          ]),
        ]),
      ]),
    ];

    const probe = probeAudioBytes(Uint8Array.from(file), { byteSize: file.length });

    expect(probe.sampleRate).toBe(96_000);
    expect(probe.channels).toBe(2);
  });

  it("names an encrypted track by its real codec and says it is DRM", () => {
    // 'enca' is not a codec - it means the track is protected, and the
    // original format is kept in sinf -> frma. Reporting "enca" sends
    // somebody looking up a format that does not exist.
    const encEntry = box("enca", [
      ...new Array(6).fill(0),
      ...be16(1),
      ...new Array(8).fill(0),
      ...be16(1),
      ...be16(16),
      ...be16(0),
      ...be16(0),
      ...be16(44_100),
      ...be16(0),
      ...box("sinf", box("frma", ascii("mp4a"))),
    ]);

    const file = [
      ...box("ftyp", [...ascii("M4A "), ...be32(512), ...ascii("isom")]),
      ...box("moov", [
        ...box("mvhd", [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(1_000), ...be32(1_000), ...new Array(80).fill(0)]),
        ...box("trak", [
          ...box("mdia", [
            ...box("hdlr", [...be32(0), ...be32(0), ...ascii("soun"), ...new Array(12).fill(0)]),
            ...box("minf", [...box("stbl", box("stsd", [...be32(0), ...be32(1), ...encEntry]))]),
          ]),
        ]),
      ]),
    ];

    const probe = probeAudioBytes(Uint8Array.from(file), { byteSize: file.length });

    expect(probe.audioCodec).toBe("AAC");
    expect(probe.problems.map((problem) => problem.detail).join(" ")).toContain("encrypted");
  });
});

describe("probeAudioBytes - WAV and FLAC corrections", () => {
  it("names RIFX rather than reading it as a corrupt RIFF", () => {
    // Same layout, every field big-endian. A little-endian walker reports a
    // four gigabyte file at 16 MHz, which reads as damage rather than as
    // the wrong endianness.
    const rifx = [...ascii("RIFX"), 0, 0, 0, 0x24, ...ascii("WAVE"), ...new Array(64).fill(0)];
    const probe = probeAudioBytes(Uint8Array.from(rifx), { byteSize: rifx.length });

    expect(probe.containerDetail).toBe("RIFX");
    expect(probe.sampleRate).toBeNull();
  });

  it("derives duration from the samples PRESENT, not from the claim", () => {
    // A streaming encoder cannot seek back to patch the size fields, so a
    // browser-written WAV routinely over-claims. The audio that is there
    // decodes perfectly and must not be thrown away.
    const file = Uint8Array.from(wavFile({ dataBytes: 32_000, declaredDataBytes: 500_000 }));
    const probe = probeAudioBytes(file, { byteSize: file.length });

    expect(probe.durationSeconds).toBeCloseTo(1, 2);
    expect(probe.problems.map((problem) => problem.detail).join(" ")).toContain("never went back to correct");
  });

  it("treats a FLAC sample rate of zero as unknown rather than damaged", () => {
    // Zero means "not known", which is what a live-encoded stream writes.
    const flac = [...ascii("fLaC"), 0x00, 0x00, 0x00, 0x22, ...new Array(10).fill(0), ...new Array(8).fill(0)];
    const probe = probeAudioBytes(Uint8Array.from(flac), { byteSize: flac.length });

    expect(probe.sampleRate).toBeNull();
    expect(probe.problems).toEqual([]);
  });

  it("reads the block type without its last-block flag", () => {
    // The top bit says "this is the final metadata block". A STREAMINFO
    // that is also the only block therefore reads as type 128, and a valid
    // file was being rejected for it.
    const rate = 44_100;
    const packed = [
      (rate >> 12) & 0xff,
      (rate >> 4) & 0xff,
      ((rate & 0x0f) << 4) | (1 << 1) | 0,
      (15 << 4) | 0,
      0,
      0,
      0,
      0,
    ];

    const flac = [...ascii("fLaC"), 0x80, 0x00, 0x00, 0x22, ...new Array(10).fill(0), ...packed];
    const probe = probeAudioBytes(Uint8Array.from(flac), { byteSize: flac.length });

    expect(probe.sampleRate).toBe(44_100);
    expect(probe.channels).toBe(2);
  });
});
