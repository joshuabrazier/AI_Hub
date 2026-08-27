import { describe, expect, it } from "vitest";

import {
  GraphContractError,
  parseDeltaPage,
  parseDriveItem,
  parseDriveList,
  parseFolderPath,
  parseSite,
} from "./graph-types";

// -------------------------------------------------------------------
// Parsing what Graph sends back.
//
// The rule these tests exist to hold is the one the Jira client sets: a
// response we do not understand must never read as "nothing changed". A
// crawl that mistook an unparseable page for an empty one would report a
// library as clean without ever having read it, and that failure looks
// exactly like a tidy library.
// -------------------------------------------------------------------

describe("parseFolderPath", () => {
  it("reads the folder path from the documented root: form", () => {
    expect(parseFolderPath("/drives/b!abc/root:/Finance/Invoices")).toEqual({
      path: "/Finance/Invoices",
      depth: 2,
    });
  });

  it("treats the library root as depth zero", () => {
    // Files at the root are a phase-2 finding in their own right, so the
    // difference between "root" and "unknown" has to survive.
    expect(parseFolderPath("/drives/b!abc/root:")).toEqual({ path: "/", depth: 0 });
    expect(parseFolderPath("/drives/b!abc/root:/")).toEqual({ path: "/", depth: 0 });
  });

  it("decodes percent-encoding, because real folders have spaces", () => {
    expect(parseFolderPath("/drives/b!abc/root:/Client%20Files/2026%20Q1")).toEqual({
      path: "/Client Files/2026 Q1",
      depth: 2,
    });
  });

  it("yields NULL for a shape it does not recognise, rather than guessing", () => {
    // The root: form is INFERRED, not guaranteed. If Graph ever sends
    // something else, an honest NULL depth is a gap in the analysis; a
    // guessed one is a wrong finding presented as a fact.
    expect(parseFolderPath("/something/else/entirely")).toEqual({ path: null, depth: null });
    expect(parseFolderPath(undefined)).toEqual({ path: null, depth: null });
    expect(parseFolderPath("")).toEqual({ path: null, depth: null });
  });
});

describe("parseDriveItem", () => {
  it("reads a file, including the hash duplicate detection needs", () => {
    const item = parseDriveItem({
      id: "01ABC",
      name: "Invoice 42.pdf",
      size: 20480,
      webUrl: "https://contoso.sharepoint.com/x.pdf",
      createdDateTime: "2026-01-05T09:30:00Z",
      lastModifiedDateTime: "2026-02-11T14:00:00Z",
      parentReference: { id: "01PARENT", path: "/drives/b!abc/root:/Finance" },
      file: { hashes: { quickXorHash: "ABC123" } },
      lastModifiedBy: { user: { displayName: "Philipp Rohlfshagen" } },
    });

    expect(item.itemId).toBe("01ABC");
    expect(item.isFolder).toBe(false);
    expect(item.sizeBytes).toBe(20480);
    expect(item.quickXorHash).toBe("ABC123");
    expect(item.path).toBe("/Finance");
    expect(item.depth).toBe(1);
    expect(item.modifiedByName).toBe("Philipp Rohlfshagen");
    expect(item.modifiedAtRemote?.toISOString()).toBe("2026-02-11T14:00:00.000Z");
  });

  it("reads a folder, including the child count", () => {
    const item = parseDriveItem({
      id: "01FOLDER",
      name: "Finance",
      parentReference: { id: "01ROOT", path: "/drives/b!abc/root:" },
      folder: { childCount: 0 },
    });

    expect(item.isFolder).toBe(true);
    // An empty folder is a phase-2 finding, so zero must survive as zero
    // and not be flattened into "no value".
    expect(item.childCount).toBe(0);
  });

  it("decides folder-ness from the folder facet, not from the absence of file", () => {
    // An item type we have not met - a package, a bundle - has neither
    // facet. Reading "not a file" as "a folder" would put it in the tree
    // as a container that can never have children.
    const odd = parseDriveItem({ id: "01ODD", name: "something", parentReference: { id: "01ROOT" } });

    expect(odd.isFolder).toBe(false);
  });

  it("keeps a tombstone as a deletion and does not read its absent fields as values", () => {
    const item = parseDriveItem({ id: "01GONE", deleted: { state: "deleted" } });

    expect(item.isDeleted).toBe(true);
    // The name is unknown, not empty. Overwriting a stored name with "" is
    // how a deleted file becomes an unnamed one in the report.
    expect(item.name).toBeNull();
    expect(item.quickXorHash).toBeNull();
  });

  it("throws when an item has no id, rather than dropping it", () => {
    // A dropped item under-reports the library, which is the failure this
    // whole file exists to prevent.
    expect(() => parseDriveItem({ name: "no id here" })).toThrow(GraphContractError);
  });

  it("survives a missing hash without claiming there is no duplicate", () => {
    const item = parseDriveItem({ id: "01NOHASH", name: "a.docx", file: {} });

    expect(item.quickXorHash).toBeNull();
    expect(item.isFolder).toBe(false);
  });

  it("turns an unparseable date into NULL rather than an Invalid Date", () => {
    // An Invalid Date reaches Postgres and fails the whole page, taking
    // every good item on it down with one bad timestamp.
    const item = parseDriveItem({ id: "01BAD", name: "a.docx", lastModifiedDateTime: "not a date" });

    expect(item.modifiedAtRemote).toBeNull();
  });
});

describe("parseDeltaPage", () => {
  it("reads a page and its nextLink", () => {
    const page = parseDeltaPage({
      value: [{ id: "01A", name: "a.docx" }],
      "@odata.nextLink": "https://graph.microsoft.com/next",
    });

    expect(page.items).toHaveLength(1);
    expect(page.nextLink).toBe("https://graph.microsoft.com/next");
    expect(page.deltaLink).toBeNull();
  });

  it("reads the final page and its deltaLink", () => {
    const page = parseDeltaPage({
      value: [],
      "@odata.deltaLink": "https://graph.microsoft.com/delta?token=xyz",
    });

    // A genuinely empty final page is legitimate: a library with nothing
    // new since the last crawl. It is distinguishable from a broken
    // response only because the broken one throws.
    expect(page.items).toHaveLength(0);
    expect(page.deltaLink).toBe("https://graph.microsoft.com/delta?token=xyz");
    expect(page.nextLink).toBeNull();
  });

  it("throws when there is no value array, instead of reporting an empty library", () => {
    // THE failure this file exists for. An error page, an HTML sign-in
    // redirect, a changed contract - all arrive as an object without
    // `value`, and all would otherwise read as "the library is empty".
    expect(() => parseDeltaPage({ error: { code: "invalidRequest" } })).toThrow(GraphContractError);
    expect(() => parseDeltaPage({})).toThrow(GraphContractError);
    expect(() => parseDeltaPage(null)).toThrow(GraphContractError);
    expect(() => parseDeltaPage("<html>sign in</html>")).toThrow(GraphContractError);
  });

  it("refuses a page carrying both links rather than guessing which wins", () => {
    // Not a shape Graph documents. Picking one would either truncate the
    // walk or loop it, and both are silent.
    expect(() =>
      parseDeltaPage({ value: [], "@odata.nextLink": "https://a", "@odata.deltaLink": "https://b" }),
    ).toThrow(GraphContractError);
  });

  it("lets a bad item take the page down rather than skipping it", () => {
    expect(() => parseDeltaPage({ value: [{ id: "01A" }, { name: "no id" }] })).toThrow(GraphContractError);
  });
});

describe("parseSite", () => {
  it("reads the id and a name to label it with", () => {
    expect(
      parseSite({
        id: "contoso.sharepoint.com,guid-a,guid-b",
        displayName: "Finance",
        webUrl: "https://contoso.sharepoint.com/sites/Finance",
      }),
    ).toEqual({
      siteId: "contoso.sharepoint.com,guid-a,guid-b",
      displayName: "Finance",
      webUrl: "https://contoso.sharepoint.com/sites/Finance",
    });
  });

  it("falls back through name to the id, so a picker row is never blank", () => {
    expect(parseSite({ id: "site-1", name: "finance" }).displayName).toBe("finance");
    expect(parseSite({ id: "site-1" }).displayName).toBe("site-1");
  });

  it("throws without an id, rather than yielding a site nothing can be fetched for", () => {
    expect(() => parseSite({ displayName: "Finance" })).toThrow(GraphContractError);
    expect(() => parseSite(null)).toThrow(GraphContractError);
  });
});

describe("parseDriveList", () => {
  it("reads the libraries on a site", () => {
    const drives = parseDriveList({
      value: [
        { id: "b!abc", name: "Documents", driveType: "documentLibrary", webUrl: "https://x/Shared Documents" },
        { id: "b!def", name: "Policies", driveType: "documentLibrary" },
      ],
    });

    expect(drives.map((drive) => drive.driveId)).toEqual(["b!abc", "b!def"]);
    expect(drives[0].driveType).toBe("documentLibrary");
    expect(drives[1].webUrl).toBeNull();
  });

  it("throws rather than reporting a site with no libraries", () => {
    expect(() => parseDriveList({ error: { code: "accessDenied" } })).toThrow(GraphContractError);
    expect(() => parseDriveList({})).toThrow(GraphContractError);
  });

  it("throws on a drive with no id", () => {
    expect(() => parseDriveList({ value: [{ name: "Documents" }] })).toThrow(GraphContractError);
  });

  it("keeps an unrecognised driveType instead of refusing the whole list", () => {
    const drives = parseDriveList({ value: [{ id: "b!abc", name: "Odd", driveType: "somethingNew" }] });

    expect(drives[0].driveType).toBe("somethingNew");
  });
});
