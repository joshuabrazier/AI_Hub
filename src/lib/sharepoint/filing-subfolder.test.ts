import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILING_SUBFOLDER,
  isAlreadySubfolder,
  resolveFilingSubfolder,
  subfolderPath,
} from "./filing-subfolder";

describe("resolveFilingSubfolder", () => {
  it("falls back to the default when nothing is configured", () => {
    // Unset means the default, NOT "no subfolder". Turning the nesting off
    // would be a separate decision; an empty setting is far more likely to
    // be an accident than an instruction.
    for (const value of [null, undefined, "", "   "]) {
      expect(resolveFilingSubfolder(value)).toEqual({ ok: true, name: DEFAULT_FILING_SUBFOLDER });
    }
  });

  it("takes a configured name and trims it", () => {
    // SharePoint silently strips a trailing space and then cannot find the
    // folder by the name you asked for, which reads as the folder having
    // vanished.
    expect(resolveFilingSubfolder("  Meeting Notes  ")).toEqual({ ok: true, name: "Meeting Notes" });
  });

  it("REFUSES a path where a name was asked for", () => {
    // The mistake somebody would actually make. Meeting notes go exactly one
    // folder deep inside whatever was matched, and accepting a path here
    // would let configuration create a tree inside a client folder.
    const result = resolveFilingSubfolder("Meetings/Transcriptions");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("is a path, not a folder name");
  });

  it("refuses a name SharePoint would reject", () => {
    // Not re-listing the rules here: parseFolderPath owns them, and this
    // asserts that they are actually reached rather than that they exist.
    expect(resolveFilingSubfolder("Meetings: 2026").ok).toBe(false);
    expect(resolveFilingSubfolder("Transcriptions.").ok).toBe(false);
    expect(resolveFilingSubfolder("con").ok).toBe(false);
  });

  it("gives a reason a person can act on", () => {
    const result = resolveFilingSubfolder("Meetings|Notes");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason.length).toBeGreaterThan(20);
  });
});

describe("isAlreadySubfolder", () => {
  it("spots the folder that is already the destination", () => {
    // THE BUG THIS PREVENTS. Once these subfolders exist and the library is
    // crawled again, every client has one and they are offered to the model
    // like any other folder. Picking one directly would otherwise nest a
    // second copy inside it, and a third the year after.
    expect(isAlreadySubfolder("Meeting Transcriptions", "Meeting Transcriptions")).toBe(true);
  });

  it("ignores case and spacing, because the folder was made by hand", () => {
    for (const name of ["meeting transcriptions", "MEETING TRANSCRIPTIONS", " Meeting  Transcriptions "]) {
      expect(isAlreadySubfolder(name, "Meeting Transcriptions")).toBe(true);
    }
  });

  it("does not confuse a client folder for the subfolder", () => {
    expect(isAlreadySubfolder("Bowhill Engineering", "Meeting Transcriptions")).toBe(false);
    // Nor a folder that merely contains the words.
    expect(isAlreadySubfolder("Old Meeting Transcriptions 2019", "Meeting Transcriptions")).toBe(false);
  });
});

describe("subfolderPath", () => {
  it("joins the parent path and the subfolder", () => {
    expect(subfolderPath("/Clients/Bowhill Engineering", "Meeting Transcriptions")).toBe(
      "/Clients/Bowhill Engineering/Meeting Transcriptions",
    );
  });

  it("copes with the drive root, which reports itself as a bare slash", () => {
    // Joining naively would produce "//Meeting Transcriptions".
    expect(subfolderPath("/", "Meeting Transcriptions")).toBe("/Meeting Transcriptions");
    expect(subfolderPath("", "Meeting Transcriptions")).toBe("/Meeting Transcriptions");
  });

  it("does not double a separator on a trailing slash", () => {
    expect(subfolderPath("/Clients/Acme/", "Meeting Transcriptions")).toBe(
      "/Clients/Acme/Meeting Transcriptions",
    );
  });

  it("names the folder the file is actually in, not its parent", () => {
    // The stored path is a snapshot somebody uses to go and look. Pointing
    // one level up is the near-miss that wastes an afternoon.
    const parent = "/Clients/Acme";

    expect(subfolderPath(parent, "Meeting Transcriptions")).not.toBe(parent);
    expect(subfolderPath(parent, "Meeting Transcriptions").startsWith(parent)).toBe(true);
  });
});
