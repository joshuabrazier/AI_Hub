import { describe, expect, it } from "vitest";

import { GraphContractError } from "./graph-types";
import { partitionDeltaItems, toSharepointItemRow } from "./item-mapping";
import { parseDriveItem } from "./graph-types";

// -------------------------------------------------------------------
// The mapping from a checked Graph item to a row.
//
// Separate from graph-types.test.ts because the failure is a different
// kind. Parsing fails loudly; mapping fails quietly - a wrong row is a
// plausible row, and an inventory nobody can tell is wrong is worse than
// one that refused to be written.
// -------------------------------------------------------------------

const SEEN_AT = new Date("2026-08-26T02:00:00Z");

function live(overrides: Record<string, unknown> = {}) {
  return parseDriveItem({
    id: "01ABC",
    name: "Invoice 42.pdf",
    size: 20480,
    parentReference: { id: "01PARENT", path: "/drives/b!abc/root:/Finance" },
    file: { hashes: { quickXorHash: "ABC123" } },
    ...overrides,
  });
}

describe("partitionDeltaItems", () => {
  it("sends tombstones down a different path from live items", () => {
    // They take completely different writes: an upsert that may insert, and
    // an update that must never insert. Mixing them is how a tombstone for
    // an item we never saw becomes a row with no name.
    const { live: liveItems, deletedIds } = partitionDeltaItems([
      live(),
      parseDriveItem({ id: "01GONE", deleted: { state: "deleted" } }),
      live({ id: "01DEF", name: "b.docx" }),
    ]);

    expect(liveItems.map((item) => item.itemId)).toEqual(["01ABC", "01DEF"]);
    expect(deletedIds).toEqual(["01GONE"]);
  });

  it("handles a page that is all one kind", () => {
    expect(partitionDeltaItems([]).live).toEqual([]);
    expect(partitionDeltaItems([live()]).deletedIds).toEqual([]);
  });
});

describe("toSharepointItemRow", () => {
  it("carries the fields the inventory is built on", () => {
    const row = toSharepointItemRow("b!abc", live(), SEEN_AT);

    expect(row).toMatchObject({
      driveId: "b!abc",
      itemId: "01ABC",
      parentId: "01PARENT",
      name: "Invoice 42.pdf",
      path: "/Finance",
      depth: 1,
      isFolder: false,
      sizeBytes: 20480,
      quickXorHash: "ABC123",
    });
  });

  it("stamps both seen times, because the caller cannot know insert from update", () => {
    const row = toSharepointItemRow("b!abc", live(), SEEN_AT);

    expect(row.firstSeenAt).toBe(SEEN_AT);
    expect(row.lastSeenAt).toBe(SEEN_AT);
  });

  it("does not record a size for a folder", () => {
    // Graph reports a folder size as its whole subtree. Storing it would
    // count every byte once for the file and again for each folder above
    // it, so a library total would come out several times too large.
    const folder = parseDriveItem({
      id: "01FOLDER",
      name: "Finance",
      size: 999_999,
      parentReference: { id: "01ROOT", path: "/drives/b!abc/root:" },
      folder: { childCount: 12 },
    });

    const row = toSharepointItemRow("b!abc", folder, SEEN_AT);

    expect(row.sizeBytes).toBeNull();
    expect(row.childCount).toBe(12);
    expect(row.isFolder).toBe(true);
  });

  it("does not record a child count for a file", () => {
    expect(toSharepointItemRow("b!abc", live(), SEEN_AT).childCount).toBeNull();
  });

  it("keeps an unknown path and depth as NULL rather than guessing a root", () => {
    // Depth outliers are a phase-2 finding. A guessed depth of 0 would put
    // every unparseable item at the top of the library and make the
    // shallowest folders look like the deepest problem.
    const odd = live({ parentReference: { id: "01P", path: "/unexpected/shape" } });
    const row = toSharepointItemRow("b!abc", odd, SEEN_AT);

    expect(row.path).toBeNull();
    expect(row.depth).toBeNull();
  });

  it("refuses a live item with no name instead of inventing one", () => {
    // A placeholder would put a file called "(unnamed)" into something an
    // admin reads as a record of what is really there.
    const nameless = live({ name: undefined });

    expect(() => toSharepointItemRow("b!abc", nameless, SEEN_AT)).toThrow(GraphContractError);
  });

  it("refuses a tombstone, which belongs on the update path", () => {
    const tombstone = parseDriveItem({ id: "01GONE", deleted: { state: "deleted" } });

    expect(() => toSharepointItemRow("b!abc", tombstone, SEEN_AT)).toThrow(GraphContractError);
  });

  it("never writes hasUniquePermissions", () => {
    // Phase 5 needs it to decide what is safe to move automatically. NULL
    // means not established; a written false would mean safe, which phase 1
    // has no basis to claim.
    expect(toSharepointItemRow("b!abc", live(), SEEN_AT)).not.toHaveProperty("hasUniquePermissions");
  });
});
