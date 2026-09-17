import z from "zod";

import { TABLE_ID_LENGTH } from "@/lib/constants";

// -------------------------------------------------------------------
// Summarise pasted text, in a chosen style.
//
// WHAT WAS PASTED IS KEPT, AND SO IS THE ANSWER - which reverses how this
// feature began. It stored nothing on purpose: the input is whatever
// somebody happened to paste, a contract or a medical letter or a board
// pack, and holding a copy of it alongside the model's reading of it makes
// this the most sensitive table in the application.
//
// That cost has been accepted rather than forgotten, because being able to
// go back to a summary was asked for. What makes it defensible is in the
// migration and in the repository, and none of it is optional: the row
// belongs to ONE person and every query says so, the foreign key cascades
// so a removed person takes their material with them, and the retention
// job ages the table out.
//
// The screen says all of this, because a promise about somebody's data and
// the schema behind it must not be able to drift apart. It previously said
// the opposite.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// The three styles.
//
// These are genuinely different jobs, not one prompt with three lengths
// bolted on - which is why each carries its own instruction rather than a
// word count. "Make it shorter" produces a truncated summary; asking for a
// different KIND of answer produces a different answer.
// -------------------------------------------------------------------
export const SUMMARY_STYLES = {
  DETAILED: "detailed",
  SUMMARY: "summary",
  EXECUTIVE: "executive",
} as const;

export type SummaryStyle = (typeof SUMMARY_STYLES)[keyof typeof SUMMARY_STYLES];

export const SUMMARY_STYLE_LABELS: Record<SummaryStyle, string> = {
  [SUMMARY_STYLES.DETAILED]: "Detailed",
  [SUMMARY_STYLES.SUMMARY]: "Summary",
  [SUMMARY_STYLES.EXECUTIVE]: "Executive",
};

// What to call the result once it exists.
//
// A separate map rather than `${label} summary`, which is where "Summary
// summary" came from. Two of the three labels are adjectives and one is the
// noun itself, so there is no suffix that reads correctly for all of them -
// composing a heading from a label only works when every label is the same
// part of speech, and these are not.
export const SUMMARY_STYLE_RESULT_HEADINGS: Record<SummaryStyle, string> = {
  [SUMMARY_STYLES.DETAILED]: "Detailed summary",
  [SUMMARY_STYLES.SUMMARY]: "Summary",
  [SUMMARY_STYLES.EXECUTIVE]: "Executive summary",
};

// Shown under each option so somebody picks on purpose rather than guessing
// from a one-word label.
export const SUMMARY_STYLE_DESCRIPTIONS: Record<SummaryStyle, string> = {
  [SUMMARY_STYLES.DETAILED]:
    "Section by section, keeping names, numbers and specifics. Long - for when you need to work from it rather than just know about it.",
  [SUMMARY_STYLES.SUMMARY]:
    "A few paragraphs covering what it says and what it means. The default if you are not sure.",
  [SUMMARY_STYLES.EXECUTIVE]:
    "The bottom line first, then what it changes and what it needs. Short enough to read standing up.",
};

// -------------------------------------------------------------------
// Bounds
//
// MAX_INPUT_CHARS is a cost ceiling rather than a model limit - Opus takes
// far more than this. Roughly 100,000 tokens, which is a long report. A
// paste over it is refused with a clear message rather than silently
// truncated, because a summary of an unknown fraction of a document is
// worse than no summary: nothing on the page would tell you what was left
// out.
// -------------------------------------------------------------------
export const MAX_INPUT_CHARS = 400_000;

// Below this there is nothing to summarise and the model would pad.
export const MIN_INPUT_CHARS = 200;

// -------------------------------------------------------------------
// Output ceilings, per style.
//
// A cap rather than a target: the model stops when the answer is done. They
// differ because the styles differ - an executive summary that ran to four
// thousand tokens would have missed the point of being asked for.
// -------------------------------------------------------------------
export const SUMMARY_MAX_TOKENS: Record<SummaryStyle, number> = {
  [SUMMARY_STYLES.DETAILED]: 8_000,
  [SUMMARY_STYLES.SUMMARY]: 3_000,
  [SUMMARY_STYLES.EXECUTIVE]: 1_200,
};

export const SummariseTextSchema = z.object({
  text: z
    .string()
    .trim()
    .min(MIN_INPUT_CHARS, `Paste at least ${MIN_INPUT_CHARS} characters to summarise.`)
    .max(MAX_INPUT_CHARS, "That is too long to summarise in one pass. Split it and do it in parts."),
  style: z.enum([SUMMARY_STYLES.DETAILED, SUMMARY_STYLES.SUMMARY, SUMMARY_STYLES.EXECUTIVE]),
});

export type SummariseTextRequestDTO = z.infer<typeof SummariseTextSchema>;

// Whether the feature can run at all. Bedrock is optional across this app,
// so the screen says which piece is missing rather than failing on send.
export type SummariesPageDTO = {
  isConfigured: boolean;
  /** This person's own saved summaries, newest first. Never anybody else's. */
  saved: SavedSummaryDTO[];
};

// -------------------------------------------------------------------
// ===================================================================
// WHAT IS KEPT, NOW THAT ANYTHING IS
// ===================================================================
//
// This feature stored nothing for most of its life, and the reasoning was
// sound: the input is whatever somebody pasted, so keeping it makes this
// the most sensitive table in the app. It is kept now because being able to
// return to a summary was asked for, and the cost is paid deliberately -
// per person, cascading on delete, and aged out by the retention job.
//
// The consequence that matters to anybody reading this file: the page used
// to say a refresh lost the summary. It must never say that again.
// -------------------------------------------------------------------

/** How many saved summaries the page offers. A list, not an archive. */
export const SAVED_SUMMARY_LIMIT = 50;

/** Long enough to tell two board papers apart, short enough to sit in a list. */
export const SUMMARY_TITLE_MAX_CHARS = 90;

// -------------------------------------------------------------------
// A name for a summary, derived from the material itself.
//
// NOBODY IS ASKED TO NAME ANYTHING. A field between pasting and reading
// would be one more step in a tool whose whole appeal is paste-and-go, and
// a list of untitled rows is not a list. So the first line that carries
// words becomes the title.
//
// Pure and exported so it can be tested: this is stored, not computed on
// read, and a row that got its title wrong keeps it.
// -------------------------------------------------------------------
export function deriveSummaryTitle(text: string): string {
  const line = text
    .split(/\r?\n/)
    // A leading blank line, a markdown rule, or a row of hashes is not a
    // title - skip to something with letters or digits in it.
    .map((candidate) => candidate.replace(/^[\s#>*_\-=|]+/, "").trim())
    .find((candidate) => /[\p{L}\p{N}]/u.test(candidate));

  if (!line) return "Untitled";

  if (line.length <= SUMMARY_TITLE_MAX_CHARS) return line;

  // Cut at a word boundary where there is one near the end, so a title does
  // not stop mid-word for the sake of four characters.
  const cut = line.slice(0, SUMMARY_TITLE_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");

  return `${(lastSpace > SUMMARY_TITLE_MAX_CHARS - 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
}

// -------------------------------------------------------------------
// One saved summary as a LIST row.
//
// Deliberately without `sourceText` and `summary`. The heavy columns are
// what make this table expensive to read, and a list of titles has no use
// for either - see the repository, whose list query does not select them.
// -------------------------------------------------------------------
export type SavedSummaryDTO = {
  id: string;
  title: string;
  style: SummaryStyle;
  inputChars: number;
  /** Null on a finished row. Present when it failed or was stopped part way. */
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

/** One saved summary, opened: the material and the answer. */
export type SavedSummaryDetailDTO = SavedSummaryDTO & {
  sourceText: string;
  summary: string | null;
};

export const SummaryIdSchema = z.object({
  summaryId: z.string().min(TABLE_ID_LENGTH),
});

export type SummaryIdRequestDTO = z.infer<typeof SummaryIdSchema>;
