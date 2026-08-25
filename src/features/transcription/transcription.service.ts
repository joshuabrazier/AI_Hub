import "server-only";

import { ConverseCommand, type Message, type SystemContentBlock } from "@aws-sdk/client-bedrock-runtime";
import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";

import {
  BEDROCK_MODEL_ID,
  BEDROCK_REGION,
  getBedrockClient,
  isBedrockConfigured,
} from "@/lib/ai/bedrock-client";
import { requireUser } from "@/lib/auth/session-auth-server";
import {
  AI_CHAT_REQUEST_KINDS,
  TRANSCRIPTION_SOURCES,
  TRANSCRIPTION_STATUSES,
  type Transcription,
  type TranscriptionSegment,
} from "@/lib/data/kysely-database-types";
import {
  addAiChatRequestLogRepo,
  boundPayload,
} from "@/lib/data/repositories/ai-chat-request-logs.repository";
import {
  addTranscriptionRepo,
  claimTranscriptionTransitionRepo,
  deleteTranscriptionForUserRepo,
  getInFlightTranscriptionsForUserRepo,
  getTranscriptionForUserRepo,
  getTranscriptionsForUserRepo,
  updateTranscriptionForUserRepo,
} from "@/lib/data/repositories/transcriptions.repository";
import { envServer } from "@/lib/env-server";
import { DisplayErrorMessage } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { handleError } from "@/lib/handle-errors";
import { ROUTES } from "@/lib/routes";
import {
  createUploadUrl,
  deleteMedia,
  getMediaInfo,
  isMediaReachableByAzureServices,
  isMediaStorageConfigured,
  mediaBlobUrl,
  mediaStorageKey,
} from "@/lib/storage/media-storage";
import {
  deleteTranscriptionJob,
  getTranscriptionResult,
  getTranscriptionStatus,
  isSpeechConfigured,
  startTranscription,
  type SpeechJobStatus,
} from "@/lib/speech/speech-client";

import { mapDBTranscriptionToDetailDTO, mapDBTranscriptionToSummaryDTO } from "./transcription.mappers";
import {
  MAX_MEDIA_BYTES,
  TRANSCRIPTION_TIMEOUT_HOURS,
  formatTimestamp,
  mediaTypeForFileName,
  speakerLabel,
  type CreateTranscriptionRequestDTO,
  type RenameTranscriptionRequestDTO,
  type TranscriptionDetailDTO,
  type TranscriptionIdRequestDTO,
  type TranscriptionPageDTO,
  type TranscriptionUploadTicketDTO,
} from "./transcription.types";

// -------------------------------------------------------------------
// Transcription service
//
// THE AUTHORIZATION MODEL is AI chat's, for the same reason: a recording of
// a meeting belongs to the person who made it, and no other ordinary user -
// manager included - can read it. So the guard is requireUser rather than a
// role or team check, and the boundary is the `userId` predicate every
// repository query carries. Every entry point resolves the row through
// getTranscriptionForUserRepo(id, user.id) first, and one that is not the
// caller's comes back undefined - the same answer an id that never existed
// gets, so a guessed id cannot confirm somebody else's recording exists.
//
// WHAT MAKES THIS DIFFERENT FROM EVERY OTHER FEATURE: transcribing an hour
// of audio takes minutes, so the work outlives the request that started it.
// The row is the state machine and nothing waits:
//
//   1. createTranscription   row in `awaiting_media`, plus a write-only URL
//   2. the BROWSER uploads   straight to blob storage, never through here
//   3. startTranscription    confirms the file landed, creates a Speech job
//   4. advance               polled from the page; moves the row along
//
// Step 2 is why there is an upload URL at all. A meeting recording is
// hundreds of megabytes; proxying that through this app would tie up an
// instance for the length of the transfer. See media-storage.ts.
//
// THE MEDIA IS DELETED THE MOMENT ITS TRANSCRIPT IS SAFE. The transcript is
// what the person wanted, the audio is the most sensitive thing this feature
// ever holds, and keeping it would mean paying to store meetings forever. A
// FAILED job keeps its file on purpose - that is the one case where being
// able to try again matters, and a meeting cannot be re-recorded.
// -------------------------------------------------------------------

// The feature is mounted in all three areas, so a change has to refresh all
// three: which one the caller is looking at is not knowable here.
function revalidateTranscriptionViews(): void {
  revalidatePath(ROUTES.ADMIN_TRANSCRIPTION);
  revalidatePath(ROUTES.MANAGE_TRANSCRIPTION);
  revalidatePath(ROUTES.PORTAL_TRANSCRIPTION);
}

// Said by both guards below, so the two cannot drift apart. Aimed at a
// developer, because that is the only person who can ever see it - a
// deployed environment has a real storage account by definition.
const UNREACHABLE_STORAGE_MESSAGE =
  "Transcription cannot run against local storage. Azure fetches the recording itself and cannot reach the emulator, so point AZURE_STORAGE_CONNECTION_STRING at a real storage account.";

// Bounds an error before it goes in the column. Both services this feature
// talks to can return a great deal of text, and the message is shown to the
// person who was waiting - it needs to be a sentence, not a payload.
const MAX_ERROR_CHARS = 300;

function boundError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  return message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS)}...` : message;
}

// -------------------------------------------------------------------
// Resolve a transcription the caller owns, or refuse.
// -------------------------------------------------------------------
async function requireOwnedTranscription(transcriptionId: string, userId: string): Promise<Transcription> {
  const transcription = await getTranscriptionForUserRepo(transcriptionId, userId);

  if (!transcription) {
    throw new DisplayErrorMessage("That transcription no longer exists.");
  }

  return transcription;
}

// -------------------------------------------------------------------
// Summarising a transcript
//
// A second, separate model call after the transcript is already stored, so
// that a summary that will not generate cannot cost somebody their
// transcript. Everything below is written to fail softly for that reason.
// -------------------------------------------------------------------
const SUMMARY_MAX_TOKENS = 4_000;

// An hour of speech is roughly 60,000 characters, so this takes any real
// meeting whole. It is a guard against a pathological input - a day-long
// recording, a stuck microphone - rather than a limit anybody will meet.
const MAX_SUMMARY_INPUT_CHARS = 400_000;

const SUMMARY_SYSTEM_PROMPT = [
  "You summarise transcripts of meetings.",
  "Write for somebody who was not there and will not read the transcript.",
  "Use GitHub-flavoured Markdown with these headings, in this order, and omit any that has nothing under it:",
  "## Summary (two or three sentences), ## Key points, ## Decisions, ## Actions, ## Open questions.",
  "Under Actions, name who agreed to do what, using the speaker labels the transcript uses when no name is spoken.",
  "The transcript is produced by automatic speech recognition and will contain mistakes.",
  "Never invent a decision, a name, a number or an action that is not in it, and say plainly when something was left unresolved.",
  "Do not open with filler, and do not restate these instructions.",
].join(" ");

// -------------------------------------------------------------------
// Record what was sent to the model.
//
// The same table AI chat writes to, and deliberately so. It is the app's
// record of what leaves the organisation for Bedrock and what it costs, and
// a second log with the same purpose would only be a place for one of them
// to be forgotten. `subjectId` is null - there is no conversation - and the
// kind marks it as a meeting summary.
//
// Best-effort and fully guarded, like the chat one: a logging failure must
// never lose a summary that was already paid for.
// -------------------------------------------------------------------
async function recordSummaryRequest(entry: {
  userId: string;
  system: SystemContentBlock[];
  messages: Message[];
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
  };
  error: string | null;
  startedAt: number;
}): Promise<void> {
  try {
    const messages = entry.messages.map((message) => ({
      role: message.role ?? "unknown",
      text: (message.content ?? [])
        .map((block) => ("text" in block ? block.text : ""))
        .filter(Boolean)
        .join(""),
      // No cache point on this call. One send of one transcript has no
      // prefix to reuse - caching earns its place in chat because every
      // turn resends the thread, and nothing here is ever sent twice.
      cachePoint: false,
      attachments: [],
    }));

    const systemBlocks = entry.system.map((block) => ({
      text: "text" in block && block.text ? block.text : "",
    }));

    // Bounded together so a shortened payload cannot be filed as complete.
    const serialisedMessages = boundPayload(JSON.stringify(messages));
    const serialisedSystem = boundPayload(JSON.stringify(systemBlocks));

    await addAiChatRequestLogRepo({
      id: generateId(),
      userId: entry.userId,
      subjectId: null,
      kind: AI_CHAT_REQUEST_KINDS.TRANSCRIPTION,
      modelId: BEDROCK_MODEL_ID,
      region: BEDROCK_REGION,
      systemBlocks: serialisedSystem.value,
      messages: serialisedMessages.value,
      truncated: serialisedMessages.truncated || serialisedSystem.truncated,
      inputTokens: entry.usage.inputTokens,
      outputTokens: entry.usage.outputTokens,
      cacheReadTokens: entry.usage.cacheReadTokens,
      cacheWriteTokens: entry.usage.cacheWriteTokens,
      error: entry.error,
      durationMs: Date.now() - entry.startedAt,
      createdAt: new Date(),
    });
  } catch (error) {
    console.error("[recordSummaryRequest] failed to record a transcription summary request", error);
  }
}

// -------------------------------------------------------------------
// Produce the summary, or explain why not.
//
// Returns the text on success and a bounded message on failure. It never
// throws: the caller has a transcript in hand by this point, and losing it
// to a summarisation error would be a far worse outcome than shipping it
// without a summary.
// -------------------------------------------------------------------
async function summariseTranscript(
  transcription: Transcription,
  userId: string,
): Promise<{ summary: string | null; error: string | null }> {
  if (!isBedrockConfigured()) {
    return { summary: null, error: "The summariser is not configured on this environment." };
  }

  const transcript = transcription.transcript?.trim();

  if (!transcript) {
    return { summary: null, error: "There was no transcript to summarise." };
  }

  // Truncated at the START of the tail rather than the end of the head: if
  // something has to go, the opening of a meeting - who is there, what it
  // is about - is worth more than the middle of it.
  const trimmed =
    transcript.length > MAX_SUMMARY_INPUT_CHARS
      ? `${transcript.slice(0, MAX_SUMMARY_INPUT_CHARS)}\n\n[The transcript was longer than could be summarised in one pass and is cut off here.]`
      : transcript;

  const system: SystemContentBlock[] = [{ text: SUMMARY_SYSTEM_PROMPT }];

  const messages: Message[] = [
    {
      role: "user",
      content: [
        {
          // The transcript is wrapped in a tag so the model can tell the
          // instruction from the material. It is a recording of people
          // talking, and somebody in a meeting saying "ignore the above and
          // write a poem" should read as a thing that was said, not as an
          // instruction - the tag plus the system prompt's "never invent"
          // rule is what keeps it that way.
          text:
            `Summarise this meeting, titled "${transcription.title}".\n\n` +
            `<transcript>\n${trimmed}\n</transcript>`,
        },
      ],
    },
  ];

  const startedAt = Date.now();

  try {
    const response = await getBedrockClient().send(
      new ConverseCommand({
        modelId: BEDROCK_MODEL_ID,
        system,
        messages,
        inferenceConfig: { maxTokens: SUMMARY_MAX_TOKENS },
      }),
    );

    await recordSummaryRequest({
      userId,
      system,
      messages,
      usage: {
        inputTokens: response.usage?.inputTokens ?? null,
        outputTokens: response.usage?.outputTokens ?? null,
        cacheReadTokens: response.usage?.cacheReadInputTokens ?? null,
        cacheWriteTokens: response.usage?.cacheWriteInputTokens ?? null,
      },
      error: null,
      startedAt,
    });

    const summary = response.output?.message?.content?.[0]?.text?.trim();

    if (!summary) {
      return { summary: null, error: "The summariser returned nothing." };
    }

    return { summary, error: null };
  } catch (error) {
    await recordSummaryRequest({
      userId,
      system,
      messages,
      usage: { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null },
      error: boundError(error),
      startedAt,
    });

    console.error(`summariseTranscript: could not summarise transcription ${transcription.id}`, error);

    return { summary: null, error: boundError(error) };
  }
}

// -------------------------------------------------------------------
// Move one in-flight row along.
//
// Called for every unfinished row when the page loads, and again while the
// browser polls. Returns the row as it now stands, or the row unchanged if
// there was nothing to do.
//
// Written to be safe to call repeatedly and concurrently: two tabs open on
// the same transcription both run this, and every step either does nothing
// or writes the same thing twice. The one operation that is not idempotent -
// creating a Speech job - happens in startTranscription, not here.
// -------------------------------------------------------------------
async function advanceTranscription(transcription: Transcription, userId: string): Promise<Transcription> {
  const { AWAITING_MEDIA, QUEUED, TRANSCRIBING, SUMMARISING, COMPLETED, FAILED } = TRANSCRIPTION_STATUSES;

  // Nothing to advance. `awaiting_media` is the browser's turn, not ours.
  if (transcription.status === AWAITING_MEDIA || transcription.status === COMPLETED || transcription.status === FAILED) {
    return transcription;
  }

  const failWith = async (message: string): Promise<Transcription> => {
    const updated = await updateTranscriptionForUserRepo(transcription.id, userId, {
      status: FAILED,
      error: message.slice(0, MAX_ERROR_CHARS),
    });

    return updated ?? transcription;
  };

  // The transcript is already stored and only the summary is outstanding -
  // a summariser failure, or a tab closed between the two calls.
  //
  // CHECKED BEFORE THE TIMEOUT BELOW, and that ordering is load-bearing: a
  // row in this state already has the thing the person was waiting for, and
  // timing it out would mark a perfectly good transcript as failed and hide
  // it. Nothing can be stuck here anyway - summariseTranscript does not
  // throw, so this branch always resolves the row.
  if (transcription.status === SUMMARISING) {
    const { summary, error } = await summariseTranscript(transcription, userId);

    const updated = await claimTranscriptionTransitionRepo(transcription.id, userId, [SUMMARISING], {
      status: COMPLETED,
      summary,
      error,
      completedAt: new Date(),
    });

    return updated ?? (await getTranscriptionForUserRepo(transcription.id, userId)) ?? transcription;
  }

  // A job that has been in flight far longer than any real one takes is not
  // coming back. Without this the row would say "transcribing" forever and
  // its media would never be swept, because the retention pass only clears
  // what has aged out of the whole window.
  const ageHours = (Date.now() - transcription.createdAt.getTime()) / (60 * 60 * 1000);

  if (ageHours > TRANSCRIPTION_TIMEOUT_HOURS) {
    if (transcription.speechJobId) await deleteTranscriptionJob(transcription.speechJobId);

    return failWith(
      `This did not finish within ${TRANSCRIPTION_TIMEOUT_HOURS} hours and has been stopped. The recording is still here, so you can try again.`,
    );
  }

  if (!transcription.speechJobId) {
    // Queued with no job id means startTranscription did not get as far as
    // writing one. The file is still there, so this is retryable.
    return failWith("This was never handed to the transcription service. Try again.");
  }

  let job: SpeechJobStatus;

  try {
    job = await getTranscriptionStatus(transcription.speechJobId);
  } catch (error) {
    // A transient failure asking for the status must NOT fail the job - the
    // work is still running on the service, and the next poll will ask
    // again. Logged and left alone.
    console.warn(`advanceTranscription: could not read the status of job ${transcription.speechJobId}`, error);

    return transcription;
  }

  if (job.state === "Failed") {
    await deleteTranscriptionJob(transcription.speechJobId);

    // The file stays. This is the case the format warning is about - an MP4
    // the service would not demux - and the person may want to convert it
    // and try again rather than find the meeting gone.
    return failWith(job.error ?? "The transcription service could not process this recording.");
  }

  if (job.state !== "Succeeded") {
    // Still working. Move `queued` on to `transcribing` the first time the
    // service says it has started, so the screen shows progress rather than
    // sitting on the same word for ten minutes.
    if (transcription.status === QUEUED && job.state === "Running") {
      const updated = await updateTranscriptionForUserRepo(transcription.id, userId, {
        status: TRANSCRIBING,
      });

      return updated ?? transcription;
    }

    return transcription;
  }

  let result: { text: string; segments: TranscriptionSegment[]; durationSeconds: number | null };

  try {
    result = await getTranscriptionResult(transcription.speechJobId);
  } catch (error) {
    console.error(`advanceTranscription: could not read the result of job ${transcription.speechJobId}`, error);

    return failWith(boundError(error));
  }

  if (result.text.trim().length === 0) {
    await deleteTranscriptionJob(transcription.speechJobId);

    return failWith(
      "No speech was recognised in this recording. Check that the microphone was picking up the room, and that the language matches.",
    );
  }

  // THE TRANSCRIPT LANDS FIRST, and on its own. Everything after this point
  // is allowed to fail without losing it: the summary is a separate call,
  // and the two tidy-up steps below reach services this transaction has no
  // hold over.
  //
  // CLAIMED rather than simply written. Two tabs polling the same job both
  // see it finish and both arrive here; the status predicate means only one
  // of them stores the transcript and pays for the summary. Fetching the
  // result twice is a wasted HTTP request, which is a fair price for not
  // needing a lock.
  const stored = await claimTranscriptionTransitionRepo(transcription.id, userId, [QUEUED, TRANSCRIBING], {
    status: SUMMARISING,
    transcript: result.text,
    segments: JSON.stringify(result.segments),
    durationSeconds: result.durationSeconds,
    error: null,
  });

  // Somebody else got there first. Their run will finish the job, so this
  // one reports what the row says now rather than doing it all again.
  if (!stored) {
    return (await getTranscriptionForUserRepo(transcription.id, userId)) ?? transcription;
  }

  // The Speech service keeps finished jobs, and a job holds a second copy of
  // the transcript in a place nothing here manages the retention of. Removed
  // now that ours is stored. Best-effort by design - see the client.
  await deleteTranscriptionJob(transcription.speechJobId);

  // And the recording itself. This is the point the audio stops being worth
  // its risk: the transcript is in the database, and a meeting recording is
  // the most sensitive thing this feature touches. Guarded rather than
  // awaited blindly - a storage failure here must not fail a transcript that
  // is already safe, and the reconciliation pass collects what is left.
  try {
    await deleteMedia(stored.storageKey);
  } catch (error) {
    console.error(`advanceTranscription: could not delete the media for ${stored.id}`, error);
  }

  const { summary, error } = await summariseTranscript(stored, userId);

  const completed = await claimTranscriptionTransitionRepo(stored.id, userId, [SUMMARISING], {
    status: COMPLETED,
    summary,
    error,
    completedAt: new Date(),
  });

  return completed ?? stored;
}

// -------------------------------------------------------------------
// The whole screen: this user's transcriptions, plus the one being opened.
//
// An unknown or someone else's `transcriptionId` is not an error - it falls
// back to the most recent one, so a stale link or a tampered id lands on a
// working screen and reveals nothing either way.
//
// It also SWEEPS this user's unfinished jobs before reading the list. That
// is what makes the feature survive a closed tab: the work carries on at
// the Speech service whether or not anybody is watching, and coming back to
// the page is the moment the answer is wanted.
// -------------------------------------------------------------------
export async function getTranscriptionPageService(transcriptionId?: string): Promise<TranscriptionPageDTO> {
  try {
    const user = await requireUser();

    const speechConfigured = isSpeechConfigured();

    if (speechConfigured) {
      const inFlight = await getInFlightTranscriptionsForUserRepo(user.id);

      // Sequential rather than parallel. Somebody with several jobs running
      // is the exception, and each of these is a call to an external service
      // plus a write - fanning them out would turn one slow page load into a
      // burst against the Speech API.
      for (const row of inFlight) {
        try {
          await advanceTranscription(row, user.id);
        } catch (error) {
          // One stuck job must not take the page down with it.
          console.error(`getTranscriptionPageService: could not advance transcription ${row.id}`, error);
        }
      }
    }

    const rows = await getTranscriptionsForUserRepo(user.id);
    const transcriptions = rows.map(mapDBTranscriptionToSummaryDTO);

    const requested = transcriptionId
      ? transcriptions.find((item) => item.id === transcriptionId)
      : undefined;

    const target = requested ?? transcriptions[0];

    // The list read deliberately leaves out the heavy columns, so opening
    // one is a second, narrower query rather than a page that carries every
    // transcript it can see.
    const activeRow = target ? await getTranscriptionForUserRepo(target.id, user.id) : undefined;

    return {
      isStorageConfigured: isMediaStorageConfigured(),
      isSpeechConfigured: speechConfigured,
      isStorageReachableByAzure: isMediaReachableByAzureServices(),
      transcriptions,
      active: activeRow ? mapDBTranscriptionToDetailDTO(activeRow) : null,
    };
  } catch (error) {
    throw handleError("getTranscriptionPageService", error);
  }
}

// -------------------------------------------------------------------
// Step one: claim a place for the media and hand back somewhere to put it.
//
// The ROW IS CREATED BEFORE THE URL IS SIGNED, and that ordering is the
// point. The blob key is derived from an id this service generated against
// a row this user owns, so the browser is never in a position to name its
// own destination in a container it shares with everybody else.
// -------------------------------------------------------------------
export async function createTranscriptionService(
  requestDTO: CreateTranscriptionRequestDTO,
): Promise<TranscriptionUploadTicketDTO> {
  try {
    const user = await requireUser();

    if (!isMediaStorageConfigured()) {
      throw new DisplayErrorMessage("Transcription storage is not configured on this environment.");
    }

    if (!isSpeechConfigured()) {
      // Refused here rather than after the upload. There is no point
      // spending somebody's time and bandwidth on a file nothing can read.
      throw new DisplayErrorMessage("Transcription is not configured on this environment.");
    }

    // The earliest possible point. Everything downstream would work - the
    // recording, the upload, the job - right up to Azure trying to fetch a
    // blob from a machine it cannot see. Failing now costs somebody a
    // click; failing later costs them the meeting.
    if (!isMediaReachableByAzureServices()) {
      throw new DisplayErrorMessage(UNREACHABLE_STORAGE_MESSAGE);
    }

    // Server-derived from the name, never taken from the browser.
    const mediaType = mediaTypeForFileName(requestDTO.fileName);

    if (!mediaType) {
      throw new DisplayErrorMessage("That is not a file type this can transcribe.");
    }

    const transcriptionId = generateId();
    const storageKey = mediaStorageKey(user.id, transcriptionId);

    const now = new Date();

    await addTranscriptionRepo({
      id: transcriptionId,
      userId: user.id,
      title: requestDTO.title,
      source: requestDTO.source,
      status: TRANSCRIPTION_STATUSES.AWAITING_MEDIA,
      storageKey,
      mediaType,
      byteSize: null,
      durationSeconds: null,
      speechJobId: null,
      transcript: null,
      segments: null,
      summary: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });

    // Write-only, one blob, and it expires. See media-storage.ts for why
    // this feature signs a URL at all when chat attachments do not.
    const uploadUrl = await createUploadUrl(storageKey);

    revalidateTranscriptionViews();

    return { transcriptionId, uploadUrl, mediaType };
  } catch (error) {
    throw handleError("createTranscriptionService", error);
  }
}

// -------------------------------------------------------------------
// Step three: the upload finished, so hand the file to the Speech service.
//
// This is where the size is checked. A SAS grants a write; it does not cap
// one, so the first moment the real size is known is now - which is why the
// check asks storage rather than trusting a number from the browser.
//
// Also the retry path for a failed job: a failure keeps its file precisely
// so this can be run again.
// -------------------------------------------------------------------
export async function startTranscriptionService(
  requestDTO: TranscriptionIdRequestDTO,
): Promise<TranscriptionDetailDTO> {
  try {
    const user = await requireUser();

    const transcription = await requireOwnedTranscription(requestDTO.transcriptionId, user.id);

    if (!isSpeechConfigured()) {
      throw new DisplayErrorMessage("Transcription is not configured on this environment.");
    }

    // Checked again here, because this is also the retry path for a failed
    // job and would otherwise create a second doomed one.
    if (!isMediaReachableByAzureServices()) {
      throw new DisplayErrorMessage(UNREACHABLE_STORAGE_MESSAGE);
    }

    const startable: string[] = [TRANSCRIPTION_STATUSES.AWAITING_MEDIA, TRANSCRIPTION_STATUSES.FAILED];

    if (!startable.includes(transcription.status)) {
      // Already running or already done. Not an error worth interrupting
      // anybody over - two tabs racing produce exactly this.
      return mapDBTranscriptionToDetailDTO(transcription);
    }

    const media = await getMediaInfo(transcription.storageKey);

    if (!media.exists || media.byteSize === null || media.byteSize === 0) {
      throw new DisplayErrorMessage("The recording did not finish uploading. Try again.");
    }

    if (media.byteSize > MAX_MEDIA_BYTES) {
      const tooLarge = `That file is larger than the ${Math.round(MAX_MEDIA_BYTES / (1024 * 1024))} MB the transcription service accepts.`;

      // Removed rather than left to age out: it is over the limit, nothing
      // will ever transcribe it, and it would otherwise be the largest thing
      // in the container for the length of the retention window.
      await deleteMedia(transcription.storageKey);

      // Recorded on the row as well as thrown, so the reason is still there
      // when they come back to the list rather than only in a toast they
      // have already dismissed.
      await updateTranscriptionForUserRepo(transcription.id, user.id, {
        status: TRANSCRIPTION_STATUSES.FAILED,
        error: tooLarge,
      });

      revalidateTranscriptionViews();

      throw new DisplayErrorMessage(tooLarge);
    }

    // A plain blob URL with no token on it. The Speech resource reads it
    // through its own managed identity - see speech-client.ts.
    const contentUrl = await mediaBlobUrl(transcription.storageKey);

    let speechJobId: string;

    try {
      speechJobId = await startTranscription({
        contentUrl,
        // Shown in the Speech resource's own job list, which is where an
        // administrator looks when something is wrong. The title is the
        // person's own text, so it is bounded here rather than passed
        // through at whatever length it happens to be.
        displayName: transcription.title.slice(0, 100),
        locale: envServer.AZURE_SPEECH_LOCALE,
      });
    } catch (error) {
      await updateTranscriptionForUserRepo(transcription.id, user.id, {
        status: TRANSCRIPTION_STATUSES.FAILED,
        error: boundError(error),
      });

      revalidateTranscriptionViews();

      throw handleError("startTranscriptionService", error);
    }

    const updated = await updateTranscriptionForUserRepo(transcription.id, user.id, {
      status: TRANSCRIPTION_STATUSES.QUEUED,
      speechJobId,
      byteSize: media.byteSize,
      // Cleared, so a retry does not keep showing why the previous attempt
      // did not work.
      error: null,
    });

    revalidateTranscriptionViews();

    return mapDBTranscriptionToDetailDTO(updated ?? transcription);
  } catch (error) {
    throw handleError("startTranscriptionService", error);
  }
}

// -------------------------------------------------------------------
// Where one transcription has got to, advancing it on the way.
//
// What the browser polls while a job is running. Scoped to one row rather
// than sweeping, because the page already swept on load and this is asking
// about the thing somebody is watching.
// -------------------------------------------------------------------
export async function refreshTranscriptionService(
  requestDTO: TranscriptionIdRequestDTO,
): Promise<TranscriptionDetailDTO> {
  try {
    const user = await requireUser();

    const transcription = await requireOwnedTranscription(requestDTO.transcriptionId, user.id);

    const advanced = await advanceTranscription(transcription, user.id);

    // Only when something actually moved. Revalidating on every poll would
    // rebuild the page every few seconds for no reason.
    if (advanced.status !== transcription.status) {
      revalidateTranscriptionViews();
    }

    return mapDBTranscriptionToDetailDTO(advanced);
  } catch (error) {
    throw handleError("refreshTranscriptionService", error);
  }
}

// -------------------------------------------------------------------
// Try the summary again.
//
// For a completed row whose transcript is fine and whose summary would not
// generate. Deliberately available only in that state: re-summarising a row
// that already has one would spend money to replace something the person
// can already read.
// -------------------------------------------------------------------
export async function retryTranscriptionSummaryService(
  requestDTO: TranscriptionIdRequestDTO,
): Promise<TranscriptionDetailDTO> {
  try {
    const user = await requireUser();

    const transcription = await requireOwnedTranscription(requestDTO.transcriptionId, user.id);

    if (transcription.status !== TRANSCRIPTION_STATUSES.COMPLETED || transcription.summary) {
      return mapDBTranscriptionToDetailDTO(transcription);
    }

    const { summary, error } = await summariseTranscript(transcription, user.id);

    const updated = await updateTranscriptionForUserRepo(transcription.id, user.id, { summary, error });

    revalidateTranscriptionViews();

    return mapDBTranscriptionToDetailDTO(updated ?? transcription);
  } catch (error) {
    throw handleError("retryTranscriptionSummaryService", error);
  }
}

// -------------------------------------------------------------------
// Rename. Does not touch anything else, so it is safe at any status.
// -------------------------------------------------------------------
export async function renameTranscriptionService(
  requestDTO: RenameTranscriptionRequestDTO,
): Promise<void> {
  try {
    const user = await requireUser();

    await requireOwnedTranscription(requestDTO.transcriptionId, user.id);

    await updateTranscriptionForUserRepo(requestDTO.transcriptionId, user.id, {
      title: requestDTO.title,
    });

    revalidateTranscriptionViews();
  } catch (error) {
    throw handleError("renameTranscriptionService", error);
  }
}

// -------------------------------------------------------------------
// Delete a transcription, its transcript and whatever media is left.
//
// A real delete rather than a flag: this is the person's own recording of
// their own meeting, and "delete" has to mean it is gone.
//
// FILE FIRST, then the row. A row delete cannot touch storage, so once the
// row is gone nothing knows the blob exists. In this order a failure leaves
// the transcription intact and retryable instead of orphaning a recording.
// -------------------------------------------------------------------
export async function deleteTranscriptionService(requestDTO: TranscriptionIdRequestDTO): Promise<void> {
  try {
    const user = await requireUser();

    // Resolved before anything is removed, so the storage key being cleared
    // is provably one this caller owns.
    const transcription = await requireOwnedTranscription(requestDTO.transcriptionId, user.id);

    if (isMediaStorageConfigured()) {
      // Already gone for anything that transcribed successfully, and
      // deleteIfExists makes that a no-op rather than an error.
      await deleteMedia(transcription.storageKey);
    }

    // A job still running would otherwise carry on, finish, and leave a copy
    // of the transcript on the Speech service for a row that no longer
    // exists here.
    if (transcription.speechJobId) {
      await deleteTranscriptionJob(transcription.speechJobId);
    }

    const deleted = await deleteTranscriptionForUserRepo(requestDTO.transcriptionId, user.id);

    if (deleted === 0) {
      throw new DisplayErrorMessage("That transcription no longer exists.");
    }

    revalidateTranscriptionViews();
  } catch (error) {
    throw handleError("deleteTranscriptionService", error);
  }
}

// -------------------------------------------------------------------
// The transcript as a plain-text file.
//
// Built here rather than in the browser so the download is the same text
// the model was given, and so a transcript that is megabytes of speech is
// assembled once on the server rather than concatenated in a component.
// -------------------------------------------------------------------
export async function getTranscriptTextService(
  requestDTO: TranscriptionIdRequestDTO,
): Promise<{ fileName: string; text: string }> {
  try {
    const user = await requireUser();

    const transcription = await requireOwnedTranscription(requestDTO.transcriptionId, user.id);

    if (!transcription.transcript) {
      throw new DisplayErrorMessage("That transcription has no transcript yet.");
    }

    const segments = transcription.segments ?? [];

    // Timestamps are added here and not stored in `transcript`, because the
    // model reads that column and a timestamp on every line is noise to it.
    const body =
      segments.length > 0
        ? segments
            .map(
              (segment) =>
                `[${formatTimestamp(segment.startMs)}] ${speakerLabel(segment.speaker)}: ${segment.text}`,
            )
            .join("\n\n")
        : transcription.transcript;

    const header = [
      transcription.title,
      // In the app timezone, like every other date this app shows. A raw ISO
      // string would read as the wrong day for anybody who opens the file.
      `Recorded: ${formatDateTime(transcription.createdAt)}`,
      transcription.source === TRANSCRIPTION_SOURCES.RECORDING
        ? "Source: recorded in the browser"
        : "Source: uploaded file",
      "Transcribed automatically. It will contain mistakes.",
    ].join("\n");

    // Any path separators are stripped, and the extension is fixed - the
    // title is the person's own text and must not be able to decide what
    // kind of file this is.
    const safeName = transcription.title.replace(/[^a-zA-Z0-9 _-]+/g, " ").replace(/\s+/g, " ").trim();

    return {
      fileName: `${safeName.length > 0 ? safeName : "transcript"}.txt`,
      text: `${header}\n\n${"-".repeat(60)}\n\n${body}\n`,
    };
  } catch (error) {
    throw handleError("getTranscriptTextService", error);
  }
}
