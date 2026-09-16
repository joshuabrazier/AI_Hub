import "server-only";

import { envServer } from "@/lib/env-server";
import type { TranscriptionSegment } from "@/lib/data/kysely-database-types";

// -------------------------------------------------------------------
// Azure AI Speech - batch transcription.
//
// WHY BATCH AND NOT REAL-TIME. A meeting is an hour of audio sitting in
// blob storage, not a live microphone stream. Batch takes a URL, works
// through it asynchronously and hands back a result minutes later, which
// is the shape this feature actually has. Real-time streaming would mean
// holding a socket open for the length of the meeting on a B1 instance.
//
// WHY NOT BEDROCK. Claude cannot hear. Opus 4.6's input modalities are
// text and images only - the model card lists audio as unsupported - so
// no amount of prompting turns it into a transcriber. Bedrock's part in
// this feature is summarising the transcript afterwards.
//
// HOW IT READS THE AUDIO. Two options exist: a SAS URL, or the "trusted
// Azure services" mechanism where the Speech resource's own managed
// identity is granted Storage Blob Data Reader. This uses the second.
// It means no SAS token is minted for the Speech leg at all, so there is
// no bearer credential to leak or expire - the authorisation is an Azure
// role assignment that can be revoked in one place. See docs/setup.md.
// -------------------------------------------------------------------

// The Speech REST API version this client is written against. Pinned
// rather than floating: response shapes have changed between versions,
// and the parsing below assumes this one.
const SPEECH_API_VERSION = "v3.2";

// -------------------------------------------------------------------
// The most voices the service will separate in one meeting.
//
// THIRTY-FIVE, AND THE API IS THE AUTHORITY ON THAT. This was briefly 36,
// taken from documentation describing diarization as supporting "up to 36
// speakers" - and Azure refused every single job with
// `400 InvalidRequest: properties.diarization.speakers.maxCount must be
// less than or equal to 35`. The prose and the validator disagree by one,
// the validator is the one that runs, and a number read from a document is
// a guess until a request has been accepted with it in.
//
// The value matters less than what happens PAST it: Azure does not refuse
// a busier meeting, it MERGES two people into one speaker label - so the
// transcript attributes one person's words to another, silently, and
// nobody reading it can tell. An extra label is a much smaller problem
// than a misattributed quote, which is why this sits at the ceiling rather
// than at a comfortable guess.
// -------------------------------------------------------------------
export const MAX_DIARIZED_SPEAKERS = 35;

export function isSpeechConfigured(): boolean {
  return Boolean(envServer.AZURE_SPEECH_KEY && envServer.AZURE_SPEECH_REGION);
}

function speechEndpoint(path: string): string {
  const region = envServer.AZURE_SPEECH_REGION;

  return `https://${region}.api.cognitive.microsoft.com/speechtotext/${SPEECH_API_VERSION}/${path}`;
}

// -------------------------------------------------------------------
// ===================================================================
// A FAILURE FROM THE SPEECH API, WITH ITS PARTS STILL SEPARATE
// ===================================================================
//
// Every non-2xx used to become one string - `Speech API 401: {"error"...}`
// - and the status code, which had been read a line earlier, was discarded
// into the middle of it. Two live paths were wrong in opposite directions
// as a result: a status poll swallowed EVERY failure and polled again
// forever, which is right for a 429 and leaves a row saying "Transcribing"
// for eternity when a Speech key is rotated; and a job creation failed the
// row on everything, which is right for a 400 and throws away a recording
// on a transient 503.
//
// Neither could be fixed without the status, so the status is kept.
//
// THE CODES ARE KEPT SEPARATE FROM THE PROSE for the same reason. Azure
// nests a machine-readable `error.code` and a more specific
// `error.innerError.code` inside the body; flattening them into a sentence
// means the only way to tell two faults apart afterwards is to match on
// English, which changes without warning and is not a contract.
// -------------------------------------------------------------------
export class SpeechApiError extends Error {
  readonly status: number;
  /** Azure's ErrorCode enum value, e.g. "InvalidRequest". */
  readonly code: string | null;
  /** Azure's more specific DetailedErrorCode, e.g. "InvalidRecordingsUri". */
  readonly innerCode: string | null;
  /** From the Retry-After header, which Azure documents on these endpoints. */
  readonly retryAfterSeconds: number | null;

  constructor(options: {
    status: number;
    code: string | null;
    innerCode: string | null;
    message: string;
    retryAfterSeconds: number | null;
  }) {
    super(options.message);
    this.name = "SpeechApiError";
    this.status = options.status;
    this.code = options.code;
    this.innerCode = options.innerCode;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  // -----------------------------------------------------------------
  // Whether asking again could plausibly end differently.
  //
  // A 401 or 403 is a key that has been rotated or a resource that has been
  // locked down, and it will answer identically in ten minutes and in ten
  // days. Polling through one is how a row sits on "Transcribing" until
  // somebody notices weeks later. A 429 or a 5xx is the opposite: the
  // service is busy or briefly unwell, and failing the row would throw away
  // a recording over something that fixes itself.
  // -----------------------------------------------------------------
  get isTransient(): boolean {
    return this.status === 408 || this.status === 429 || this.status >= 500 || this.status === 0;
  }

  /** One greppable fragment: the status and both codes, without the prose. */
  get summary(): string {
    return [`status=${this.status}`, this.code ? `code=${this.code}` : null, this.innerCode ? `inner=${this.innerCode}` : null]
      .filter(Boolean)
      .join(" ");
  }
}

// -------------------------------------------------------------------
// ===================================================================
// EVERY CALL IS BOUNDED, AND THE ONES WORTH REPEATING ARE REPEATED
// ===================================================================
//
// There was no timeout on any Speech call and no retry on any of them. Both
// halves cost something real.
//
// NO TIMEOUT means a fetch that never answers hangs the whole sweep behind
// it - and the sweep is sequential and oldest-first, so one wedged request
// stops every other transcription that person owns from advancing at all.
// The row just says "Transcribing" while nothing anywhere is transcribing.
//
// NO RETRY means a 429 fails whatever it was doing. Azure documents 429 on
// batch as a normal consequence of autoscaling rather than a fault, and
// documents Retry-After alongside it, so the service is asking to be asked
// again and this was treating the request as refused.
//
// RETRIED ONLY WHERE REPEATING IS SAFE AND CAN HELP. Every call this client
// makes is a GET except one - creating a job - and that one is deliberately
// excluded: a POST that timed out may well have created a job whose id came
// back on a response nobody read, and retrying it would leave a second job
// transcribing the same meeting at full price. A duplicate charge is worse
// than a failure somebody can retry by hand.
// -------------------------------------------------------------------

/** One call's ceiling. Generous - these are small JSON documents, not media. */
const SPEECH_REQUEST_TIMEOUT_MS = 20_000;

/** Attempts for a call that is safe to repeat. */
const SPEECH_ATTEMPTS = 3;

/** The floor when Azure asks for a wait but names no figure. */
const SPEECH_RETRY_BASE_MS = 1_000;

/** Never wait longer than this on one Retry-After, whatever Azure asks for. */
const SPEECH_MAX_RETRY_WAIT_MS = 10_000;

async function speechFetch(
  path: string,
  init?: RequestInit,
  // POSTs opt out. See the note above on why a retried job creation is
  // worse than a failed one.
  options: { retry?: boolean } = {},
): Promise<Response> {
  const key = envServer.AZURE_SPEECH_KEY;

  if (!key) throw new Error("AZURE_SPEECH_KEY is not set");

  const retry = options.retry ?? init?.method === undefined;

  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(speechEndpoint(path), {
        ...init,
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
        // Never cache a job status.
        cache: "no-store",
        // A request that never answers would otherwise hold the whole
        // sweep, which is sequential, behind it indefinitely.
        signal: AbortSignal.timeout(SPEECH_REQUEST_TIMEOUT_MS),
      });

      if (response.ok) return response;

      // The body carries the real reason - an unsupported codec, a blob the
      // service cannot reach - and without it the caller only sees a status
      // code, which is not enough to tell a user anything useful.
      const detail = await response.text().catch(() => "");

      const error = toSpeechApiError(response, detail);

      if (!retry || attempt >= SPEECH_ATTEMPTS || !error.isTransient) throw error;

      // Azure's own figure where it gave one, capped so a service asking
      // for five minutes does not become five minutes of somebody's page
      // load. Past the cap the next attempt will simply be refused again,
      // which is a faster and more honest answer than waiting.
      await delay(
        Math.min(
          error.retryAfterSeconds ? error.retryAfterSeconds * 1000 : SPEECH_RETRY_BASE_MS * attempt,
          SPEECH_MAX_RETRY_WAIT_MS,
        ),
      );
    } catch (error) {
      if (error instanceof SpeechApiError) throw error;

      // A timeout or a dropped connection. Named as status 0 so it travels
      // as the same shape as everything else and the caller has one type to
      // reason about rather than two.
      const wrapped = new SpeechApiError({
        status: 0,
        code: error instanceof Error ? error.name : null,
        innerCode: null,
        message:
          error instanceof Error && error.name === "TimeoutError"
            ? `The transcription service did not answer within ${SPEECH_REQUEST_TIMEOUT_MS / 1000} seconds.`
            : `The transcription service could not be reached: ${error instanceof Error ? error.message : String(error)}`,
        retryAfterSeconds: null,
      });

      if (!retry || attempt >= SPEECH_ATTEMPTS) throw wrapped;

      await delay(SPEECH_RETRY_BASE_MS * attempt);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -------------------------------------------------------------------
// The body is JSON when Azure's own API layer answers and plain text when
// the gateway in front of it does - and the gateway's version puts a
// NUMERIC STRING in `code`, so "401" and "InvalidRequest" both legitimately
// appear in the same field. Parsed leniently for that reason, and never
// allowed to throw: a malformed error body must not replace the error.
// -------------------------------------------------------------------
function toSpeechApiError(response: Response, body: string): SpeechApiError {
  let code: string | null = null;
  let innerCode: string | null = null;
  let message = body.slice(0, 400);

  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: string; message?: string; innerError?: { code?: string; message?: string } };
    };

    if (parsed.error) {
      code = parsed.error.code ?? null;
      innerCode = parsed.error.innerError?.code ?? null;
      message = parsed.error.message ?? parsed.error.innerError?.message ?? message;
    }
  } catch {
    // Not JSON. The text is the message, which is what it already is.
  }

  const retryAfter = Number(response.headers.get("Retry-After"));

  return new SpeechApiError({
    status: response.status,
    code,
    innerCode,
    message: `Speech API ${response.status}${code ? ` (${code})` : ""}: ${message}`,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  });
}

// -------------------------------------------------------------------
// Start a transcription of one blob.
//
// `contentUrl` is a plain blob URL with no SAS on it. That only works
// because the Speech resource's managed identity has been granted read
// access to the storage account; without that role assignment the
// service answers with a "cannot access" error rather than transcribing
// silence, which is at least a clear failure.
//
// Returns the job id to poll.
// -------------------------------------------------------------------
export async function startTranscription(options: {
  contentUrl: string;
  displayName: string;
  locale: string;
}): Promise<string> {
  // NOT RETRIED. A POST that timed out may have created a job whose id came
  // back on a response nobody read, and a second attempt would leave two
  // jobs transcribing the same meeting at full price.
  const response = await speechFetch(
    "transcriptions",
    {
      method: "POST",
      body: JSON.stringify({
        contentUrls: [options.contentUrl],
        locale: options.locale,
        displayName: options.displayName,
        properties: {
          // Speaker separation. The service tells voices apart and numbers
          // them; it has no idea who they are, so the UI says "Speaker 1".
          diarizationEnabled: true,
          diarization: {
            // -----------------------------------------------------------
            // THE CAP IS WHAT HAPPENS WHEN IT IS EXCEEDED, not the number.
            // Azure does not fail a meeting with more voices than this - it
            // merges two people into one label, silently, and the
            // transcript then attributes somebody's words to somebody else.
            // That is a worse outcome than a crowded transcript, and it is
            // invisible to whoever reads it.
            //
            // Set to the ceiling the API actually enforces - see the
            // constant, and the 400 that proved the documented figure was
            // one too high. The cost of a high cap is that a quiet
            // participant may get a label of their own; the cost of a low
            // one is a misattributed quote.
            // -----------------------------------------------------------
            speakers: { minCount: 1, maxCount: MAX_DIARIZED_SPEAKERS },
          },
          // Punctuation and capitalisation, without which an hour of
          // transcript is one unbroken sentence.
          punctuationMode: "DictatedAndAutomatic",
          // Leave profanity as spoken. This is a record of a meeting, and
          // masking words would make the transcript a less accurate one.
          profanityFilterMode: "None",
          wordLevelTimestampsEnabled: false,
        },
      }),
    },
    { retry: false },
  );

  const created = (await response.json()) as { self?: string };

  if (!created.self) throw new Error("Speech API did not return a job location");

  // `self` is the full URL of the created job; the id is its last segment.
  const jobId = created.self.split("/").filter(Boolean).pop();

  if (!jobId) throw new Error("Could not read a job id from the Speech API response");

  return jobId;
}

export type SpeechJobState = "Running" | "Succeeded" | "Failed" | "NotStarted";

/**
 * Why a job failed, with the machine-readable half kept separate from the
 * English half. Both are reported; only the codes are ever matched on.
 */
export type SpeechJobError = {
  code: string | null;
  message: string | null;
};

export type SpeechJobStatus = {
  state: SpeechJobState;
  error: SpeechJobError | null;
  /**
   * When the job ENTERED its current state, which Azure documents and which
   * is the authoritative version of the "how long has this been running"
   * question. The row's own updatedAt is a heuristic for the same thing and
   * has already lost meetings by drifting from it.
   */
  lastActionAt: Date | null;
};

// -------------------------------------------------------------------
// Where a job has got to.
// -------------------------------------------------------------------
export async function getTranscriptionStatus(jobId: string): Promise<SpeechJobStatus> {
  const response = await speechFetch(`transcriptions/${encodeURIComponent(jobId)}`);

  const job = (await response.json()) as {
    status?: SpeechJobState;
    lastActionDateTime?: string;
    properties?: { error?: { code?: string; message?: string } };
  };

  const failure = job.properties?.error;
  const lastAction = job.lastActionDateTime ? new Date(job.lastActionDateTime) : null;

  return {
    state: job.status ?? "Running",
    error: failure ? { code: failure.code ?? null, message: failure.message ?? null } : null,
    lastActionAt: lastAction && !Number.isNaN(lastAction.getTime()) ? lastAction : null,
  };
}

// -------------------------------------------------------------------
// One phrase as the Speech API reports it. Every field is optional because
// they genuinely are: a phrase the recogniser could make nothing of arrives
// with no nBest, and a recording it could not diarize arrives with no
// speaker.
// -------------------------------------------------------------------
export type RecognizedPhrase = {
  speaker?: number;
  offsetMilliseconds?: number;
  durationMilliseconds?: number;
  nBest?: { display?: string }[];
};

// -------------------------------------------------------------------
// Turn the service's phrases into speaker turns.
//
// The service emits ONE PHRASE AT A TIME - roughly a sentence - so an
// unmerged transcript is one line per sentence with the same speaker's name
// repeated down the page. Consecutive phrases from the same speaker are
// joined into a single turn, which is how somebody reading it expects a
// conversation to look.
//
// Exported and pure so it can be tested without a Speech resource: this is
// the only part of the response handling with any logic in it, and getting
// it wrong produces a transcript that is subtly wrong rather than one that
// obviously failed.
// -------------------------------------------------------------------
export function mergePhrasesIntoSegments(phrases: RecognizedPhrase[]): TranscriptionSegment[] {
  const segments: TranscriptionSegment[] = [];

  for (const phrase of phrases) {
    // nBest is ranked, so the first entry is the service's best guess.
    const text = phrase.nBest?.[0]?.display?.trim();

    // A phrase with no recognised text carries nothing, and keeping it
    // would break the merge below by splitting one turn into two.
    if (!text) continue;

    const speaker = phrase.speaker ?? null;
    const startMs = phrase.offsetMilliseconds ?? 0;
    const endMs = startMs + (phrase.durationMilliseconds ?? 0);

    const previous = segments[segments.length - 1];

    // Same speaker still talking - extend rather than start a new turn.
    if (previous && previous.speaker === speaker) {
      previous.text = `${previous.text} ${text}`;
      previous.endMs = endMs;
      continue;
    }

    segments.push({ speaker, startMs, endMs, text });
  }

  return segments;
}

// -------------------------------------------------------------------
// Render the turns as the plain text stored on the row and handed to the
// summariser.
//
// Speakers are named only where the service separated them. On a recording
// it could not, every line would read "Speaker null", which is worse than
// no labels at all.
// -------------------------------------------------------------------
export function segmentsToText(segments: TranscriptionSegment[]): string {
  return segments
    .map((segment) => (segment.speaker === null ? segment.text : `Speaker ${segment.speaker}: ${segment.text}`))
    .join("\n\n");
}

// -------------------------------------------------------------------
// ===================================================================
// WHAT AZURE ACTUALLY SAID ABOUT THE FILE
// ===================================================================
//
// The job-level error is the one somebody sees today, and it is too coarse
// to act on. "InvalidData: The recordings URI contains invalid data" is
// returned for at least three different faults that need three different
// fixes:
//
//   the blob could not be READ   a missing Storage Blob Data Reader role on
//                                the Speech resource, a firewall rule, or
//                                public network access turned off. contentUrl
//                                carries no SAS, so that role is the ONLY
//                                thing making the blob readable.
//   the bytes were not AUDIO     a truncated or headerless file.
//   the audio could not be DECODED  a codec the service does not accept.
//
// Told apart, one of those is an Azure configuration change, one is a
// re-upload and one is a re-encode. Collapsed into one sentence, every
// failure looks like "transcription is broken again" - which is exactly how
// it has been read.
//
// THE REPORT IS AZURE'S OWN PER-FILE LOG, and it comes through the same API
// this file already uses. A batch job produces a TranscriptionReport
// alongside the transcript, listing each source URL with its own status and
// error. No portal, no Log Analytics workspace, no diagnostic setting for
// somebody to remember to turn on - and it is fetched at the moment of
// failure, so the detail is attached to the row rather than sitting in a
// query nobody runs.
//
// THE COUNTS ARE WORTH AS MUCH AS THE DETAILS, and were being parsed and
// thrown away. A Failed job whose report says nothing failed is a JOB-level
// fault - a quota, a bad request, the service itself - rather than anything
// about the recording, and those two need opposite responses. Without the
// counts they are indistinguishable.
//
// `errorKind` IS NOT A DOCUMENTED ENUM. The report is a blob artifact
// rather than a REST response type, so it appears in no swagger and the
// published example shows none of its values. It is reported and logged as
// the service's own word, and anything matched on it is a guess about a
// string - which is why the classifier treats it as the weakest of its
// signals rather than as a contract.
//
// BEST EFFORT, ALWAYS. This runs while a job is already failing. If the
// report cannot be listed, downloaded or parsed, the caller keeps the
// job-level error it already had - a diagnostic that throws would turn a
// transcription failure into a transcription CRASH, which is strictly worse.
// -------------------------------------------------------------------
export type SpeechFailureReport = {
  /** Null when the report did not carry the count at all. */
  failedCount: number | null;
  successCount: number | null;
  failures: {
    /** The input blob URL. SAFE TO LOG, never to show: it names the storage account and container. */
    source: string | null;
    errorKind: string | null;
    errorMessage: string | null;
  }[];
};

export async function getTranscriptionFailureDetail(jobId: string): Promise<SpeechFailureReport | null> {
  try {
    const filesResponse = await speechFetch(`transcriptions/${encodeURIComponent(jobId)}/files`);

    const files = (await filesResponse.json()) as {
      values?: { kind?: string; links?: { contentUrl?: string } }[];
    };

    const reportUrl = files.values?.find((file) => file.kind === "TranscriptionReport")?.links
      ?.contentUrl;

    if (!reportUrl) return null;

    // Already signed by the service, like the transcript URL, which is why
    // it is fetched directly rather than through speechFetch.
    const response = await fetch(reportUrl, { cache: "no-store" });

    if (!response.ok) return null;

    const report = (await response.json()) as {
      successfulTranscriptionsCount?: number;
      failedTranscriptionsCount?: number;
      details?: { source?: string; status?: string; errorKind?: string; errorMessage?: string }[];
    };

    const failures = (report.details ?? []).filter((detail) => detail.status !== "Succeeded");

    return {
      failedCount: report.failedTranscriptionsCount ?? null,
      successCount: report.successfulTranscriptionsCount ?? null,
      // In practice there is exactly one, because every job this app creates
      // carries a single contentUrl - but the shape is a list and reading
      // only the first would quietly hide the rest if that ever changed.
      failures: failures.map((failure) => ({
        source: failure.source ?? null,
        errorKind: failure.errorKind ?? null,
        errorMessage: failure.errorMessage ?? null,
      })),
    };
  } catch (error) {
    // Deliberately swallowed. See the note above: the caller is already
    // reporting a failure and this is extra detail, not the answer.
    console.warn(`[speech] could not read the failure report for job ${jobId}`, error);

    return null;
  }
}

/**
 * The report as a sentence for the person waiting.
 *
 * The blob URL is deliberately NOT included: it names the storage account
 * and container, and this text is rendered on a screen.
 */
export function describeFailureReport(report: SpeechFailureReport | null): string | null {
  if (!report) return null;

  if (report.failures.length === 0) {
    // A failed job whose report blames no file. Worth saying plainly,
    // because it redirects the reader away from their recording.
    return report.failedCount === 0
      ? "The transcription service reported no problem with the file itself, so the job failed for a reason of its own rather than because of this recording."
      : null;
  }

  return report.failures
    .map((failure) => [failure.errorKind, failure.errorMessage].filter(Boolean).join(": "))
    .filter((line) => line.length > 0)
    .join(" | ");
}

// -------------------------------------------------------------------
// Fetch and flatten a finished transcript.
//
// The Speech API returns a list of result FILES rather than the text, so
// this is two hops: list the files, then fetch the transcription one. The
// file URL it hands back is already signed, which is why it is fetched
// directly rather than through speechFetch.
// -------------------------------------------------------------------
export async function getTranscriptionResult(jobId: string): Promise<{
  text: string;
  segments: TranscriptionSegment[];
  durationSeconds: number | null;
}> {
  const filesResponse = await speechFetch(`transcriptions/${encodeURIComponent(jobId)}/files`);

  const files = (await filesResponse.json()) as {
    values?: { kind?: string; links?: { contentUrl?: string } }[];
  };

  const resultUrl = files.values?.find((file) => file.kind === "Transcription")?.links?.contentUrl;

  if (!resultUrl) throw new Error("The finished job has no transcription file");

  const contentResponse = await fetch(resultUrl, { cache: "no-store" });

  if (!contentResponse.ok) {
    throw new Error(`Could not download the transcript (${contentResponse.status})`);
  }

  const result = (await contentResponse.json()) as {
    durationMilliseconds?: number;
    recognizedPhrases?: RecognizedPhrase[];
  };

  const segments = mergePhrasesIntoSegments(result.recognizedPhrases ?? []);

  return {
    text: segmentsToText(segments),
    segments,
    durationSeconds: result.durationMilliseconds ? Math.round(result.durationMilliseconds / 1000) : null,
  };
}

// -------------------------------------------------------------------
// Delete a finished job from the Speech service.
//
// Called once the result is safely in our database. The service keeps
// completed jobs for a while otherwise, which means a copy of the
// transcript sitting in a second place nobody is managing the retention
// of. Best-effort: failing to tidy up must not lose the transcript.
// -------------------------------------------------------------------
export async function deleteTranscriptionJob(jobId: string): Promise<void> {
  try {
    await speechFetch(`transcriptions/${encodeURIComponent(jobId)}`, { method: "DELETE" });
  } catch (error) {
    console.warn(`[speech] could not delete job ${jobId}`, error);
  }
}
