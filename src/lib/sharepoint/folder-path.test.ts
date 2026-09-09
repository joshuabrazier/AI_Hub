import { describe, expect, it } from "vitest";

import { buildNotesFileName, parseFolderPath } from "./folder-path";

describe("parseFolderPath", () => {
  it("splits a normal path", () => {
    expect(parseFolderPath("Meetings/Unfiled")).toEqual({ ok: true, segments: ["Meetings", "Unfiled"] });
  });

  it("tolerates the ways people actually type a path", () => {
    // A leading slash, a trailing slash, doubled separators, Windows
    // backslashes and stray spaces are all a matter of when, not if, once a
    // path lives in an environment variable.
    for (const raw of [
      "/Meetings/Unfiled",
      "Meetings/Unfiled/",
      "Meetings//Unfiled",
      "Meetings\\Unfiled",
      "  Meetings / Unfiled  ",
    ]) {
      expect(parseFolderPath(raw)).toEqual({ ok: true, segments: ["Meetings", "Unfiled"] });
    }
  });

  it("REFUSES a path that walks upwards", () => {
    // The one that matters. A path containing ".." would address a write
    // outside the folder somebody configured, and this function exists
    // rather than a split call precisely to stop that.
    expect(parseFolderPath("Meetings/../../Finance").ok).toBe(false);
    expect(parseFolderPath("../Finance").ok).toBe(false);
    expect(parseFolderPath("Meetings/./Unfiled").ok).toBe(false);
  });

  it("refuses characters SharePoint rejects in a name", () => {
    for (const raw of ["Meetings/Un*filed", "Meetings/Un?filed", 'Meetings/Un"filed', "Meetings/Un<filed"]) {
      expect(parseFolderPath(raw).ok).toBe(false);
    }
  });

  it("refuses a segment ending in a dot", () => {
    // SharePoint silently strips it and then cannot find the folder by the
    // name that was asked for, which reads as the folder having vanished.
    expect(parseFolderPath("Meetings/Unfiled.").ok).toBe(false);
  });

  it("refuses names SharePoint reserves", () => {
    expect(parseFolderPath("Meetings/CON").ok).toBe(false);
    expect(parseFolderPath("Meetings/nul").ok).toBe(false);
  });

  it("refuses an empty or missing setting, and says so", () => {
    for (const raw of ["", "   ", "///", null, undefined]) {
      const result = parseFolderPath(raw);

      expect(result.ok).toBe(false);
      // Reported as a configuration problem rather than a failed filing,
      // because that is what it is and the remedies are different.
      expect(result.ok === false && result.reason.length).toBeGreaterThan(0);
    }
  });

  it("refuses a path long enough for SharePoint to reject", () => {
    expect(parseFolderPath(`Meetings/${"a".repeat(200)}`).ok).toBe(false);
    expect(parseFolderPath(Array.from({ length: 80 }, () => "folder").join("/")).ok).toBe(false);
  });

  it("refuses an absurdly deep path before creating a nest of empty folders", () => {
    // A typo or a pasted URL. Creating forty nested folders leaves somebody
    // hunting for empties to delete, which is a worse outcome than refusing.
    expect(parseFolderPath(Array.from({ length: 40 }, () => "f").join("/")).ok).toBe(false);
    expect(parseFolderPath("Meetings/2026/Unfiled").ok).toBe(true);
  });
});

describe("buildNotesFileName", () => {
  it("leads with the date so a folder sorts chronologically", () => {
    // How somebody looks for a meeting they half-remember.
    expect(buildNotesFileName({ workDate: "2026-09-09", title: "Phase 2 catch-up", extension: "md" })).toBe(
      "2026-09-09 Phase 2 catch-up.md",
    );
  });

  it("strips characters SharePoint rejects from a meeting title", () => {
    // A title is user input twice over: typed into a calendar by somebody
    // who was not thinking about SharePoint.
    const name = buildNotesFileName({
      workDate: "2026-09-09",
      title: 'Review: Q3/Q4 <plans> #1 100%?',
      extension: "md",
    });

    expect(name).not.toMatch(/["*:<>?/\\|#%]/);
    expect(name.endsWith(".md")).toBe(true);
  });

  it("survives a title that is only punctuation", () => {
    // Left with just the date rather than a file called ".md".
    expect(buildNotesFileName({ workDate: "2026-09-09", title: "???", extension: "md" })).toBe("2026-09-09.md");
  });

  it("never ends the stem in a dot or a space", () => {
    const name = buildNotesFileName({ workDate: "2026-09-09", title: "Wrap up.  ", extension: "md" });

    expect(name).toBe("2026-09-09 Wrap up.md");
  });

  it("caps a very long title so the whole path stays inside the limit", () => {
    const name = buildNotesFileName({ workDate: "2026-09-09", title: "meeting ".repeat(50), extension: "md" });

    expect(name.length).toBeLessThan(110);
  });
});
