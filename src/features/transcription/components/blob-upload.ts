// -------------------------------------------------------------------
// Putting bytes into blob storage from the browser.
//
// Its own module because TWO paths need it: a first upload, and the
// re-encode that follows a file the transcription service could not read.
// A second copy of block assembly would be a second place for the block-id
// padding rule to be got wrong, and that rule fails only past ten blocks -
// which is to say only on the long recordings that matter most.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// ===================================================================
// SENDING THE BYTES IN BLOCKS
// ===================================================================
//
// This replaced a single `PUT Blob`, which Azure caps at 256 MiB. That
// ceiling was reached by a real meeting: a long workshop recorded at the
// browser's default bitrate came to over 300 MB, and the upload was rejected
// after running to completion. A recording that cannot be uploaded is the
// worst outcome this feature has, because the meeting is already over and
// cannot be recorded again.
//
// ALWAYS IN BLOCKS, EVEN FOR A SMALL FILE, and that is the important
// decision. A path used only by rare large uploads is a path that is never
// exercised - so the first time it runs is the day somebody is trying to
// save a five hour workshop, which is precisely when it must not be the
// first time. One path, every recording, exercised constantly. A 5 MB file
// costs one extra request for it.
//
// THE SAS ALREADY ALLOWS THIS. It is granted "cw" on one blob: Put Block and
// Put Block List both need `w`, so nothing about the credential changes and
// it is still write-only, still one blob, still an hour.
//
// BLOCK IDS MUST ALL BE THE SAME LENGTH before base64, which Azure requires
// and which is easy to get wrong the moment a file needs more than ten
// blocks. They are padded to six digits, so the scheme holds to 999,999
// blocks - far past the 50,000 Azure allows and the 1 GiB Speech accepts.
// -------------------------------------------------------------------

// Eight megabytes, which is a compromise rather than a tuned figure. Smaller
// blocks mean more round trips on a slow connection; larger ones mean more
// to redo when one fails. Azure's own tooling defaults to this region.
const BLOCK_BYTES = 8 * 1024 * 1024;

// -------------------------------------------------------------------
// ===================================================================
// ONE BAD BLOCK MUST NOT COST THE WHOLE MEETING
// ===================================================================
//
// Blocks made large uploads possible and made them more fragile in one
// respect: a file sent as forty requests has forty chances to meet a
// dropped connection, and the first version threw the whole transfer away
// on any of them. On a phone moving between wifi and mobile data - which is
// exactly what happens when somebody walks out of a meeting room - that is
// a lost recording, and the meeting is over and cannot be held again.
//
// RETRIED ONLY WHERE RETRYING CAN WORK. A dropped connection or a 500 from
// storage is worth trying again. A 403 is a SAS that has expired or a rule
// that forbids the write, and it will be a 403 in two seconds as well;
// retrying that only makes somebody wait three times as long for the same
// sentence.
//
// STAGED BLOCKS ARE WHAT MAKE THIS SAFE. Nothing is committed until Put
// Block List, so a block sent twice is a block overwritten rather than a
// block duplicated - the same id lands in the same place. There is no
// partial blob to clean up and no state on the server to reconcile.
//
// THE WATCHDOG IS SEPARATE FROM THE RETRY, and matters more than it looks.
// A stalled request is not a failed one: the socket is open, no error
// arrives, XMLHttpRequest waits indefinitely, and the page shows a bar that
// has simply stopped. That is indistinguishable from a slow upload right up
// until somebody gives up and reloads - which is how a recording is lost to
// a problem a second attempt would have cleared.
// -------------------------------------------------------------------

/** Three attempts: enough to ride out a handover between networks, short of a wait nobody understands. */
const BLOCK_ATTEMPTS = 3;

/** Doubling from a second, so a brief outage is absorbed without a long silent pause. */
const RETRY_BASE_MS = 1_000;

// -------------------------------------------------------------------
// How long one block may go with NO progress event before it is treated as
// stalled.
//
// Generous, because a genuinely slow connection still reports progress as
// each buffer drains - this looks for silence, not for slowness. A block
// making no measurable movement for a full minute is not a slow network.
// -------------------------------------------------------------------
const BLOCK_IDLE_MS = 60_000;

// -------------------------------------------------------------------
// How long a refreshed upload URL is assumed to last.
//
// Mirrors the server's signing window. Stated here rather than imported
// because media-storage.ts is server-only and importing it would pull the
// Azure SDK into this bundle - and because this is only ever used as a
// MARGIN, so being approximately right is the whole requirement. A refresh
// that turns out to be needed sooner is triggered by a 403 anyway.
// -------------------------------------------------------------------
const SAS_LIFETIME_GUESS_MS = 60 * 60 * 1000;

// -------------------------------------------------------------------
// And how long to wait for an ANSWER once the body has all gone.
//
// A separate, much longer ceiling, because the two silences mean opposite
// things. Silence while sending is a connection that has gone away. Silence
// afterwards is Azure working - committing a block list for a gigabyte of
// audio is real server-side work - and aborting that would throw away an
// upload that was seconds from succeeding.
// -------------------------------------------------------------------
const RESPONSE_CEILING_MS = 5 * 60_000;

export function blockIdFor(index: number): string {
  // Fixed width, so every id is the same length once encoded. Azure rejects
  // a block list whose ids differ in length.
  return btoa(String(index).padStart(6, "0"));
}

/**
 * An upload failure that knows what the server said, so the retry can judge
 * it. A plain Error would leave every failure looking the same, and the
 * difference between "the connection dropped" and "your credential expired"
 * is the difference between retrying and stopping.
 */
export class UploadRequestError extends Error {
  /** 0 means no response at all: dropped, blocked by CORS, or stalled out. */
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "UploadRequestError";
    this.status = status;
  }
}

// -------------------------------------------------------------------
// Whether sending the same request again could plausibly end differently.
//
// THE DEFAULT IS NOT TO RETRY, which is the opposite of the usual instinct
// and is right here because of what the statuses mean. Azure answers a
// block write with 201 or with a reason, and every reason it gives that is
// not listed below is about THIS REQUEST - the credential, the URL, the
// headers - and is identical the second time. A retry there is not a second
// chance, it is the same failure delivered three times more slowly, on top
// of an upload somebody is already waiting on.
//
// The listed ones are the faults that are about the moment rather than the
// request: no answer at all, a timeout, throttling, or Azure itself
// erroring.
// -------------------------------------------------------------------
export function isWorthRetrying(error: unknown): boolean {
  if (!(error instanceof UploadRequestError)) return false;

  // No response: dropped, blocked, or given up on by the watchdog.
  if (error.status === 0) return true;

  // Azure's own throttling, and its server-side faults.
  if (error.status === 408 || error.status === 429 || error.status >= 500) return true;

  // 403 is an expired or insufficient SAS, 400 a malformed request, 404 a
  // container that is not there. None of them changes by being asked twice.
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One request, with progress. XMLHttpRequest rather than fetch for the same
 * reason the rest of this feature uses it: fetch cannot report upload
 * progress, and somebody watching a long upload with no sign of movement
 * reloads the page and loses the recording.
 */
function putWithProgress(
  url: string,
  body: Blob | string,
  headers: Record<string, string>,
  onProgress: (loaded: number) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Reset by every progress event and by the response itself. Cleared on
    // all three endings, so a finished request cannot be aborted later by
    // its own watchdog.
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let stalled = false;

    const clearIdle = () => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
    };

    const armIdle = (ms: number) => {
      clearIdle();

      idleTimer = setTimeout(() => {
        // Marked BEFORE aborting, because abort() fires the abort handler
        // below and that has to know which of the two this was: a stall
        // worth retrying, or somebody leaving the page.
        stalled = true;
        xhr.abort();
      }, ms);
    };

    xhr.open("PUT", url, true);

    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);

    xhr.upload.addEventListener("progress", (event) => {
      armIdle(BLOCK_IDLE_MS);

      if (event.lengthComputable) onProgress(event.loaded);
    });

    // The body has all been sent, so there is nothing left to be idle
    // ABOUT - from here the wait is on Azure, and it gets the long ceiling.
    // Without this swap the commit of a large block list would be aborted
    // by a watchdog written for a dead connection.
    xhr.upload.addEventListener("loadend", () => armIdle(RESPONSE_CEILING_MS));

    xhr.addEventListener("load", () => {
      clearIdle();

      // 201 for both Put Block and Put Block List. Anything else is a
      // failure, including a 403 from a SAS that expired mid-upload - which
      // is what a transfer slower than the signed window looks like.
      if (xhr.status === 201) resolve();
      else reject(new UploadRequestError(`The upload was rejected (${xhr.status}).`, xhr.status));
    });

    // Status 0 with an error event is a BLOCKED CROSS-ORIGIN request. The
    // browser will not say why - that is the point of the same-origin policy
    // - so there is no status and nothing to distinguish it from the network
    // being down. Named anyway, because the two fixes are different and only
    // one of them is the reader's to make.
    xhr.addEventListener("error", () => {
      clearIdle();

      reject(
        new UploadRequestError(
          "The upload could not reach storage. Check your connection - and if this keeps happening, storage may not be configured to accept uploads from this site.",
          0,
        ),
      );
    });

    xhr.addEventListener("abort", () => {
      clearIdle();

      reject(
        stalled
          ? new UploadRequestError(
              "The upload stopped responding and is being retried.",
              // Status 0, so isWorthRetrying picks it up. A stall is the
              // case this watchdog exists for and must not be terminal.
              0,
            )
          : // Not ours, so not retryable: the page is going away.
            new Error("The upload was cancelled."),
      );
    });

    armIdle(BLOCK_IDLE_MS);

    xhr.send(body);
  });
}

/**
 * The same request, tried again where trying again can help.
 *
 * `onProgress` can go BACKWARDS across an attempt - a retried block starts
 * from zero bytes - which is why the caller clamps the percentage it shows
 * rather than passing this through to a bar.
 */
async function putWithRetry(
  url: string,
  body: Blob | string,
  headers: Record<string, string>,
  onProgress: (loaded: number) => void,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await putWithProgress(url, body, headers, onProgress);

      return;
    } catch (error) {
      if (attempt >= BLOCK_ATTEMPTS || !isWorthRetrying(error)) throw error;

      // Logged rather than shown. A retry that works is not something to
      // interrupt somebody about, and one that does not ends in a message
      // of its own - but a connection that needs two attempts every time is
      // worth being able to see afterwards.
      console.warn(`[upload] attempt ${attempt} failed, retrying`, error);

      await delay(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
}

/**
 * Where a fresh upload URL comes from when the signed one is running out.
 *
 * Optional, because one caller cannot offer it: the re-encode path writes
 * to a key the row does not claim yet, so there is no row for a refresh to
 * be authorised against. That upload is also the smaller one - a converted
 * file, on a connection that has already carried the original - so an hour
 * is a far safer window for it than for a first upload.
 */
export type UploadUrlSource = () => Promise<string | null>;

// -------------------------------------------------------------------
// How close to expiry is too close to start another block.
//
// Five minutes, because the question is not "is the credential still
// valid" but "will it still be valid when this block FINISHES". An eight
// megabyte block on a poor connection is minutes of transfer, and a URL
// that expires half way through one wastes the whole block.
// -------------------------------------------------------------------
const SAS_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Send `media` to `uploadUrl` as blocks, then commit them.
 *
 * `onProgress` receives 0-100 across the WHOLE file rather than per block,
 * because a bar that restarts every eight megabytes tells somebody nothing
 * about how long is left.
 */
export async function uploadInBlocks(
  uploadUrl: string,
  media: Blob,
  mediaType: string,
  onProgress: (percent: number) => void,
  // -----------------------------------------------------------------
  // KEEPING A LONG UPLOAD ALIVE. The SAS lasts an hour; a large recording
  // on a client site's broadband does not fit in one. Without these the
  // transfer met a 403 part way through a meeting that cannot be
  // re-recorded, and threw the whole thing away.
  //
  // RESUMING COSTS NOTHING, which is what makes it worth doing rather than
  // merely possible: blocks are STAGED, Azure holds them for seven days,
  // and the blob does not exist until the commit. So a refreshed URL
  // carries on from the block that failed and everything already sent is
  // still there.
  // -----------------------------------------------------------------
  options: { expiresAt?: Date; refreshUrl?: UploadUrlSource } = {},
): Promise<void> {
  const blockIds: string[] = [];
  let completedBytes = 0;
  // A bar that goes backwards reads as the upload having lost work, which a
  // retried block has not - the block is simply being sent again. Held at
  // its high-water mark so a retry looks like a pause rather than a loss.
  let shownPercent = 0;

  let currentUrl = uploadUrl;
  let expiresAt = options.expiresAt ?? null;

  // Re-signs and swaps the URL in, or leaves things as they are when no
  // source was given. Never throws: a refresh that fails leaves the
  // existing credential to be tried, which may still work.
  const refresh = async (): Promise<boolean> => {
    if (!options.refreshUrl) return false;

    try {
      const fresh = await options.refreshUrl();

      if (!fresh) return false;

      currentUrl = fresh;
      // The server signs for the same window every time, so the new expiry
      // is simply now plus that window. Kept approximate deliberately - it
      // is a margin, not a deadline.
      expiresAt = new Date(Date.now() + SAS_LIFETIME_GUESS_MS);

      return true;
    } catch (error) {
      console.warn("[upload] could not refresh the upload URL", error);

      return false;
    }
  };

  for (let start = 0, index = 0; start < media.size; start += BLOCK_BYTES, index += 1) {
    const block = media.slice(start, Math.min(start + BLOCK_BYTES, media.size));
    const blockId = blockIdFor(index);

    blockIds.push(blockId);

    // Refreshed BEFORE the block rather than after a failure, because a
    // block that dies on an expired credential is eight megabytes of
    // somebody's upload spent for nothing.
    if (expiresAt && expiresAt.getTime() - Date.now() < SAS_REFRESH_MARGIN_MS) await refresh();

    try {
      await sendBlock(currentUrl, blockId, block, media.size, completedBytes, (percent) => {
        shownPercent = Math.max(shownPercent, percent);
        onProgress(shownPercent);
      });
    } catch (error) {
      // A 403 here is an expired or revoked credential. It is not retried
      // by putWithRetry - correctly, because the same URL will be refused
      // again - but a DIFFERENT URL is a different question, so this is the
      // one place a 403 gets a second chance.
      const expired = error instanceof UploadRequestError && error.status === 403;

      if (!expired || !(await refresh())) throw error;

      await sendBlock(currentUrl, blockId, block, media.size, completedBytes, (percent) => {
        shownPercent = Math.max(shownPercent, percent);
        onProgress(shownPercent);
      });
    }

    completedBytes += block.size;
  }

  // -----------------------------------------------------------------
  // COMMIT. Until this lands the blocks are staged and the blob does not
  // exist - which is the property that makes a failed upload leave nothing
  // behind rather than a half file. Azure discards uncommitted blocks on its
  // own after a week.
  //
  // The blob's content type is set HERE and not on the blocks, because the
  // blocks have no type of their own: the committed blob takes what this
  // request gives it.
  // -----------------------------------------------------------------
  const blockList =
    `<?xml version="1.0" encoding="utf-8"?><BlockList>` +
    blockIds.map((id) => `<Latest>${id}</Latest>`).join("") +
    `</BlockList>`;

  const commit = (url: string) =>
    putWithRetry(
      `${url}&comp=blocklist`,
      blockList,
      {
        "Content-Type": "application/xml",
        // The type the SERVER derived from the filename, not one the browser
        // guessed. Nothing serves these bytes back to a browser, so this is
        // for tidiness in the container rather than for safety - but there is
        // no reason to write a guess when the server has already decided.
        "x-ms-blob-content-type": mediaType,
      },
      () => {},
    );

  try {
    await commit(currentUrl);
  } catch (error) {
    // The worst possible moment to lose the credential: every block is
    // already in Azure and only the commit is left.
    const expired = error instanceof UploadRequestError && error.status === 403;

    if (!expired || !(await refresh())) throw error;

    await commit(currentUrl);
  }

  onProgress(100);
}

/** One block, with progress reported across the whole file rather than the block. */
function sendBlock(
  url: string,
  blockId: string,
  block: Blob,
  totalBytes: number,
  completedBytes: number,
  onPercent: (percent: number) => void,
): Promise<void> {
  // The SAS URL already carries a query string, so every extra parameter
  // is appended with & rather than ?.
  return putWithRetry(
    `${url}&comp=block&blockid=${encodeURIComponent(blockId)}`,
    block,
    {},
    (loaded) => onPercent(Math.min(99, Math.round(((completedBytes + loaded) / totalBytes) * 100))),
  );
}
