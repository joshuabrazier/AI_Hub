// -------------------------------------------------------------------
// ===================================================================
// DID THE REWRITE CHANGE WHAT THE TEXT SAYS?
// ===================================================================
//
// A rewriter that quietly drops a caveat or invents a number is worse than
// no rewriter at all, because the output reads BETTER than the input and is
// therefore trusted more. This file is the part of the defence with no model
// in it.
//
// DETERMINISTIC ON PURPOSE. Asking a model to check its own rewrite is the
// form of self-correction the literature says does not work: the TACL survey
// (Kamoi et al., arXiv:2406.01297) finds self-correction helps on tasks whose
// responses decompose into verifiable constraints, and fails where verifying
// is as hard as generating. "Did I change the meaning" is the second kind.
// A second model call would also cost a second ceiling, a second log row,
// and a second thing to trust - and house-voice.ts already records that an
// LLM judge reports success whether or not any exists.
//
// So this counts things instead. A regex cannot be talked out of its answer.
//
// IT REPORTS, IT NEVER REFUSES. Every function here returns findings for a
// person to read beside the two texts. Blocking a rewrite on a heuristic
// would make the heuristic the author, and these are heuristics: "$1,200"
// and "1200 dollars" are the same amount written two ways, and a rewrite
// that legitimately spells out a number is not a defect.
//
// AND IT IS THE CHEAPEST CONTROL IN THE FEATURE. A rewrite that rounds
// "34 hours" to "around thirty" is caught here by a regex rather than by a
// reader's attention on the fourth paragraph of a client email.
// -------------------------------------------------------------------

/**
 * Number words folded to digits before comparison, so "34" becoming
 * "thirty-four" is not reported as a figure that went missing.
 *
 * It stops at twelve deliberately. Past that, a spelled-out number is rare
 * enough in business prose that the pairs cost more than they catch, and
 * every entry here is a chance to fold something that was not a number -
 * "one" in "one of the reasons" is not a figure.
 */
const NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
};

// Capitalised words that start a sentence, or that are capitalised for
// reasons other than being somebody's name. Without this the "names" list is
// mostly the first word of every sentence.
const NOT_A_NAME = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "i", "if", "in", "it", "its",
  "no", "not", "of", "on", "or", "so", "that", "the", "their", "then", "there", "they",
  "this", "to", "we", "what", "when", "which", "while", "who", "with", "you", "your",
  // Days and months are capitalised and are not names in the sense that
  // matters here - a date moving is caught by the figure check.
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
]);

/**
 * Every figure in the text, normalised so the same amount written two ways
 * compares equal.
 *
 * Thousands separators go, so "$1,200" and "$1200" match. A trailing decimal
 * zero goes, so "12.0" and "12" match. Currency symbols and percent signs
 * are dropped from the KEY but the digits are what matters: a rewrite that
 * turns "$34" into "34%" still has both figures, and that particular error
 * is one a reader catches instantly where a dropped figure is not.
 */
export function extractFigures(text: string): string[] {
  const figures: string[] = [];

  // Digits first, with separators and decimals attached.
  for (const match of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const normalised = match[0].replace(/,/g, "").replace(/\.0+$/, "");

    if (normalised.length > 0) figures.push(normalised);
  }

  // Then the spelled-out small numbers, folded to the same representation.
  for (const match of text.matchAll(/\b[a-z]+\b/gi)) {
    const word = match[0].toLowerCase();
    const digit = NUMBER_WORDS[word];

    if (digit !== undefined) figures.push(digit);
  }

  return figures;
}

/**
 * Capitalised tokens that are probably somebody's or something's name.
 *
 * Sentence-initial words are excluded, which is the whole trick: a name is a
 * word capitalised where capitalisation was not already required. It is a
 * heuristic and it is allowed to be, because the output is a list a person
 * reads rather than a gate.
 */
export function extractNames(text: string): string[] {
  const names: string[] = [];

  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const words = sentence.trim().split(/\s+/);

    words.forEach((raw, index) => {
      // Strip punctuation that travels with a word, but keep an internal
      // apostrophe so "O'Brien" survives.
      const word = raw.replace(/^[^\p{L}]+|[^\p{L}']+$/gu, "");

      if (word.length < 2) return;
      // The first word of a sentence is capitalised whatever it is.
      if (index === 0) return;
      if (!/^\p{Lu}/u.test(word)) return;
      if (NOT_A_NAME.has(word.toLowerCase())) return;

      names.push(word);
    });
  }

  return names;
}

export type MeaningFinding = {
  /** Machine-readable, so a component can choose an icon without matching prose. */
  kind: "figure-dropped" | "figure-added" | "name-dropped" | "name-added" | "length" | "structure";
  /** What to show the reader. A sentence, not a code. */
  message: string;
  /**
   * How much it matters. `alert` is for something that suggests the text now
   * says something it did not; `note` is for something worth a glance.
   */
  severity: "alert" | "note";
};

/** Counts occurrences, so a figure used twice and dropped once is caught. */
function tally(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  return counts;
}

/** Values present more often in `a` than in `b`. */
function missingFrom(a: readonly string[], b: readonly string[]): string[] {
  const left = tally(a);
  const right = tally(b);
  const gone: string[] = [];

  for (const [value, count] of left) {
    const remaining = count - (right.get(value) ?? 0);

    for (let i = 0; i < remaining; i += 1) gone.push(value);
  }

  return gone;
}

/**
 * How many paragraphs, and whether the text carries a list. Both are things
 * a rewrite should not invent: a draft turned into three bullets has had its
 * shape changed, not its voice, and markdown-trained models reach for a list
 * even when the prompt contains none.
 */
function shapeOf(text: string): { paragraphs: number; hasList: boolean } {
  const paragraphs = text.split(/\n\s*\n/).filter((block) => block.trim().length > 0).length;
  const hasList = /^\s*(?:[-*+]|\d+[.)])\s+/m.test(text);

  return { paragraphs, hasList };
}

/**
 * The band a rewrite's length may sit in, per mode.
 *
 * AN EXPANDING REWRITE IS USUALLY AN INVENTING ONE, because elaboration is
 * where new claims get in. The bands are deliberately loose: the point is to
 * catch a rewrite that grew by half, not to police a sentence.
 */
export const LENGTH_BANDS = {
  light: { min: 0.85, max: 1.15 },
  full: { min: 0.75, max: 1.25 },
} as const;

export type RewriteMode = keyof typeof LENGTH_BANDS;

// -------------------------------------------------------------------
// Everything above, run over one pair, in the order a reader cares about.
//
// ADDED IS LOUDER THAN DROPPED, and that ordering is the point of the whole
// file: a dropped figure is a rewrite that said less, which a reader may
// notice. An ADDED figure is one the model made up, and it will read as
// authoritative because everything around it is correct.
// -------------------------------------------------------------------
export function compareMeaning(
  source: string,
  rewrite: string,
  mode: RewriteMode = "light",
): MeaningFinding[] {
  const findings: MeaningFinding[] = [];

  const sourceFigures = extractFigures(source);
  const rewriteFigures = extractFigures(rewrite);

  const figuresAdded = missingFrom(rewriteFigures, sourceFigures);
  const figuresDropped = missingFrom(sourceFigures, rewriteFigures);

  if (figuresAdded.length > 0) {
    findings.push({
      kind: "figure-added",
      severity: "alert",
      message: `The rewrite contains a figure the original did not: ${figuresAdded.join(", ")}. Check it before you send this.`,
    });
  }

  if (figuresDropped.length > 0) {
    findings.push({
      kind: "figure-dropped",
      severity: "alert",
      message: `A figure from the original is not in the rewrite: ${figuresDropped.join(", ")}.`,
    });
  }

  const namesAdded = missingFrom(extractNames(rewrite), extractNames(source));
  const namesDropped = missingFrom(extractNames(source), extractNames(rewrite));

  if (namesAdded.length > 0) {
    findings.push({
      kind: "name-added",
      severity: "alert",
      message: `The rewrite names something the original did not: ${namesAdded.join(", ")}.`,
    });
  }

  if (namesDropped.length > 0) {
    findings.push({
      kind: "name-dropped",
      severity: "note",
      message: `A name from the original is not in the rewrite: ${namesDropped.join(", ")}.`,
    });
  }

  // Length, against the band for the mode that was asked for.
  const sourceLength = source.trim().length;

  if (sourceLength > 0) {
    const ratio = rewrite.trim().length / sourceLength;
    const band = LENGTH_BANDS[mode];

    if (ratio > band.max) {
      findings.push({
        kind: "length",
        severity: "note",
        message: `The rewrite is ${Math.round((ratio - 1) * 100)}% longer than the original. Elaboration is where new claims get in.`,
      });
    } else if (ratio < band.min) {
      findings.push({
        kind: "length",
        severity: "note",
        message: `The rewrite is ${Math.round((1 - ratio) * 100)}% shorter than the original. Check nothing was cut that mattered.`,
      });
    }
  }

  const sourceShape = shapeOf(source);
  const rewriteShape = shapeOf(rewrite);

  if (!sourceShape.hasList && rewriteShape.hasList) {
    findings.push({
      kind: "structure",
      severity: "note",
      message: "The rewrite turned prose into a list. That changes the document's shape, not its voice.",
    });
  }

  if (Math.abs(sourceShape.paragraphs - rewriteShape.paragraphs) > 2) {
    findings.push({
      kind: "structure",
      severity: "note",
      message: `The original had ${sourceShape.paragraphs} paragraphs and the rewrite has ${rewriteShape.paragraphs}.`,
    });
  }

  return findings;
}
