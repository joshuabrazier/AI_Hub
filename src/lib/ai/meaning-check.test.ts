import { describe, expect, it } from "vitest";

import { compareMeaning, extractFigures, extractNames, LENGTH_BANDS } from "./meaning-check";

// -------------------------------------------------------------------
// The deterministic half of the rewriter's meaning defence.
//
// Every test here is about a FALSE ANSWER rather than a crash. A check that
// reports nothing looks exactly like a check that found nothing, and this is
// the code standing between a client email and an invented figure - so the
// cases below are the ones where being wrong is silent.
// -------------------------------------------------------------------

describe("extractFigures", () => {
  it("normalises thousands separators, so the same amount two ways compares equal", () => {
    // The commonest false positive there is: a rewrite that drops a comma
    // has not dropped the money.
    expect(extractFigures("$1,200")).toEqual(extractFigures("$1200"));
  });

  it("folds small number words to digits, so spelling one out is not a drop", () => {
    // "3 things" becoming "three things" is a rewrite doing its job.
    expect(extractFigures("three things")).toEqual(["3"]);
    expect(extractFigures("3 things")).toEqual(["3"]);
  });

  it("treats a trailing decimal zero as the same number", () => {
    expect(extractFigures("12.0 hours")).toEqual(extractFigures("12 hours"));
  });

  it("keeps a real decimal, because 1.5 and 15 are not the same figure", () => {
    expect(extractFigures("1.5")).toEqual(["1.5"]);
  });

  it("finds every figure, not just the first", () => {
    expect(extractFigures("34 hours against a normal month's 12")).toEqual(["34", "12"]);
  });
});

describe("extractNames", () => {
  it("ignores the first word of a sentence, which is capitalised regardless", () => {
    // Without this the list is mostly sentence openers and is useless.
    expect(extractNames("The invoice is higher.")).toEqual([]);
  });

  it("finds a name in the middle of a sentence", () => {
    expect(extractNames("The estimate is with Priya now.")).toContain("Priya");
  });

  it("ignores days and months, which are capitalised and are not names here", () => {
    // A date that moved is caught by the figure check, and listing "March"
    // as a dropped name on every rewrite would train people to ignore this.
    expect(extractNames("We agreed on Friday that March would work.")).toEqual([]);
  });

  it("keeps an internal apostrophe, so a surname survives", () => {
    expect(extractNames("The note came from O'Brien last week.")).toContain("O'Brien");
  });

  it("finds names after a line break as well as after a full stop", () => {
    expect(extractNames("It is done.\nThe work went to Sam.")).toContain("Sam");
  });
});

describe("compareMeaning", () => {
  const same = "The March invoice is higher because of 34 hours of migration work.";

  it("finds nothing when the rewrite kept the figures and stayed the same length", () => {
    // A LIGHT-TOUCH rewrite of similar length, which is what the mode means.
    // The first draft of this test used a rewrite a third shorter and the
    // length band caught it - correctly, which is why the fixture changed
    // rather than the band.
    expect(compareMeaning(same, "The March invoice is higher: 34 hours went on migration work.")).toEqual(
      [],
    );
  });

  it("ALERTS on an invented figure, which is the worst thing it can catch", () => {
    // An added figure reads as authoritative because everything around it is
    // correct. This is the single most valuable finding in the file.
    const findings = compareMeaning(same, "March is higher: 34 hours of migration, up 60% on February.");

    expect(findings.some((finding) => finding.kind === "figure-added")).toBe(true);
    expect(findings.find((finding) => finding.kind === "figure-added")?.severity).toBe("alert");
  });

  it("alerts on a figure that went missing", () => {
    const findings = compareMeaning(same, "March is higher because of the migration work.");

    expect(findings.some((finding) => finding.kind === "figure-dropped")).toBe(true);
  });

  it("counts occurrences, so a figure used twice and dropped once is caught", () => {
    // A set would call this clean, which is the bug this exists to prevent.
    const findings = compareMeaning("We logged 12 and 12 again.", "We logged 12.");

    expect(findings.some((finding) => finding.kind === "figure-dropped")).toBe(true);
  });

  it("alerts on a name the original did not contain", () => {
    const findings = compareMeaning(
      "The estimate is not done.",
      "The estimate is with Priya and is not done.",
    );

    expect(findings.some((finding) => finding.kind === "name-added")).toBe(true);
  });

  it("notes a rewrite that grew past its band", () => {
    const short = "It is done.";
    const long = `${short} ${"Padding that goes on and on and adds nothing at all. ".repeat(6)}`;

    const findings = compareMeaning(short, long, "light");

    expect(findings.some((finding) => finding.kind === "length")).toBe(true);
  });

  it("is LOOSER about length in full-rewrite mode than in light-touch mode", () => {
    // The bands exist so the check matches what was asked for. A free rewrite
    // that trims is doing what it was told.
    expect(LENGTH_BANDS.full.min).toBeLessThan(LENGTH_BANDS.light.min);
    expect(LENGTH_BANDS.full.max).toBeGreaterThan(LENGTH_BANDS.light.max);
  });

  it("notes prose turned into a list", () => {
    const findings = compareMeaning(
      "We found two things worth changing in the export.",
      "We found two things worth changing in the export:\n\n- the nightly job\n- the mapping",
    );

    expect(findings.some((finding) => finding.kind === "structure")).toBe(true);
  });

  it("does NOT complain when the original was already a list", () => {
    const listed = "Two things:\n\n- the nightly job\n- the mapping";

    expect(compareMeaning(listed, listed).some((finding) => finding.kind === "structure")).toBe(false);
  });

  it("survives an empty source without dividing by zero", () => {
    // The box can be empty for a moment while somebody pastes.
    expect(() => compareMeaning("", "anything at all")).not.toThrow();
    expect(compareMeaning("", "").some((finding) => finding.kind === "length")).toBe(false);
  });

  it("orders an invented figure above a softer note", () => {
    // The reader's eye goes to the top, so the thing that could embarrass
    // them has to be there.
    const findings = compareMeaning(
      "It is done.",
      "It is done, and we saved 40% doing it, which is a result we are pleased with and wanted to share.",
    );

    expect(findings[0].kind).toBe("figure-added");
  });
});
