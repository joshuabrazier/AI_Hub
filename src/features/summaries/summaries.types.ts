import z from "zod";

// -------------------------------------------------------------------
// Summarise pasted text, in a chosen style.
//
// NOTHING IS STORED. Text goes in, a summary comes back, and the app keeps
// neither. That is deliberate rather than unfinished: the input is whatever
// somebody happened to paste - a contract, a medical letter, a board pack -
// and holding a copy of it, plus a copy of the model's reading of it, would
// make this the most sensitive table in the app for no benefit anybody
// asked for. Anyone who wants to keep a summary can copy it.
//
// The cost is that a refresh loses it, which is why the screen says so
// before you spend a minute waiting for one.
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
};
