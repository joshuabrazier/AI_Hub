import { GraphContractError, type ParsedDriveItem } from "./graph-types";

// -------------------------------------------------------------------
// From a checked Graph item to a row.
//
// Pure, and separate from the crawl service for the same reason
// jira-mapping.ts is separate from the sync service: this is where a
// mistake is silent. A wrong retry throws and gets noticed; a wrong
// mapping produces a plausible row and gets believed.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// A delta page mixes live items and tombstones, and they take completely
// different write paths - one is an upsert, the other an update that must
// never insert. Splitting them here means the service never has to ask
// item by item.
// -------------------------------------------------------------------
export interface PartitionedDeltaItems {
  live: ParsedDriveItem[];
  deletedIds: string[];
}

export function partitionDeltaItems(items: ParsedDriveItem[]): PartitionedDeltaItems {
  const live: ParsedDriveItem[] = [];
  const deletedIds: string[] = [];

  for (const item of items) {
    if (item.isDeleted) {
      deletedIds.push(item.itemId);
    } else {
      live.push(item);
    }
  }

  return { live, deletedIds };
}

// -------------------------------------------------------------------
// One live item as a row.
//
// THROWS ON A MISSING NAME, rather than substituting anything.
//
// `name` is a documented property of every driveItem, so its absence on a
// live item means the response is not what we think it is. The two
// alternatives are both worse than stopping: a placeholder puts a file
// called "(unnamed)" into an inventory an admin reads as fact, and
// skipping the item under-reports the library, which is the one failure
// this whole feature is built to avoid. A name is also the single most
// load-bearing field downstream - near-duplicate detection and every
// human-readable finding are built on it.
//
// Tombstones never reach here. They legitimately have no name, and
// partitionDeltaItems sends them down the update path instead.
// -------------------------------------------------------------------
export interface SharepointItemRow {
  driveId: string;
  itemId: string;
  parentId: string | null;
  name: string;
  path: string | null;
  depth: number | null;
  isFolder: boolean;
  sizeBytes: number | null;
  childCount: number | null;
  quickXorHash: string | null;
  createdAtRemote: Date | null;
  modifiedAtRemote: Date | null;
  modifiedByName: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export function toSharepointItemRow(
  driveId: string,
  item: ParsedDriveItem,
  seenAt: Date,
): SharepointItemRow {
  if (item.isDeleted) {
    throw new GraphContractError(
      `A tombstone reached the item mapping, which only handles live items (${item.itemId})`,
    );
  }

  if (!item.name) {
    throw new GraphContractError(`A live driveItem arrived with no name (${item.itemId})`);
  }

  return {
    driveId,
    itemId: item.itemId,
    parentId: item.parentId,
    name: item.name,
    path: item.path,
    depth: item.depth,
    isFolder: item.isFolder,
    // A folder has no size worth recording, and Graph reports the size of
    // its whole subtree there. Summing that alongside the files it
    // contains would count every byte twice, once for the file and once
    // for each folder above it.
    sizeBytes: item.isFolder ? null : item.sizeBytes,
    childCount: item.isFolder ? item.childCount : null,
    quickXorHash: item.quickXorHash,
    createdAtRemote: item.createdAtRemote,
    modifiedAtRemote: item.modifiedAtRemote,
    modifiedByName: item.modifiedByName,
    // Both stamped, because the row may be an insert or an update and the
    // caller cannot know which. The upsert keeps the original firstSeenAt
    // on conflict, so this value only ever survives on a genuine insert.
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
  };
}

// hasUniquePermissions is deliberately absent from the row shape above.
// Phase 1 does not establish it, and a column left honestly NULL reads as
// "not established" where a written false would read as "safe to move".
