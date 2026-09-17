import { describe, expect, it } from "vitest";

import {
  deriveSummaryTitle,
  MAX_INPUT_CHARS,
  MIN_INPUT_CHARS,
  SUMMARY_MAX_TOKENS,
  SUMMARY_TITLE_MAX_CHARS,
  SUMMARY_STYLES,
  SUMMARY_STYLE_DESCRIPTIONS,
  SUMMARY_STYLE_LABELS,
  SUMMARY_STYLE_RESULT_HEADINGS,
  SummariseTextSchema,
} from "./summaries.types";

// -------------------------------------------------------------------
// The schema is the boundary: the route validates with it before anything
// reaches the model, so what it accepts decides what gets paid for.
// -------------------------------------------------------------------
describe("SummariseTextSchema", () => {
  const longEnough = "a".repeat(MIN_INPUT_CHARS);

  it("accepts text at the minimum length in every style", () => {
    for (const style of Object.values(SUMMARY_STYLES)) {
      const result = SummariseTextSchema.safeParse({ text: longEnough, style });

      expect(result.success, style).toBe(true);
    }
  });

  it("refuses text too short to summarise", () => {
    // Below this the model pads rather than summarises, and somebody has
    // paid for a paragraph restating their own sentence.
    const result = SummariseTextSchema.safeParse({
      text: "a".repeat(MIN_INPUT_CHARS - 1),
      style: SUMMARY_STYLES.SUMMARY,
    });

    expect(result.success).toBe(false);
  });

  it("refuses text too long, rather than silently truncating it", () => {
    // The important half is "rather than truncating". A summary of an
    // unknown fraction of a document is worse than no summary, because
    // nothing on the page would say what was left out.
    const result = SummariseTextSchema.safeParse({
      text: "a".repeat(MAX_INPUT_CHARS + 1),
      style: SUMMARY_STYLES.SUMMARY,
    });

    expect(result.success).toBe(false);
  });

  it("measures length AFTER trimming, so whitespace cannot pad a short paste", () => {
    const padded = `${"a".repeat(MIN_INPUT_CHARS - 10)}${" ".repeat(100)}`;

    expect(SummariseTextSchema.safeParse({ text: padded, style: SUMMARY_STYLES.SUMMARY }).success).toBe(
      false,
    );
  });

  it("refuses a style it does not offer", () => {
    // The style picks the prompt and the output ceiling, so an unknown one
    // must not fall through to a default.
    expect(SummariseTextSchema.safeParse({ text: longEnough, style: "brief" }).success).toBe(false);
    expect(SummariseTextSchema.safeParse({ text: longEnough, style: "" }).success).toBe(false);
  });

  it("requires a style rather than assuming one", () => {
    expect(SummariseTextSchema.safeParse({ text: longEnough }).success).toBe(false);
  });
});

describe("the styles are completely described", () => {
  it("has a label and a description for every style", () => {
    // The descriptions are load-bearing rather than decorative: a
    // three-word label alone leaves people guessing which one they want,
    // and a missing one would render as an empty line under a radio button.
    for (const style of Object.values(SUMMARY_STYLES)) {
      expect(SUMMARY_STYLE_LABELS[style], style).toBeTruthy();
      expect(SUMMARY_STYLE_DESCRIPTIONS[style], style).toBeTruthy();
    }
  });

  it("names the result without repeating itself", () => {
    // "Summary summary" - what the heading read before it had its own map,
    // because it was built as `${label} summary` and one of the three
    // labels is the noun rather than an adjective. No suffix reads
    // correctly for all three, so each heading is written out.
    expect(SUMMARY_STYLE_RESULT_HEADINGS[SUMMARY_STYLES.SUMMARY]).toBe("Summary");
    expect(SUMMARY_STYLE_RESULT_HEADINGS[SUMMARY_STYLES.DETAILED]).toBe("Detailed summary");
    expect(SUMMARY_STYLE_RESULT_HEADINGS[SUMMARY_STYLES.EXECUTIVE]).toBe("Executive summary");

    // The general form of the same mistake, so a fourth style added later
    // cannot reintroduce it under a different word.
    for (const style of Object.values(SUMMARY_STYLES)) {
      const words = SUMMARY_STYLE_RESULT_HEADINGS[style].toLowerCase().split(" ");

      expect(new Set(words).size, SUMMARY_STYLE_RESULT_HEADINGS[style]).toBe(words.length);
    }
  });

  it("gives every style its own output ceiling", () => {
    for (const style of Object.values(SUMMARY_STYLES)) {
      expect(SUMMARY_MAX_TOKENS[style], style).toBeGreaterThan(0);
    }
  });

  it("orders the ceilings detailed > summary > executive", () => {
    // Not cosmetic. An executive summary allowed to run as long as a
    // detailed one has missed the point of being asked for, and the whole
    // reason there are three styles is that they produce different lengths.
    expect(SUMMARY_MAX_TOKENS[SUMMARY_STYLES.DETAILED]).toBeGreaterThan(
      SUMMARY_MAX_TOKENS[SUMMARY_STYLES.SUMMARY],
    );
    expect(SUMMARY_MAX_TOKENS[SUMMARY_STYLES.SUMMARY]).toBeGreaterThan(
      SUMMARY_MAX_TOKENS[SUMMARY_STYLES.EXECUTIVE],
    );
  });
});

describe("deriveSummaryTitle", () => {
  // -----------------------------------------------------------------
  // The title is STORED, not computed on read - so a row that gets it
  // wrong keeps it for as long as the row lives, and nobody goes back to
  // rename a document they can no longer identify.
  //
  // Nobody is asked to name anything, deliberately: a naming field between
  // pasting and reading is one more step in a tool whose whole appeal is
  // paste-and-go. Which puts the entire burden on this function.
  // -----------------------------------------------------------------
  it("takes the first line that has words in it", () => {
    expect(deriveSummaryTitle("Services Agreement\nBetween the parties...")).toBe("Services Agreement");
  });

  it("skips the blank lines a paste usually starts with", () => {
    expect(deriveSummaryTitle("\n\n   \nQuarterly board paper\nrest")).toBe("Quarterly board paper");
  });

  it("steps over markdown decoration rather than naming a row of hashes", () => {
    // Pasting from a document or a wiki routinely leads with these, and
    // "###" is not a name anybody can pick out of a list.
    expect(deriveSummaryTitle("# Heads of Agreement\ntext")).toBe("Heads of Agreement");
    expect(deriveSummaryTitle("---\n> Minutes of meeting\ntext")).toBe("Minutes of meeting");
  });

  it("bounds a long first line and marks that it was cut", () => {
    const title = deriveSummaryTitle("A".repeat(400));

    expect(title.length).toBeLessThanOrEqual(SUMMARY_TITLE_MAX_CHARS + 3);
    expect(title.endsWith("...")).toBe(true);
  });

  it("cuts a long line at a word rather than mid-word", () => {
    const words =
      "Commercial terms for the supply of managed analytics services to a client whose name is rather long";
    const title = deriveSummaryTitle(words);
    const kept = title.slice(0, -3);

    expect(title.endsWith("...")).toBe(true);
    // What was kept is a real prefix of the original, and does not end on
    // a dangling space.
    expect(words.startsWith(kept)).toBe(true);
    expect(kept.endsWith(" ")).toBe(false);
  });

  it("never returns an empty name", () => {
    // A paste of nothing but punctuation or whitespace would otherwise
    // produce a row with no visible identity at all.
    expect(deriveSummaryTitle("")).toBe("Untitled");
    expect(deriveSummaryTitle("\n\n\n")).toBe("Untitled");
    expect(deriveSummaryTitle("###\n---\n***")).toBe("Untitled");
  });

  it("keeps a title that is exactly at the bound whole", () => {
    const exact = "B".repeat(SUMMARY_TITLE_MAX_CHARS);

    expect(deriveSummaryTitle(exact)).toBe(exact);
  });
});
