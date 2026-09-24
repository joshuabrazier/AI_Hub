import "server-only";

import { graphRequest } from "./graph-client";

// ===================================================================
// FINDING AND READING ONE PERSON'S SHAREPOINT FILES
//
// WHY THIS DOES NOT USE THE INVENTORY, WHICH IS THE IMPORTANT PART.
//
// This app already holds a catalogue of SharePoint: `sharepoint_item`, tens
// of thousands of rows of names, paths and sizes, indexed and sitting in
// the same database every other query runs against. Searching it would be
// one SQL statement and no network call, and it would be WRONG.
//
// The crawl runs as ONE ADMIN's delegated token, so the inventory describes
// what THAT PERSON can see. Nothing in it records what anybody else can
// see: `has_unique_permissions` is deliberately left NULL by the crawl
// because it was never confirmed that delta can return it, and the
// migration says in as many words that a wrong `false` there would read as
// "safe" when it is not. So the inventory cannot answer "may this person
// see this row", and it is not close.
//
// And the rows themselves are the disclosure. 012_sharepoint_inventory.sql
// puts it exactly right: "File paths and document names are themselves
// disclosive: 'Redundancy consultation - Jan.docx' tells you the thing
// without anybody opening it." A chat available to every signed-in user,
// searching a catalogue built from an admin's reach, is a way to read the
// TITLES of every restricted folder in the tenant without opening one.
//
// SO EVERY CALL HERE IS DELEGATED, and Graph does the deciding. A search
// run as the signed-in person returns the files that person can already
// open, and nothing else. This app makes no access-control decision about
// SharePoint content at all - which is the same arrangement the Teams
// transcript import runs on, and it is worth more than any check we could
// write.
//
// ONE CONSEQUENCE WORTH EXPECTING: two people asking the same question get
// different answers, and that is correct rather than a bug to reconcile.
// ===================================================================

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

// Graph's search endpoint caps `size` at 25 per page. Ten is plenty for a
// question in a chat - past that the model is reading page two of a search
// nobody scrolled, and every row costs context.
const MAX_HITS = 10;
const DEFAULT_HITS = 6;

export type SharepointFileHit = {
  /** The drive and item ids together are what `readSharepointFile` needs. */
  driveId: string;
  itemId: string;
  name: string;
  /** The containing folder, as Graph reports it. Null when Graph did not say. */
  folder: string | null;
  sizeBytes: number | null;
  modifiedAt: string | null;
  modifiedBy: string | null;
  /** For the model to cite, so somebody can open the real thing. */
  webUrl: string | null;
};

// -------------------------------------------------------------------
// Graph's search response is five levels of wrapper around the thing you
// want, and every level is optional in the schema. Read defensively: a
// shape change should return no hits, never throw inside a tool handler.
// -------------------------------------------------------------------
type SearchEnvelope = {
  value?: Array<{
    hitsContainers?: Array<{
      hits?: Array<{ resource?: Record<string, unknown> }>;
    }>;
  }>;
};

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Pull the fields worth having off one driveItem.
 *
 * Exported so the parsing can be tested against real Graph payload shapes
 * without a tenant, which is the half that actually breaks.
 */
export function readSearchHits(payload: unknown): SharepointFileHit[] {
  const containers = (payload as SearchEnvelope | null)?.value ?? [];
  const hits: SharepointFileHit[] = [];

  for (const entry of containers) {
    for (const container of entry.hitsContainers ?? []) {
      for (const hit of container.hits ?? []) {
        const resource = hit.resource;
        if (!resource) continue;

        const parent = resource.parentReference as Record<string, unknown> | undefined;
        const driveId = asText(parent?.driveId);
        const itemId = asText(resource.id);

        // Without both ids the file cannot be read afterwards, and a result
        // the model can name but not open invites it to promise a lookup it
        // will then fail. Dropped rather than listed.
        if (!driveId || !itemId) continue;

        // A folder is not a file. Graph's driveItem search returns both, and
        // offering a folder to a tool that downloads content is a guaranteed
        // failure two round trips later.
        if (resource.folder) continue;

        const editor = resource.lastModifiedBy as Record<string, unknown> | undefined;
        const editorUser = editor?.user as Record<string, unknown> | undefined;

        hits.push({
          driveId,
          itemId,
          name: asText(resource.name) ?? "Untitled",
          folder: asText(parent?.path)?.replace(/^\/drives\/[^/]+\/root:?/, "") || null,
          sizeBytes: typeof resource.size === "number" ? resource.size : null,
          modifiedAt: asText(resource.lastModifiedDateTime),
          modifiedBy: asText(editorUser?.displayName),
          webUrl: asText(resource.webUrl),
        });
      }
    }
  }

  return hits;
}

// -------------------------------------------------------------------
// Search the files this person can see.
//
// `POST /search/query` with entityTypes ["driveItem"] covers SharePoint and
// OneDrive together and needs no scope beyond the `Files.Read.All` /
// `Sites.Read.All` the inventory already asks for - so this costs no new
// tenant consent and no fresh sign-in, which for a feature people want this
// week is most of why it is shaped this way.
//
// The QUERY STRING IS THE MODEL'S, and that is safe here for a reason worth
// naming: it is a search term, not a filter expression and not a path. It
// selects among things the delegated token already reaches, so the widest
// outcome of a bad one is an unhelpful result set.
// -------------------------------------------------------------------
export async function searchSharepointFiles(
  accessToken: string,
  query: string,
  count?: number,
): Promise<SharepointFileHit[]> {
  const asked = Math.trunc(Number(count ?? DEFAULT_HITS));
  const size = Number.isFinite(asked) && asked > 0 ? Math.min(asked, MAX_HITS) : DEFAULT_HITS;

  const payload = await graphRequest(`${GRAPH_BASE_URL}/search/query`, accessToken, {
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify({
      requests: [
        {
          entityTypes: ["driveItem"],
          query: { queryString: query },
          from: 0,
          size,
          // Without this the response carries a trimmed resource and no
          // parentReference, so nothing could be read afterwards.
          fields: [
            "id",
            "name",
            "size",
            "webUrl",
            "lastModifiedDateTime",
            "lastModifiedBy",
            "parentReference",
            "folder",
          ],
        },
      ],
    }),
  });

  return readSearchHits(payload);
}

// -------------------------------------------------------------------
// Download one file's bytes.
//
// THE IDS COME FROM A SEARCH THE SAME PERSON JUST RAN, but nothing here
// relies on that - Graph re-checks the delegated token against this exact
// item, so an id guessed, remembered from another conversation or invented
// outright is refused by SharePoint rather than by us. That is the property
// that lets the model hold an id between tool calls without it becoming a
// capability.
//
// `read` keeps this inside graphRequest's throttle gate and retry ladder. A
// download is the heaviest call this app makes to Graph and therefore the
// likeliest to earn a 429 - going around the gate would mean the one caller
// most able to cause a throttle was the one not respecting it.
// -------------------------------------------------------------------
export async function downloadSharepointFile(
  accessToken: string,
  driveId: string,
  itemId: string,
): Promise<Buffer> {
  const url = `${GRAPH_BASE_URL}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`;

  const bytes = await graphRequest(url, accessToken, {
    // Graph answers a content request with a 302 to a pre-authenticated
    // storage URL. fetch follows it, and strips Authorization crossing
    // origins, which is what we want - our bearer token must not arrive at
    // a CDN host.
    read: async (response) => Buffer.from(await response.arrayBuffer()),
  });

  return bytes as Buffer;
}
