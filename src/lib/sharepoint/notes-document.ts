// -------------------------------------------------------------------
// The file that gets uploaded: a meeting's notes as one markdown document.
//
// SUMMARY FIRST, TRANSCRIPT UNDERNEATH. Somebody opening this in six months
// wants to know what was decided, not to read forty minutes of speech to
// find out. The transcript is kept in the same file rather than a second one
// because two files in a client folder are two things to keep together, and
// nothing keeps them together.
//
// IT SAYS WHERE IT CAME FROM, AND THAT IT IS AUTOMATIC. A document that
// appears in a client folder with no provenance is worse than no document:
// the reader cannot tell whether a person wrote it, whether the words in
// quotation marks were really said, or where to go to check. So the header
// names the app, the meeting, the date and the fact that speech recognition
// makes mistakes.
//
// NOTHING HERE IS FENCED IN A CODE BLOCK, deliberately. Wrapping a transcript
// in ``` looks tidier right up until a meeting about markdown contains a
// fence of its own, at which point the document breaks in the middle and the
// rest of it renders as prose. Untrusted text goes in as plain lines. It is
// markdown in a file, not markup in a page - nothing executes it - so the
// worst a stray "#" can do is make a heading, which is cosmetic.
//
// Pure. Dates arrive already formatted, because the app timezone rule lives
// in one place and it is not this one, and speaker labels arrive already
// built, because the "a number is not a name" rule lives in the feature.
// -------------------------------------------------------------------

// Roughly nine hours of continuous speech, at the ~55,000 characters an hour
// of talking actually produces. Past that it is not a meeting, it is a
// recording somebody left running, and SharePoint should not be handed a
// megabyte of it on the off chance.
const MAX_TRANSCRIPT_CHARACTERS = 500_000;

export interface NotesDocumentInput {
  title: string;
  // Already formatted in the app timezone by the caller. A raw ISO string
  // would read as the wrong day to anybody who opens the file.
  recordedLabel: string;
  sourceDescription: string;
  // Named participants, where Teams attributed them. Empty is normal and
  // stays out of the document rather than appearing as "People: none".
  participants: readonly string[];
  // NULL is a real case: a completed transcription whose summary call failed
  // still has a transcript worth filing, and "completed" has never meant
  // "summarised".
  summary: string | null;
  // One line per speaker turn, already labelled and timestamped.
  transcriptLines: readonly string[];
}

export interface NotesDocument {
  text: string;
  // True when the transcript did not fit. Surfaced rather than swallowed, and
  // also stated inside the document - somebody reading a transcript that
  // stops mid-meeting needs to know it was cut rather than that the recording
  // failed.
  truncated: boolean;
}

export function buildNotesDocument(input: NotesDocumentInput): NotesDocument {
  const joined = input.transcriptLines.join("\n\n");
  const truncated = joined.length > MAX_TRANSCRIPT_CHARACTERS;
  const transcript = truncated ? `${joined.slice(0, MAX_TRANSCRIPT_CHARACTERS)}` : joined;

  const lines: string[] = [
    // The title is the person's own text. It is put on one line and any line
    // breaks in it are flattened, so a pasted multi-line calendar subject
    // cannot turn the rest of the header into body text.
    `# ${flatten(input.title) || "Meeting notes"}`,
    "",
    `- ${input.recordedLabel}`,
    `- ${input.sourceDescription}`,
  ];

  if (input.participants.length > 0) {
    lines.push(`- People: ${input.participants.map(flatten).filter(Boolean).join(", ")}`);
  }

  lines.push(
    "- Transcribed and summarised automatically. Speech recognition makes mistakes, and the summary is a model's reading of the transcript rather than a record of what was agreed.",
    "",
    "## Summary",
    "",
    // Said plainly rather than left blank. An empty heading reads as a bug;
    // this reads as what happened.
    input.summary?.trim() || "_No summary was produced for this meeting._",
    "",
    "## Transcript",
    "",
  );

  if (transcript.length > 0) {
    lines.push(transcript);
  } else {
    lines.push("_No transcript was available._");
  }

  if (truncated) {
    lines.push(
      "",
      `_The transcript was longer than ${MAX_TRANSCRIPT_CHARACTERS.toLocaleString("en-AU")} characters and has been cut off here. The full version is in the portal._`,
    );
  }

  return { text: `${lines.join("\n")}\n`, truncated };
}

// A header field is one line. Anything a person typed into a calendar
// subject can contain a newline, and a newline in a list item ends the list.
function flatten(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
