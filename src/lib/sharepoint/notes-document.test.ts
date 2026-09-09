import { describe, expect, it } from "vitest";

import { buildNotesDocument } from "./notes-document";

const BASE = {
  title: "Bowhill Engineering - weekly catch-up",
  recordedLabel: "Recorded: 9 September 2026, 10:30 am",
  sourceDescription: "Source: imported from a Microsoft Teams meeting",
  participants: ["Louis D'Odorico", "Josh Brazier"],
  summary: "Agreed to ship the delivery board on Friday.",
  transcriptLines: ["[00:00] Louis: Morning.", "[00:04] Josh: Morning."],
};

describe("buildNotesDocument", () => {
  it("leads with the summary, because that is what a reader came for", () => {
    const { text } = buildNotesDocument(BASE);

    expect(text.indexOf("## Summary")).toBeLessThan(text.indexOf("## Transcript"));
    expect(text).toContain("Agreed to ship the delivery board on Friday.");
  });

  it("says where it came from and that it is automatic", () => {
    // A document in a client folder with no provenance is worse than none -
    // the reader cannot tell whether a person wrote it or where to check.
    const { text } = buildNotesDocument(BASE);

    expect(text).toContain("Recorded: 9 September 2026, 10:30 am");
    expect(text).toContain("Source: imported from a Microsoft Teams meeting");
    expect(text).toContain("Speech recognition makes mistakes");
  });

  it("names the people when Teams attributed them, and stays quiet when it did not", () => {
    expect(buildNotesDocument(BASE).text).toContain("People: Louis D'Odorico, Josh Brazier");
    // Not "People: none". An empty field is noise.
    expect(buildNotesDocument({ ...BASE, participants: [] }).text).not.toContain("People:");
  });

  it("says so when there is no summary rather than leaving a blank heading", () => {
    // A REAL case, not a defensive one: 'completed' means the transcript is
    // stored, and a failed summary call must never cost somebody their
    // transcript. So this document exists with a null summary.
    const { text } = buildNotesDocument({ ...BASE, summary: null });

    expect(text).toContain("## Summary");
    expect(text).toContain("No summary was produced");
  });

  it("treats a whitespace-only summary as no summary", () => {
    expect(buildNotesDocument({ ...BASE, summary: "   \n  " }).text).toContain("No summary was produced");
  });

  it("flattens a multi-line title so it cannot break the header", () => {
    // Meeting titles are pasted, and a newline in a markdown list item ends
    // the list - so the rest of the header would render as body text.
    const { text } = buildNotesDocument({ ...BASE, title: "Weekly\ncatch-up\n\nBowhill" });

    expect(text.startsWith("# Weekly catch-up Bowhill\n")).toBe(true);
  });

  it("survives a title that is only whitespace", () => {
    expect(buildNotesDocument({ ...BASE, title: "   " }).text.startsWith("# Meeting notes")).toBe(true);
  });

  it("does NOT fence the transcript, so a meeting about markdown cannot break it", () => {
    // The reason this is a test: wrapping untrusted text in ``` looks tidier
    // until the text contains a fence of its own, at which point the
    // document breaks in the middle and everything after it renders wrong.
    const { text } = buildNotesDocument({
      ...BASE,
      transcriptLines: ["[00:00] Louis: so you write ``` and then the language."],
    });

    expect(text).toContain("``` and then the language.");
    expect(text.split("\n").some((line) => line.trim() === "```")).toBe(false);
  });

  it("cuts a transcript that is longer than a meeting can be, and SAYS it cut it", () => {
    // Silence here would read as a failed recording rather than a cut file.
    const enormous = ["x".repeat(600_000)];

    const result = buildNotesDocument({ ...BASE, transcriptLines: enormous });

    expect(result.truncated).toBe(true);
    expect(result.text).toContain("has been cut off here");
    expect(result.text.length).toBeLessThan(510_000);
  });

  it("does not claim truncation for a long but plausible meeting", () => {
    const twoHours = Array.from({ length: 2_000 }, (_, index) => `[00:0${index % 10}] Louis: ${"word ".repeat(10)}`);

    expect(buildNotesDocument({ ...BASE, transcriptLines: twoHours }).truncated).toBe(false);
  });

  it("says so when there is no transcript at all", () => {
    const { text } = buildNotesDocument({ ...BASE, transcriptLines: [] });

    expect(text).toContain("No transcript was available.");
  });

  it("ends with exactly one newline", () => {
    // SharePoint's preview and every text editor expect a trailing newline;
    // two look like an accident in a diff.
    const { text } = buildNotesDocument(BASE);

    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});
