import type { TranscriptionSegment } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Teams meeting transcripts, as WebVTT.
//
// Graph hands the transcript back as a VTT file rather than JSON, so this
// is the parser. It is pure and exported so it can be tested without a
// tenant, a meeting or a token - which matters, because every other part of
// this feature needs all three to exercise at all.
//
// WHAT A TEAMS VTT LOOKS LIKE:
//
//   WEBVTT
//
//   b1e6f0c4-.../1
//   00:00:03.150 --> 00:00:06.420
//   <v Joshua Brazier>Morning everyone, shall we start.</v>
//
// The parts that matter and are easy to get wrong:
//
//   - A cue MAY carry an identifier line before its timing, and Teams emits
//     one. A parser that assumes the timing is the first line of a block
//     silently drops every cue.
//   - The speaker rides in a `<v Name>` voice span, which is where the
//     names come from. This is the whole reason Teams transcripts are worth
//     having over our own.
//   - Timestamps are HH:MM:SS.mmm, but the hours field is sometimes absent
//     on short meetings, so MM:SS.mmm has to parse too.
// -------------------------------------------------------------------

// A cue's timing line. Hours are optional - Teams omits them under an hour.
const TIMING = /^(\d{1,3}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,3}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

// <v Speaker Name>text</v>. The closing tag is optional in the spec, and
// Teams does include it, but a parser that requires it would drop the last
// cue of a truncated file.
const VOICE = /^<v\s+([^>]*)>([\s\S]*?)(?:<\/v>)?$/;

function toMs(hours: string | undefined, minutes: string, seconds: string, fraction: string): number {
  const h = hours ? Number(hours.slice(0, -1)) : 0;
  // "5" means 500ms, not 5ms - a fraction, not a count. Padding rather than
  // parsing directly is what keeps a two-digit fraction from being read as
  // milliseconds and putting every cue in the wrong place.
  const ms = Number(fraction.padEnd(3, "0"));

  return h * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1_000 + ms;
}

// Strips the tags VTT allows inside cue text - <i>, <b>, <c.classname> and
// the rest. Teams does not usually emit them, but a stray tag rendering as
// literal angle brackets in a transcript would look like corruption.
function stripCueTags(text: string): string {
  return text.replace(/<\/?[^>]+>/g, "").trim();
}

// -------------------------------------------------------------------
// Turn a Teams VTT file into speaker turns.
//
// Consecutive cues from the same person are MERGED, because Teams emits a
// cue every few seconds and an unmerged transcript is one line per breath
// with the same name repeated down the page. Same reasoning as the Azure
// path, and deliberately the same output shape - everything downstream
// (the screen, the download, the summariser) already knows how to read it.
//
// `speaker` stays null throughout. It is Azure's number for a voice it has
// separated but cannot name, and inventing one here would imply a guess
// where there is actually an identity.
// -------------------------------------------------------------------
export function parseTeamsVtt(vtt: string): TranscriptionSegment[] {
  const segments: TranscriptionSegment[] = [];

  // Normalise line endings first. Graph returns CRLF, and splitting a
  // CRLF file on "\n" leaves a trailing carriage return on every line -
  // which is invisible in a log and breaks every regex below.
  const blocks = vtt.replace(/\r\n/g, "\n").split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim().length > 0);

    if (lines.length === 0) continue;

    // WEBVTT header, NOTE comments and STYLE blocks are not cues.
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0])) continue;

    const timingIndex = lines.findIndex((line) => TIMING.test(line));

    // No timing line means this is not a cue - a stray identifier, or a
    // block shape we do not recognise. Skipped rather than guessed at.
    if (timingIndex === -1) continue;

    const timing = TIMING.exec(lines[timingIndex]);
    if (!timing) continue;

    const startMs = toMs(timing[1], timing[2], timing[3], timing[4]);
    const endMs = toMs(timing[5], timing[6], timing[7], timing[8]);

    const body = lines.slice(timingIndex + 1).join(" ").trim();

    if (body.length === 0) continue;

    const voice = VOICE.exec(body);

    // A name of "" is treated as no name. An empty <v> span carries no more
    // information than an absent one, and a blank label on screen reads as
    // a bug.
    const speakerName = voice?.[1]?.trim() || null;
    const text = stripCueTags(voice ? voice[2] : body);

    if (text.length === 0) continue;

    const previous = segments[segments.length - 1];

    // Same person still talking - extend rather than start a new turn.
    // Compared on the name, including the null case, so a run of unattributed
    // cues merges too rather than becoming one turn per cue.
    if (previous && (previous.speakerName ?? null) === speakerName) {
      previous.text = `${previous.text} ${text}`;
      previous.endMs = endMs;
      continue;
    }

    segments.push({ speaker: null, speakerName, startMs, endMs, text });
  }

  return segments;
}

// -------------------------------------------------------------------
// Render turns as the plain text stored on the row and given to the
// summariser.
//
// Named where Teams named them. The summariser is explicitly told to use
// whatever labels the transcript carries, so real names flow through into
// "Actions" without any further work - which is the practical payoff of
// this whole feature.
// -------------------------------------------------------------------
export function teamsSegmentsToText(segments: TranscriptionSegment[]): string {
  return segments
    .map((segment) => (segment.speakerName ? `${segment.speakerName}: ${segment.text}` : segment.text))
    .join("\n\n");
}

// -------------------------------------------------------------------
// Everyone who spoke, in the order they first did.
//
// Shown on the screen so somebody can see at a glance whether the import
// captured the room, and used to say "4 speakers" in the list.
// -------------------------------------------------------------------
export function speakersIn(segments: TranscriptionSegment[]): string[] {
  const seen: string[] = [];

  for (const segment of segments) {
    if (segment.speakerName && !seen.includes(segment.speakerName)) {
      seen.push(segment.speakerName);
    }
  }

  return seen;
}

// -------------------------------------------------------------------
// How an imported row records where it came from.
//
// BOTH IDS, joined, and each is there for a different question:
//
//   the EVENT id       what the meetings list has in hand, so it can mark a
//                      row "already imported" without resolving anything
//   the TRANSCRIPT id  what actually makes the import idempotent, because
//                      Teams can produce a second transcript for one meeting
//                      and the event id would not tell them apart
//
// Neither alone answers both, so the column holds both and this pair is the
// only thing that knows the shape. Here rather than in the service because
// they are pure, they are load-bearing - the "already imported" marker is a
// round trip through them - and this module is the one part of the feature
// that can be tested without a tenant, a meeting and a live token.
//
// The separator is a character neither id contains: Graph ids are base64url
// and GUID-shaped, and neither alphabet includes it.
// -------------------------------------------------------------------
const SOURCE_REF_SEPARATOR = "|";

export function teamsSourceRef(eventId: string, transcriptId: string): string {
  return `${eventId}${SOURCE_REF_SEPARATOR}${transcriptId}`;
}

// The event half of a source ref. A value with no separator is returned
// WHOLE rather than as an empty string: it can only be a shape written
// before this format existed, and reading it as "no event" would quietly
// stop matching rows that are perfectly fine.
export function eventIdFromSourceRef(sourceRef: string): string {
  const separator = sourceRef.indexOf(SOURCE_REF_SEPARATOR);

  return separator === -1 ? sourceRef : sourceRef.slice(0, separator);
}
