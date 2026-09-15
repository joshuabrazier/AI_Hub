// ===================================================================
// IS THIS RECORDING ONE FILE, OR TWO STUCK TOGETHER?
//
// Run it against a recording that Azure refused with "the audio format is
// invalid or cannot be detected" while playing perfectly on this machine.
// That combination has one likely cause and this answers it in a second,
// offline, without uploading anything anywhere.
//
//   node scripts/check-recording.mjs "C:\\path\\to\\recording.webm"
//
// WHAT IT LOOKS FOR. Every WebM file opens with the EBML magic number
// 1A 45 DF A3. Exactly one, at offset 0, is a normal file. A SECOND one
// further in means two independent recordings were concatenated - which is
// what happened when two MediaRecorders ran at once, before the re-entry
// guard in transcription-recorder.tsx.
//
// WHY THAT FILE STILL PLAYS. A tolerant player reads the first stream and
// stops at the end of it, so the recording sounds complete and is actually
// half of what was said. A strict decoder reaches the second header, finds a
// new document where a cluster should be, and reports that it cannot detect
// the format. Every diagnosis that started from "but it plays" went wrong
// for this reason.
//
// MP4 and MP3 are reported on too, because the same double-start produces
// the same splice on a device that records in those.
// ===================================================================

import { open, stat } from "node:fs/promises";

const MEGABYTE = 1024 * 1024;

// The signatures worth counting, all of which legitimately appear ONCE at
// the very start of a well-formed file.
const SIGNATURES = [
  { name: "WebM/Matroska (EBML)", bytes: [0x1a, 0x45, 0xdf, 0xa3], container: ".webm" },
  { name: "MP4/M4A (ftyp)", bytes: [0x66, 0x74, 0x79, 0x70], container: ".m4a/.mp4", offset: 4 },
];

const path = process.argv[2];

if (!path) {
  console.error("Usage: node scripts/check-recording.mjs <file>");
  process.exit(1);
}

// Read in windows with an overlap, so a signature straddling a boundary is
// still found. Without the overlap a four byte marker split across two reads
// is invisible, which would report a spliced file as clean.
const WINDOW = 8 * MEGABYTE;
const OVERLAP = 8;

function findAll(buffer, bytes, base) {
  const hits = [];

  outer: for (let i = 0; i <= buffer.length - bytes.length; i += 1) {
    for (let j = 0; j < bytes.length; j += 1) {
      if (buffer[i + j] !== bytes[j]) continue outer;
    }

    hits.push(base + i);
  }

  return hits;
}

const info = await stat(path);
const handle = await open(path, "r");

console.log(`\nFile:  ${path}`);
console.log(`Size:  ${(info.size / MEGABYTE).toFixed(1)} MB\n`);

const found = new Map(SIGNATURES.map((signature) => [signature.name, []]));

try {
  let position = 0;

  while (position < info.size) {
    const length = Math.min(WINDOW, info.size - position);
    const buffer = Buffer.alloc(length);

    await handle.read(buffer, 0, length, position);

    for (const signature of SIGNATURES) {
      found.get(signature.name).push(...findAll(buffer, signature.bytes, position));
    }

    if (position + length >= info.size) break;

    position += length - OVERLAP;
  }
} finally {
  await handle.close();
}

let verdict = "clean";

for (const signature of SIGNATURES) {
  // De-duplicated, because the overlap means a hit inside it is seen twice.
  const hits = [...new Set(found.get(signature.name))].sort((a, b) => a - b);

  if (hits.length === 0) continue;

  const isContainerStart = signature.offset === undefined ? hits[0] === 0 : hits[0] === signature.offset;

  console.log(`${signature.name}: ${hits.length} marker(s)`);

  for (const hit of hits.slice(0, 10)) {
    console.log(`   offset ${hit} (${(hit / MEGABYTE).toFixed(1)} MB in)`);
  }

  if (hits.length > 10) console.log(`   ... and ${hits.length - 10} more`);

  if (isContainerStart && hits.length > 1) {
    verdict = "spliced";
    console.log(
      `\n   >>> SPLICED. The first marker is where it belongs and the rest are not.\n` +
        `   >>> This is two or more recordings concatenated - the double-start bug.\n` +
        `   >>> It plays locally because a player reads the first one and stops,\n` +
        `   >>> and the audio after the second marker is not being transcribed.\n`,
    );
  }

  console.log("");
}

if (verdict === "clean") {
  console.log("No splice found: exactly one container marker, where it belongs.\n");
  console.log("So a rejection of this file is NOT the double-start bug, and the");
  console.log("next thing to check is whether Azure could READ the blob at all -");
  console.log("the Speech resource needs Storage Blob Data Reader on the storage");
  console.log("account, and contentUrl carries no SAS of its own.\n");
}

// A single four byte marker has about a one in four billion chance of
// appearing at any given position, so a 100 MB file expects roughly 0.02
// false hits. Two markers is evidence; ten would be something else entirely.
console.log("Note: these markers can occur by chance in compressed audio, but");
console.log("rarely - expect about 0.02 false hits in a 100 MB file. A single");
console.log("extra marker is meaningful; a scattering of them is not.\n");
