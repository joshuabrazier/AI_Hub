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

export function isSpeechConfigured(): boolean {
  return Boolean(envServer.AZURE_SPEECH_KEY && envServer.AZURE_SPEECH_REGION);
}

function speechEndpoint(path: string): string {
  const region = envServer.AZURE_SPEECH_REGION;

  return `https://${region}.api.cognitive.microsoft.com/speechtotext/${SPEECH_API_VERSION}/${path}`;
}

async function speechFetch(path: string, init?: RequestInit): Promise<Response> {
  const key = envServer.AZURE_SPEECH_KEY;

  if (!key) throw new Error("AZURE_SPEECH_KEY is not set");

  const response = await fetch(speechEndpoint(path), {
    ...init,
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    // Never cache a job status.
    cache: "no-store",
  });

  if (!response.ok) {
    // The body carries the real reason - an unsupported codec, a blob the
    // service cannot reach - and without it the caller only sees a status
    // code, which is not enough to tell a user anything useful.
    const detail = await response.text().catch(() => "");

    throw new Error(`Speech API ${response.status}: ${detail.slice(0, 500)}`);
  }

  return response;
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
  const response = await speechFetch("transcriptions", {
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
          speakers: { minCount: 1, maxCount: 10 },
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
  });

  const created = (await response.json()) as { self?: string };

  if (!created.self) throw new Error("Speech API did not return a job location");

  // `self` is the full URL of the created job; the id is its last segment.
  const jobId = created.self.split("/").filter(Boolean).pop();

  if (!jobId) throw new Error("Could not read a job id from the Speech API response");

  return jobId;
}

export type SpeechJobState = "Running" | "Succeeded" | "Failed" | "NotStarted";

export type SpeechJobStatus = {
  state: SpeechJobState;
  error: string | null;
};

// -------------------------------------------------------------------
// Where a job has got to.
// -------------------------------------------------------------------
export async function getTranscriptionStatus(jobId: string): Promise<SpeechJobStatus> {
  const response = await speechFetch(`transcriptions/${encodeURIComponent(jobId)}`);

  const job = (await response.json()) as {
    status?: SpeechJobState;
    properties?: { error?: { code?: string; message?: string } };
  };

  const failure = job.properties?.error;

  return {
    state: job.status ?? "Running",
    error: failure ? `${failure.code ?? "Error"}: ${failure.message ?? "unknown"}` : null,
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
// BEST EFFORT, ALWAYS. This runs while a job is already failing. If the
// report cannot be listed, downloaded or parsed, the caller keeps the
// job-level error it already had - a diagnostic that throws would turn a
// transcription failure into a transcription CRASH, which is strictly worse.
// -------------------------------------------------------------------
export async function getTranscriptionFailureDetail(jobId: string): Promise<string | null> {
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
      failedTranscriptionsCount?: number;
      details?: { status?: string; errorKind?: string; errorMessage?: string }[];
    };

    const failures = (report.details ?? []).filter((detail) => detail.status !== "Succeeded");

    if (failures.length === 0) return null;

    // One line per failed source. In practice there is exactly one, because
    // every job this app creates carries a single contentUrl - but the shape
    // is a list and reading only the first would quietly hide the rest if
    // that ever changed.
    return failures
      .map((failure) =>
        [failure.errorKind, failure.errorMessage].filter(Boolean).join(": "),
      )
      .filter((line) => line.length > 0)
      .join(" | ");
  } catch (error) {
    // Deliberately swallowed. See the note above: the caller is already
    // reporting a failure and this is extra detail, not the answer.
    console.warn(`[speech] could not read the failure report for job ${jobId}`, error);

    return null;
  }
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
