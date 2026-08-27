import "server-only";

// -------------------------------------------------------------------
// Microsoft Graph - the shapes phase 1 reads, and the checks on them
//
// ===================================================================
// CONFIRMED against Microsoft's own reference, except where marked
// ===================================================================
// The delta endpoint, its `@odata.nextLink` / `@odata.deltaLink` pair, the
// driveItem fields below and the tombstone `deleted` facet are all
// documented behaviour:
//   https://learn.microsoft.com/graph/api/driveitem-delta
//   https://learn.microsoft.com/graph/api/resources/driveitem
//
// TWO THINGS ARE INFERRED and are marked at the point of use below:
//   1. that `parentReference.path` is always the "/drives/{id}/root:/a/b"
//      form. Observed shape, not a documented guarantee.
//   2. that `file.hashes.quickXorHash` is present for every file in
//      SharePoint. It is documented as the SharePoint/OneDrive-for-Business
//      hash, but not as always populated.
//
// Neither is load-bearing: a missing path stores NULL depth and a missing
// hash stores NULL, and phase 2 treats both as "not established" rather
// than as a finding. That is the whole mitigation, and it is why they are
// allowed to be assumptions at all.
//
// WHAT IS NOT NEGOTIABLE is the rule the Jira client already sets: a wrong
// guess must never read as "nothing changed". So every response is
// shape-checked and a response that does not match THROWS BY NAME. An empty
// page and an unparseable page are completely different facts, and a crawl
// that treated the second as the first would report a library as clean when
// it had never read it.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// A driveItem, as far as phase 1 cares.
//
// Every field is optional because Graph omits rather than nulls: a folder
// has no `file`, a file has no `folder`, and a tombstone has almost
// nothing at all except an id and `deleted`.
// -------------------------------------------------------------------
export interface RawDriveItem {
  id?: unknown;
  name?: unknown;
  size?: unknown;
  webUrl?: unknown;
  createdDateTime?: unknown;
  lastModifiedDateTime?: unknown;
  parentReference?: { id?: unknown; path?: unknown } | null;
  file?: { hashes?: { quickXorHash?: unknown } | null } | null;
  folder?: { childCount?: unknown } | null;
  deleted?: { state?: unknown } | null;
  lastModifiedBy?: { user?: { displayName?: unknown } | null } | null;
}

// What one delta page carries. Exactly one of nextLink / deltaLink is
// present: nextLink means "more pages", deltaLink means "that was the last
// one, keep this for next time".
export interface DeltaPage {
  items: ParsedDriveItem[];
  nextLink: string | null;
  deltaLink: string | null;
}

// -------------------------------------------------------------------
// The item after checking, in the shape the repository stores.
//
// `isDeleted` is separated from the rest because a tombstone carries
// nothing else worth having, and the caller must not treat a tombstone's
// absent name as "the file is now called nothing".
// -------------------------------------------------------------------
export interface ParsedDriveItem {
  itemId: string;
  isDeleted: boolean;
  name: string | null;
  parentId: string | null;
  path: string | null;
  depth: number | null;
  isFolder: boolean;
  sizeBytes: number | null;
  childCount: number | null;
  quickXorHash: string | null;
  webUrl: string | null;
  createdAtRemote: Date | null;
  modifiedAtRemote: Date | null;
  modifiedByName: string | null;
}

// A response that does not match. Named so a caller can tell a contract
// failure apart from a network failure, because the responses are
// different: a network failure is retried, this one is not.
export class GraphContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphContractError";
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Graph sends ISO 8601. An unparseable one becomes NULL rather than an
// Invalid Date, which would reach Postgres and fail the whole page.
function asDate(value: unknown): Date | null {
  const text = asString(value);
  if (!text) return null;

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// -------------------------------------------------------------------
// Folder path and depth from parentReference.path.
//
// INFERRED SHAPE. Graph reports the path as "/drives/{driveId}/root:/a/b",
// and the part after "root:" is the folder path. That form is what the API
// returns in practice; it is not a documented guarantee, so anything that
// does not match yields NULL rather than a guessed prefix.
//
// Depth counts path segments. Root itself is 0. It is precomputed because
// phase 2 looks for depth outliers, and deriving it per query would mean
// re-parsing every path on every run.
// -------------------------------------------------------------------
export function parseFolderPath(rawPath: unknown): { path: string | null; depth: number | null } {
  const text = asString(rawPath);
  if (!text) return { path: null, depth: null };

  const marker = text.indexOf("root:");
  if (marker < 0) return { path: null, depth: null };

  // Everything after "root:", with any leading slash removed.
  const folder = decodeURIComponent(text.slice(marker + "root:".length)).replace(/^\/+/, "");

  if (folder === "") return { path: "/", depth: 0 };

  return { path: `/${folder}`, depth: folder.split("/").filter(Boolean).length };
}

// -------------------------------------------------------------------
// One item.
//
// Throws when there is no usable id, because an item we cannot key is an
// item we cannot store, and silently dropping it would under-report the
// library - the exact failure this file exists to prevent.
// -------------------------------------------------------------------
export function parseDriveItem(raw: RawDriveItem): ParsedDriveItem {
  const itemId = asString(raw?.id);

  if (!itemId) {
    throw new GraphContractError("A driveItem arrived with no id, so it cannot be recorded");
  }

  const isDeleted = Boolean(raw.deleted);

  // A tombstone carries an id and little else. Reading its absent name as
  // a real value would overwrite what we know with nothing.
  if (isDeleted) {
    return {
      itemId,
      isDeleted: true,
      name: null,
      parentId: asString(raw.parentReference?.id),
      path: null,
      depth: null,
      isFolder: false,
      sizeBytes: null,
      childCount: null,
      quickXorHash: null,
      webUrl: null,
      createdAtRemote: null,
      modifiedAtRemote: null,
      modifiedByName: null,
    };
  }

  const { path, depth } = parseFolderPath(raw.parentReference?.path);

  return {
    itemId,
    isDeleted: false,
    name: asString(raw.name),
    parentId: asString(raw.parentReference?.id),
    path,
    depth,
    // The presence of the `folder` facet is what makes something a folder.
    // Not the absence of `file`: a tombstone has neither, and an item type
    // we have not met would otherwise be filed as a file.
    isFolder: Boolean(raw.folder),
    sizeBytes: asNumber(raw.size),
    childCount: asNumber(raw.folder?.childCount),
    // INFERRED that this is present for every SharePoint file. NULL when it
    // is not, and phase 2 reads NULL as "no hash to compare" rather than as
    // "no duplicate".
    quickXorHash: asString(raw.file?.hashes?.quickXorHash),
    webUrl: asString(raw.webUrl),
    createdAtRemote: asDate(raw.createdDateTime),
    modifiedAtRemote: asDate(raw.lastModifiedDateTime),
    modifiedByName: asString(raw.lastModifiedBy?.user?.displayName),
  };
}

// -------------------------------------------------------------------
// A site and a document library, for nomination.
//
// CONFIRMED shapes:
//   https://learn.microsoft.com/graph/api/site-getbypath
//   https://learn.microsoft.com/graph/api/drive-list
//
// `driveType` tells a real document library apart from the other things
// Graph calls a drive on a site. Kept as a raw string rather than an enum
// because the caller only compares it, and an unrecognised value should
// narrow the list rather than throw - a drive type we have not met is a
// drive we should not crawl, not a broken response.
// -------------------------------------------------------------------
export interface ParsedSite {
  siteId: string;
  displayName: string;
  webUrl: string | null;
}

export interface ParsedDrive {
  driveId: string;
  name: string;
  driveType: string | null;
  webUrl: string | null;
}

export function parseSite(payload: unknown): ParsedSite {
  if (!payload || typeof payload !== "object") {
    throw new GraphContractError("The site response was not an object");
  }

  const body = payload as Record<string, unknown>;
  const siteId = asString(body.id);

  if (!siteId) {
    throw new GraphContractError("The site response carried no id");
  }

  return {
    // `displayName` is absent on some sites and `name` is the fallback
    // Graph itself documents. Falling back to the id last means the drive
    // picker always has something to label a row with.
    displayName: asString(body.displayName) ?? asString(body.name) ?? siteId,
    siteId,
    webUrl: asString(body.webUrl),
  };
}

export function parseDriveList(payload: unknown): ParsedDrive[] {
  if (!payload || typeof payload !== "object") {
    throw new GraphContractError("The drive list response was not an object");
  }

  const body = payload as Record<string, unknown>;

  // Same rule as a delta page: no `value` array is a response we do not
  // understand, and reporting it as a site with no libraries would send an
  // admin looking for a permissions problem that is not there.
  if (!Array.isArray(body.value)) {
    throw new GraphContractError("The drive list response had no `value` array");
  }

  return body.value.map((raw) => {
    const drive = (raw ?? {}) as Record<string, unknown>;
    const driveId = asString(drive.id);

    if (!driveId) {
      throw new GraphContractError("A drive arrived with no id, so it cannot be nominated");
    }

    return {
      driveId,
      name: asString(drive.name) ?? driveId,
      driveType: asString(drive.driveType),
      webUrl: asString(drive.webUrl),
    };
  });
}

// -------------------------------------------------------------------
// One delta page.
//
// The `value` array is the contract. A response without it is not an empty
// page, it is a response we do not understand, and the difference decides
// whether a crawl reports a clean library or an error. So it throws.
// -------------------------------------------------------------------
export function parseDeltaPage(payload: unknown): DeltaPage {
  if (!payload || typeof payload !== "object") {
    throw new GraphContractError("The delta response was not an object");
  }

  const body = payload as Record<string, unknown>;

  if (!Array.isArray(body.value)) {
    throw new GraphContractError("The delta response had no `value` array, so no items could be read");
  }

  const nextLink = asString(body["@odata.nextLink"]);
  const deltaLink = asString(body["@odata.deltaLink"]);

  // Both present is not a shape Graph documents, and acting on it would
  // mean guessing which one wins. Refusing is the only answer that cannot
  // silently truncate a walk.
  if (nextLink && deltaLink) {
    throw new GraphContractError("The delta response carried both a nextLink and a deltaLink");
  }

  return {
    items: body.value.map((item) => parseDriveItem(item as RawDriveItem)),
    nextLink,
    deltaLink,
  };
}
