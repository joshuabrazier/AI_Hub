import { describe, expect, it } from "vitest";

import {
  MAX_INPUT_CHARS,
  MIN_INPUT_CHARS,
  SUMMARY_MAX_TOKENS,
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
