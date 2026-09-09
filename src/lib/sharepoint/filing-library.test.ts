import { describe, expect, it } from "vitest";

import { chooseFilingLibrary, type FilingLibrary } from "./filing-library";

function library(siteName: string, driveName: string): FilingLibrary {
  return { driveId: `drive:${siteName}:${driveName}`, siteName, driveName };
}

const DATA_SAGACITY = library("DataSagacity", "Documents");
const OTHER_SITE = library("Projects", "Documents");
const SHARED = library("DataSagacity", "Shared Files");

describe("chooseFilingLibrary", () => {
  it("takes the only nominated library without being told to", () => {
    // Making somebody restate in configuration what they already chose in
    // the UI is configuration that goes stale and then misfiles everything.
    expect(chooseFilingLibrary([DATA_SAGACITY], null)).toMatchObject({
      kind: "chosen",
      library: { driveName: "Documents" },
    });
  });

  it("REFUSES when several are nominated and nothing says which", () => {
    // The wrong-folder problem one level up. A note in the wrong library is
    // somewhere people who should not read it can reach.
    const result = chooseFilingLibrary([DATA_SAGACITY, SHARED], null);

    expect(result.kind).toBe("none");
    expect(result.kind === "none" && result.reason).toContain("SHAREPOINT_FILING_LIBRARY");
    // Names them, because the message is the whole remedy.
    expect(result.kind === "none" && result.reason).toContain("DataSagacity / Shared Files");
  });

  it("matches on the library name, ignoring case and spacing", () => {
    for (const configured of ["Shared Files", "shared files", "  SHARED   FILES  "]) {
      expect(chooseFilingLibrary([DATA_SAGACITY, SHARED], configured)).toMatchObject({
        kind: "chosen",
        library: { driveName: "Shared Files" },
      });
    }
  });

  it("matches on the qualified Site / Library form", () => {
    expect(chooseFilingLibrary([DATA_SAGACITY, OTHER_SITE], "DataSagacity / Documents")).toMatchObject({
      kind: "chosen",
      library: { driveId: DATA_SAGACITY.driveId },
    });
  });

  it("refuses an unqualified name that two sites share, and says how to fix it", () => {
    const result = chooseFilingLibrary([DATA_SAGACITY, OTHER_SITE], "Documents");

    expect(result.kind).toBe("none");
    expect(result.kind === "none" && result.reason).toContain('Qualify it as "Site / Library"');
  });

  it("does NOT fall back to the only library when the configured name misses", () => {
    // The failure this is here for. A library removed from the nomination
    // list, or a typo, must not quietly resolve to whatever is left - that
    // files every meeting somewhere nobody chose.
    const result = chooseFilingLibrary([DATA_SAGACITY], "Archive");

    expect(result.kind).toBe("none");
    expect(result.kind === "none" && result.reason).toContain("not a nominated library");
    expect(result.kind === "none" && result.reason).toContain("DataSagacity / Documents");
  });

  it("says nothing is nominated when nothing is", () => {
    const result = chooseFilingLibrary([], "Documents");

    expect(result.kind).toBe("none");
    expect(result.kind === "none" && result.reason).toContain("No SharePoint library has been nominated");
  });

  it("treats a whitespace-only setting as unset", () => {
    expect(chooseFilingLibrary([DATA_SAGACITY], "   ")).toMatchObject({ kind: "chosen" });
  });
});
