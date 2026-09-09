import "server-only";

import { getDelegatedGraphToken } from "@/lib/sharepoint/graph-token";
import { GraphRequestError, graphRequest, graphStatusOf } from "@/lib/sharepoint/graph-client";

// -------------------------------------------------------------------
// The only writes this application makes to SharePoint.
//
// Two of them: create a folder, and upload a text file. There is no move, no
// delete and no overwrite, and that is a property of the module rather than
// of how it happens to be called - nothing here can remove or replace
// anything somebody else put in the library.
//
// EVERY WRITE SETS conflictBehavior=fail AND TREATS THE 409 AS SUCCESS. That
// combination is what makes a retry safe. A sweep that was interrupted after
// uploading but before recording it will come back, meet its own file, and
// record that instead of creating a second copy - which matters because
// SharePoint's default behaviour is to accept a duplicate name as a new
// version or a "document (2)" rather than to refuse it. Taking the default
// would turn one interrupted run into a folder full of copies.
//
// DELEGATED, like everything else here, so Graph enforces that the person
// this runs for could have written there themselves. The app decides what to
// write; Microsoft decides whether they may.
// -------------------------------------------------------------------

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export interface DriveItemRef {
  itemId: string;
  name: string;
  webUrl: string | null;
}

interface GraphDriveItem {
  id?: string;
  name?: string;
  webUrl?: string;
}

function toRef(payload: unknown): DriveItemRef | null {
  const item = payload as GraphDriveItem;

  return item?.id ? { itemId: item.id, name: item.name ?? "", webUrl: item.webUrl ?? null } : null;
}

// Graph addresses an item by path with a colon-delimited segment, and each
// path part has to be encoded separately - encoding the whole path would
// escape the separators too.
function encodePath(segments: readonly string[]): string {
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

function statusOf(error: unknown): number | null {
  return error instanceof GraphRequestError ? graphStatusOf(error) : null;
}

// -------------------------------------------------------------------
// Find a folder by path, or report that it is not there.
//
// A 404 is an ANSWER here, not a failure - it is how Graph says "no such
// folder", which is exactly the question being asked. Everything else
// propagates, because a 403 on a lookup means the write that follows would
// fail too and should say so now rather than halfway through creating a tree.
// -------------------------------------------------------------------
async function findFolderByPath(
  token: string,
  driveId: string,
  segments: readonly string[],
): Promise<DriveItemRef | null> {
  if (segments.length === 0) {
    const root = await graphRequest(`${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/root`, token);
    return toRef(root);
  }

  const url = `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/root:/${encodePath(segments)}`;

  try {
    return toRef(await graphRequest(url, token));
  } catch (error) {
    if (statusOf(error) === 404) return null;
    throw error;
  }
}

// -------------------------------------------------------------------
// Create the folders in a path that do not exist yet, and return the leaf.
//
// THE PATH COMES FROM CONFIGURATION AND NEVER FROM A MODEL - see
// folder-path.ts, which validates it. This function trusts its caller to
// have done that, and the caller is the only place a fallback path is read.
//
// Segment by segment rather than in one call, because Graph has no
// "create this whole path" operation and because a partial failure should
// leave the folders it did manage rather than an ambiguous half-state.
//
// Two runs at once are safe: the loser of the race gets a 409 and re-reads
// the winner's folder.
// -------------------------------------------------------------------
export async function ensureFolderPath(
  userId: string,
  driveId: string,
  segments: readonly string[],
): Promise<DriveItemRef> {
  const token = await getDelegatedGraphToken(userId);

  let parent = await findFolderByPath(token, driveId, []);

  if (!parent) throw new Error("The drive has no root, so nothing can be filed into it.");

  const walked: string[] = [];

  for (const segment of segments) {
    walked.push(segment);

    const existing = await findFolderByPath(token, driveId, walked);

    if (existing) {
      parent = existing;
      continue;
    }

    try {
      const created = await graphRequest(
        `${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parent.itemId)}/children`,
        token,
        {
          method: "POST",
          contentType: "application/json",
          body: JSON.stringify({
            name: segment,
            folder: {},
            // Deliberate rather than default. "rename" would quietly create
            // "Unfiled 1" beside the folder somebody meant, and every later
            // run would find neither.
            "@microsoft.graph.conflictBehavior": "fail",
          }),
        },
      );

      const ref = toRef(created);
      if (!ref) throw new Error(`SharePoint did not return the folder it created for "${segment}".`);

      parent = ref;
    } catch (error) {
      // Somebody else created it between the lookup and the create - another
      // sweep, or a person. Their folder is the right answer.
      if (statusOf(error) === 409) {
        const raced = await findFolderByPath(token, driveId, walked);
        if (!raced) throw error;

        parent = raced;
        continue;
      }

      throw error;
    }
  }

  return parent;
}

// -------------------------------------------------------------------
// Upload a text file into a folder.
//
// Simple upload rather than an upload session: meeting notes are kilobytes,
// and a session is three round trips to move something smaller than the
// request that describes it.
//
// A 409 means a file of that name is already there. Returned rather than
// replaced - it is almost always this app's own earlier attempt, and on the
// rare occasion it is not, overwriting somebody's document to file a meeting
// note would be a far worse outcome than a duplicate name being reported.
// -------------------------------------------------------------------
export async function uploadTextFile(input: {
  userId: string;
  driveId: string;
  parentItemId: string;
  fileName: string;
  content: string;
  contentType?: string;
}): Promise<{ item: DriveItemRef; alreadyExisted: boolean }> {
  const token = await getDelegatedGraphToken(input.userId);

  const url =
    `${GRAPH_BASE}/drives/${encodeURIComponent(input.driveId)}` +
    `/items/${encodeURIComponent(input.parentItemId)}:/${encodeURIComponent(input.fileName)}:/content` +
    `?%40microsoft.graph.conflictBehavior=fail`;

  try {
    const created = await graphRequest(url, token, {
      method: "PUT",
      contentType: input.contentType ?? "text/markdown; charset=utf-8",
      body: input.content,
    });

    const ref = toRef(created);
    if (!ref) throw new Error("SharePoint did not return the file it created.");

    return { item: ref, alreadyExisted: false };
  } catch (error) {
    if (statusOf(error) !== 409) throw error;

    // Find what is already there, so the row records the real file rather
    // than a failure. If it cannot be found the conflict is not what it
    // looked like, and the original error is the honest thing to report.
    const existing = await graphRequest(
      `${GRAPH_BASE}/drives/${encodeURIComponent(input.driveId)}` +
        `/items/${encodeURIComponent(input.parentItemId)}:/${encodeURIComponent(input.fileName)}`,
      token,
    ).catch(() => null);

    const ref = toRef(existing);
    if (!ref) throw error;

    return { item: ref, alreadyExisted: true };
  }
}
