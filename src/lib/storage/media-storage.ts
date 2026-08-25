import "server-only";

import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  SASProtocol,
  StorageSharedKeyCredential,
  type ContainerClient,
} from "@azure/storage-blob";

import { envServer } from "@/lib/env-server";

// -------------------------------------------------------------------
// Media storage - meeting recordings and uploaded files.
//
// Separate from attachment-storage.ts because the two have opposite
// constraints, and merging them would force one compromise on both.
//
// A chat attachment is at most 4.5 MB and is proxied through the app so
// that the only way to read one is a live session that owns it. A meeting
// recording is hundreds of megabytes: proxying it would hold a B1
// instance's memory and connection for the length of the transfer, and an
// hour-long video would simply fail.
//
// SO THE UPLOAD USES A SAS URL, AND ONLY THE UPLOAD.
//
// It is a WRITE-ONLY SAS scoped to ONE blob that does not exist yet, valid
// for minutes. It cannot read anything, cannot list, and cannot touch
// another blob. The worst a leaked one does is let somebody overwrite a
// file whose exact name they already knew, inside a short window.
//
// NOTHING HANDS OUT A READ URL, and that asymmetry is the point. A
// recording CAN be downloaded, but it is streamed back through the app's
// own download route, never signed. An upload SAS is write-only, scoped to
// one blob that does not exist yet, and worthless without the exact name; a
// read URL would be a bearer token for the recording of a private meeting,
// working for anybody who came across it long after the session that
// produced it had gone.
// -------------------------------------------------------------------

// One blob per transcription, namespaced by owner. The owner prefix keeps
// the container legible when something has to be traced by hand, and means
// a future per-person purge has something to work from - the transcription
// rows themselves are gone by the time de-identification has finished.
export function mediaStorageKey(userId: string, transcriptionId: string): string {
  return `transcription/${userId}/${transcriptionId}`;
}

export function isMediaStorageConfigured(): boolean {
  return Boolean(envServer.AZURE_STORAGE_CONNECTION_STRING);
}

// -------------------------------------------------------------------
// Whether AZURE ITSELF can reach this storage account.
//
// Batch transcription is given a URL and the Speech service fetches the
// blob on its own, from its own network. That works for a real storage
// account and cannot work for the emulator: `http://127.0.0.1:10000` means
// "this machine" to whoever resolves it, and to Azure that is an Azure
// machine. The job fails with `InvalidUri: Error when downloading
// recordings`, which is accurate and explains nothing.
//
// Checked BEFORE anybody records, because the alternative is somebody
// sitting through a meeting and losing it to a failure that was knowable
// the whole time.
//
// Everything else about the feature works against the emulator - the
// recorder, the signed upload, the row, the states - so this is the only
// thing local development cannot do.
// -------------------------------------------------------------------
export function isMediaReachableByAzureServices(): boolean {
  const connectionString = envServer.AZURE_STORAGE_CONNECTION_STRING;

  if (!connectionString) return false;

  const endpoint = /BlobEndpoint=([^;]+)/i.exec(connectionString)?.[1];

  // No explicit endpoint means the SDK builds a real *.blob.core.windows.net
  // address from the account name, which Azure can always reach.
  if (!endpoint) return true;

  let host: string;

  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    // Unparseable. Not this function's job to reject it - the SDK will say
    // so far more clearly than a guess from here would.
    return true;
  }

  // Loopback and the docker-compose service name people give Azurite.
  if (host === "localhost" || host === "azurite" || host === "::1" || host.startsWith("127.")) return false;

  // RFC 1918. A storage account on a private network is reachable from the
  // office and not from Azure, which fails exactly the same way.
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) return false;

  return true;
}

// How long an upload URL is good for. Long enough for a slow phone on a
// poor connection to finish a large file, short enough that a leaked URL
// is close to worthless.
const UPLOAD_SAS_MINUTES = 60;

let cachedContainer: ContainerClient | null = null;

async function getContainer(): Promise<ContainerClient> {
  if (cachedContainer) return cachedContainer;

  const connectionString = envServer.AZURE_STORAGE_CONNECTION_STRING;

  if (!connectionString) throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set");

  const container = BlobServiceClient.fromConnectionString(connectionString).getContainerClient(
    envServer.AZURE_MEDIA_CONTAINER,
  );

  // Private. Anonymous read must never be enabled: the access check that
  // keeps one person's recordings from another lives in the service, and
  // a public container routes around it entirely.
  await container.createIfNotExists();

  cachedContainer = container;

  return container;
}

// -------------------------------------------------------------------
// The account credential, for signing SAS tokens.
//
// Parsed out of the connection string rather than configured separately,
// so there is one place to rotate. Throws loudly if the connection string
// is not the account-key form - a SAS cannot be signed without the key,
// and failing here is better than minting a token that does not work.
// -------------------------------------------------------------------
function getSharedKeyCredential(): StorageSharedKeyCredential {
  const connectionString = envServer.AZURE_STORAGE_CONNECTION_STRING ?? "";

  const accountName = /AccountName=([^;]+)/.exec(connectionString)?.[1];
  const accountKey = /AccountKey=([^;]+)/.exec(connectionString)?.[1];

  if (!accountName || !accountKey) {
    throw new Error(
      "AZURE_STORAGE_CONNECTION_STRING must contain AccountName and AccountKey to sign upload URLs",
    );
  }

  return new StorageSharedKeyCredential(accountName, accountKey);
}

// -------------------------------------------------------------------
// Which protocols the signed URL may be used over.
//
// HTTPS ONLY in any real environment - a SAS is a credential in a URL, and
// letting it travel in clear text would put it in every proxy log between
// the browser and Azure.
//
// The emulator is the exception and it has to be, because Azurite serves
// plain HTTP on localhost. A SAS restricted to https is REJECTED over an
// http endpoint with a 403 that says nothing useful, so pinning https
// unconditionally means local development simply cannot upload.
//
// Derived from the connection string rather than from a separate flag, so
// it cannot disagree with the account actually in use: a real account's
// string names an https endpoint and gets https, and only a string
// explicitly pointing at plain http relaxes it.
// -------------------------------------------------------------------
function sasProtocol(): SASProtocol {
  const connectionString = envServer.AZURE_STORAGE_CONNECTION_STRING ?? "";

  // BlobEndpoint wins when present - it is what the SDK actually connects
  // to, and an emulator string carries both.
  const endpoint = /BlobEndpoint=(https?):/i.exec(connectionString)?.[1]?.toLowerCase();

  const scheme = endpoint ?? /DefaultEndpointsProtocol=(https?);/i.exec(connectionString)?.[1]?.toLowerCase();

  return scheme === "http" ? SASProtocol.HttpsAndHttp : SASProtocol.Https;
}

function sasUrlFor(key: string, permissions: BlobSASPermissions, minutes: number): Promise<string> {
  return getContainer().then((container) => {
    const blob = container.getBlockBlobClient(key);

    const token = generateBlobSASQueryParameters(
      {
        containerName: container.containerName,
        blobName: key,
        permissions,
        // Backdated slightly so a small clock difference between this
        // server and Azure does not produce a token that is not yet valid.
        startsOn: new Date(Date.now() - 5 * 60 * 1000),
        expiresOn: new Date(Date.now() + minutes * 60 * 1000),
        protocol: sasProtocol(),
      },
      getSharedKeyCredential(),
    ).toString();

    return `${blob.url}?${token}`;
  });
}

// -------------------------------------------------------------------
// A URL the browser can PUT the media straight to.
//
// Write-only, one blob, one hour. The browser never receives a credential
// that can read anything - not this file, and not any other.
// -------------------------------------------------------------------
export async function createUploadUrl(key: string): Promise<string> {
  return sasUrlFor(key, BlobSASPermissions.parse("cw"), UPLOAD_SAS_MINUTES);
}

// -------------------------------------------------------------------
// The plain blob URL, with no token on it.
//
// This is what the Speech service is given. It can read it because its
// managed identity holds Storage Blob Data Reader on the account, not
// because the URL carries any authority of its own - so this string is
// useless to anybody else.
// -------------------------------------------------------------------
export async function mediaBlobUrl(key: string): Promise<string> {
  const container = await getContainer();

  return container.getBlockBlobClient(key).url;
}

// -------------------------------------------------------------------
// Whether the media actually arrived, and how big it is.
//
// The upload goes browser-to-blob and never touches this app, so the only
// way to know it finished is to ask storage. Called before a transcription
// job is created, so a failed upload becomes a clear error rather than a
// Speech job that silently transcribes nothing.
// -------------------------------------------------------------------
export async function getMediaInfo(key: string): Promise<{ exists: boolean; byteSize: number | null }> {
  const container = await getContainer();
  const blob = container.getBlockBlobClient(key);

  if (!(await blob.exists())) return { exists: false, byteSize: null };

  const properties = await blob.getProperties();

  return { exists: true, byteSize: properties.contentLength ?? null };
}

// -------------------------------------------------------------------
// Open a recording for reading, as a STREAM.
//
// Streamed rather than buffered, and that is not a detail: chat attachments
// are read into memory because they are at most 4.5 MB, whereas a meeting
// recording is hundreds. Reading one of those into a Buffer to hand to a
// Response would hold the whole file in the instance's memory for the
// length of the transfer, and two people downloading at once could take the
// process down.
//
// Null when the blob is gone - a row whose recording has aged out, or one
// transcribed before recordings were kept.
// -------------------------------------------------------------------
export async function openMediaStream(key: string): Promise<{
  stream: NodeJS.ReadableStream;
  byteSize: number | null;
  mediaType: string | null;
} | null> {
  const container = await getContainer();
  const blob = container.getBlockBlobClient(key);

  if (!(await blob.exists())) return null;

  const download = await blob.download();

  if (!download.readableStreamBody) return null;

  return {
    stream: download.readableStreamBody,
    byteSize: download.contentLength ?? null,
    mediaType: download.contentType ?? null,
  };
}

// -------------------------------------------------------------------
// Remove one recording. Idempotent - already gone is a success.
// -------------------------------------------------------------------
export async function deleteMedia(key: string): Promise<void> {
  const container = await getContainer();

  await container.getBlockBlobClient(key).deleteIfExists();
}

// -------------------------------------------------------------------
// Every key in the media container.
//
// For the reconciliation pass in the retention job: anything here that no
// row claims is orphaned. A Postgres cascade cannot reach storage, so
// de-identifying a user removes their transcription rows and leaves the
// recordings behind - this is what finds them.
// -------------------------------------------------------------------
export async function listAllMediaKeys(): Promise<string[]> {
  const container = await getContainer();

  const keys: string[] = [];

  for await (const blob of container.listBlobsFlat({ prefix: "transcription/" })) {
    keys.push(blob.name);
  }

  return keys;
}
