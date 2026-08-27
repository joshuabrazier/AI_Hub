import "server-only";

import { ConverseStreamCommand, type Message, type SystemContentBlock } from "@aws-sdk/client-bedrock-runtime";
import { generateId } from "better-auth";
import { revalidatePath } from "next/cache";

import {
  BEDROCK_MODEL_ID,
  BEDROCK_REGION,
  getBedrockClient,
  isBedrockConfigured,
} from "@/lib/ai/bedrock-client";
import { buildHouseVoiceBlock } from "@/lib/ai/house-voice";
import { isMicrosoftSignInConfigured } from "@/lib/auth/account-creation-policy";
import { requireUser } from "@/lib/auth/session-auth-server";
import { getUserByUserIdRepo } from "@/lib/data/repositories/users.repository";
import {
  AI_CHAT_REQUEST_KINDS,
  TRANSCRIPTION_SOURCES,
  TRANSCRIPTION_SOURCE_DESCRIPTIONS,
  TRANSCRIPTION_STATUSES,
  USER_ROLES,
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
  getAllInFlightTranscriptionsRepo,
  getInFlightTranscriptionsForUserRepo,
  getTranscriptionBySourceRefRepo,
  getTranscriptionForUserRepo,
  getTranscriptionSourceRefsForUserRepo,
  getTranscriptionsForUserRepo,
  updateTranscriptionForUserRepo,
} from "@/lib/data/repositories/transcriptions.repository";
import { envServer } from "@/lib/env-server";
import { DisplayErrorMessage, isDisplayError } from "@/lib/errors";
import { safeDownloadName } from "@/lib/download-blob";
import { formatDateTime } from "@/lib/format";
import { handleError } from "@/lib/handle-errors";
import {
  MEETING_LOOKBACK_DAYS,
  fetchTranscriptVtt,
  findOnlineMeetingId,
  getTeamsMeeting,
  listMeetingTranscripts,
  listRecentTeamsMeetings,
} from "@/lib/graph/teams-meetings";
import {
  eventIdFromSourceRef,
  parseTeamsVtt,
  teamsSegmentsToText,
  teamsSourceRef,
} from "@/lib/graph/teams-transcript";
import { isPushConfigured, sendPushToUser } from "@/lib/push/push-notifications";
import { ROUTES, transcriptionHomeForRole } from "@/lib/routes";
import { GRAPH_OUTCOMES, graphOutcomeOf } from "@/lib/sharepoint/graph-client";
import { isFakeSharepointEnabled } from "@/lib/sharepoint/dev-fake";
import {
  createUploadUrl,
  deleteMedia,
  getMediaInfo,
  isMediaReachableByAzureServices,
  isMediaStorageConfigured,
  mediaBlobUrl,
  mediaStorageKey,
  openMediaStream,
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
  TITLE_MAX_CHARS,
  TRANSCRIPTION_TIMEOUT_HOURS,
  extensionForMediaType,
  formatTimestamp,
  mediaTypeForFileName,
  speakerLabel,
  type CreateTranscriptionRequestDTO,
  type ImportTeamsMeetingRequestDTO,
  type RenameTranscriptionRequestDTO,
  type TeamsMeetingDTO,
  type TeamsMeetingsDTO,
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
// THE RECORDING IS KEPT for the retention window, and can be downloaded.
// The transcript is the deliverable, but speech recognition makes mistakes,
// so being able to hear what was actually said is worth the storage - which
// at any realistic volume is pennies a month. It is served by streaming it
// back through this app, never as a signed URL; see the download route.
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

// How long one attempt at a summary may take before it is abandoned.
const SUMMARY_TIMEOUT_MS = 120_000;

// How long a transcription may sit in `summarising` before the summary is
// written off and the row is completed without one.
//
// Something has to end this. Every attempt costs a model call, and a row
// that cannot be summarised - too long, a persistent service problem, a
// request killed halfway every time - would otherwise be retried by every
// poll forever, spending money on the same failure. The transcript is
// already stored by this point, so giving up costs nobody their meeting.
const SUMMARY_GIVE_UP_MINUTES = 15;

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

  // A meeting summary is read by people here and often pasted onward, so it
  // gets the house voice like any other writing the app produces. Appended
  // as its own block, after the instructions about the task: what to
  // summarise matters more than how it reads.
  const system: SystemContentBlock[] = [{ text: SUMMARY_SYSTEM_PROMPT }];

  const houseVoice = buildHouseVoiceBlock();

  if (houseVoice) system.push({ text: houseVoice });

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
    // STREAMED, and this is not a preference - it is the fix for a real
    // failure. A non-streaming ConverseCommand sends nothing at all until
    // the model has finished, and the client is configured to abandon a
    // stream with no activity for READ_TIMEOUT_MS - 120 seconds, in
    // bedrock-client.ts. Opus writing up to SUMMARY_MAX_TOKENS from an
    // hour-long transcript takes longer than that, so every summary of a
    // real meeting timed out, five times over, because `maxAttempts: 5`
    // retried a request that was never going to be any faster.
    //
    // Streaming puts a token on the socket every few milliseconds, so the
    // inactivity timer never fires. The text is accumulated here; nothing
    // downstream knows or cares that it arrived in pieces.
    const response = await getBedrockClient().send(
      new ConverseStreamCommand({
        modelId: BEDROCK_MODEL_ID,
        system,
        messages,
        inferenceConfig: { maxTokens: SUMMARY_MAX_TOKENS },
      }),
      // A hard ceiling on the whole thing, independent of the SDK's
      // per-stream timers. Summarising happens while somebody is watching a
      // spinner, so it has to end - successfully or not - in a length of
      // time a person will wait.
      { abortSignal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS) },
    );

    if (!response.stream) throw new Error("Bedrock returned no stream");

    let summary = "";
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    let cacheReadTokens: number | null = null;
    let cacheWriteTokens: number | null = null;

    for await (const event of response.stream) {
      const chunk = event.contentBlockDelta?.delta?.text;

      if (chunk) {
        summary += chunk;
        continue;
      }

      // Usage arrives once, at the end, on its own event.
      if (event.metadata?.usage) {
        inputTokens = event.metadata.usage.inputTokens ?? null;
        outputTokens = event.metadata.usage.outputTokens ?? null;
        cacheReadTokens = event.metadata.usage.cacheReadInputTokens ?? null;
        cacheWriteTokens = event.metadata.usage.cacheWriteInputTokens ?? null;
      }
    }

    await recordSummaryRequest({
      userId,
      system,
      messages,
      usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
      error: null,
      startedAt,
    });

    const trimmed = summary.trim();

    if (!trimmed) {
      return { summary: null, error: "The summariser returned nothing." };
    }

    return { summary: trimmed, error: null };
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
// Tell the person their transcription has finished.
//
// NOTHING FROM THE MEETING GOES IN THE PAYLOAD. A push notification is
// delivered to a locked screen, sits with the browser vendor in transit,
// and is readable by whoever is holding the phone. So this carries the
// title they gave it, one line of status, and a link. The transcript and
// the summary stay behind the session check on the page it opens.
//
// The title is the one exception, and it is theirs - they typed it, or it
// is a date. If somebody names a meeting after something confidential, that
// is a choice they made about their own lock screen.
//
// Best-effort and never throws: the transcript is already stored by this
// point, and losing a job over a notification would be exactly backwards.
// -------------------------------------------------------------------
async function notifyFinished(transcription: Transcription, userId: string): Promise<void> {
  if (!isPushConfigured()) return;

  const failed = transcription.status === TRANSCRIPTION_STATUSES.FAILED;

  // Looked up rather than passed in, because the background sweep has no
  // session - it acts on rows belonging to people who are not here.
  const owner = await getUserByUserIdRepo(userId);

  await sendPushToUser(userId, {
    title: failed ? "Transcription failed" : "Your transcription is ready",
    body: failed
      ? `"${transcription.title}" could not be transcribed. The recording is still here.`
      : `"${transcription.title}" has been transcribed and summarised.`,
    // The path for THIS person's role. It cannot be a fixed one: the proxy
    // redirects a non-member away from /portal rather than refusing them,
    // so an admin tapping a portal link would land on their dashboard
    // instead of the transcription the notification was about - a bug that
    // would look like the notification simply not working.
    url: `${transcriptionHomeForRole(owner?.role ?? USER_ROLES.MEMBER)}?id=${transcription.id}`,
    // One notification per transcription. A retry replaces the earlier one
    // rather than stacking a second onto the lock screen.
    tag: `transcription-${transcription.id}`,
  });
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
async function advanceTranscription(
  transcription: Transcription,
  userId: string,
  // Whether this caller may spend a model call. FALSE from the page-load
  // sweep, which renders a server component - a summary takes tens of
  // seconds, and a page that waits for one shows the reader a blank tab
  // until it finishes. Worse, if the request dies first, the row never
  // moves and the next page load starts the whole thing again.
  //
  // The poll passes true. It is a client-initiated action behind a spinner,
  // which is the right place for slow work: the screen keeps rendering, and
  // the reader can see that something is happening.
  { allowSummarise }: { allowSummarise: boolean },
): Promise<Transcription> {
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

    await notifyFinished(updated ?? transcription, userId);

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
    // Long enough in this state that the summary is not coming. The row is
    // completed WITHOUT one rather than left to be retried forever - the
    // transcript is already stored, so this loses nothing but the summary,
    // and the screen offers to try it again by hand.
    const summarisingMinutes = (Date.now() - transcription.updatedAt.getTime()) / (60 * 1000);

    if (summarisingMinutes > SUMMARY_GIVE_UP_MINUTES) {
      const givenUp = await claimTranscriptionTransitionRepo(transcription.id, userId, [SUMMARISING], {
        status: COMPLETED,
        error: "The summary could not be generated. The transcript is unaffected.",
        completedAt: new Date(),
      });

      return givenUp ?? transcription;
    }

    // Left where it is for the poll to pick up. Nothing is lost by waiting:
    // the transcript is stored and the screen already says "Summarising".
    if (!allowSummarise) return transcription;

    const { summary, error } = await summariseTranscript(transcription, userId);

    const updated = await claimTranscriptionTransitionRepo(transcription.id, userId, [SUMMARISING], {
      status: COMPLETED,
      summary,
      error,
      completedAt: new Date(),
    });

    // Only the run that WON the claim notifies. Two sweeps arriving together
    // would otherwise send the same person the same notification twice.
    if (updated) await notifyFinished(updated, userId);

    return updated ?? (await getTranscriptionForUserRepo(transcription.id, userId)) ?? transcription;
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
    // A job still running far longer than any real one takes is not coming
    // back. Without this the row would say "transcribing" forever and its
    // recording would never be swept, because the retention pass only
    // clears what has aged out of the whole window.
    //
    // CHECKED HERE, AFTER ASKING AZURE, AND ONLY WHEN IT IS STILL RUNNING.
    // It used to run before the status call, which was wrong in a way that
    // lost transcripts: jobs only advance when somebody opens the screen, so
    // a meeting recorded on Friday afternoon and not looked at until Monday
    // would be marked failed on the first sweep - even though Azure had
    // finished it successfully minutes after it started, and the transcript
    // was sitting there waiting to be collected.
    const ageHours = (Date.now() - transcription.createdAt.getTime()) / (60 * 60 * 1000);

    if (ageHours > TRANSCRIPTION_TIMEOUT_HOURS) {
      await deleteTranscriptionJob(transcription.speechJobId);

      return failWith(
        `This did not finish within ${TRANSCRIPTION_TIMEOUT_HOURS} hours and has been stopped. The recording is still here, so you can try again.`,
      );
    }

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

  // THE RECORDING IS KEPT. It used to be deleted here, on the reasoning that
  // the transcript was the deliverable and the audio was the most sensitive
  // thing this feature holds - but that traded away something people
  // actually want (the audio of their own meeting) for a cost that turned
  // out to be pennies a month, and for a transcript that automatic speech
  // recognition guarantees will contain mistakes. Being able to go back to
  // what was actually said is worth more than the storage.
  //
  // It is not kept forever: TRANSCRIPTION_RETENTION_DAYS removes the row and
  // its recording together, deleting a transcription clears the blob first,
  // and the reconciliation pass collects anything a cascade orphaned.

  // The transcript is safe. If this caller may not spend a model call, stop
  // here and let the poll finish the job - the row is already in
  // `summarising`, which is exactly where the poll expects to find it.
  if (!allowSummarise) return stored;

  const { summary, error } = await summariseTranscript(stored, userId);

  const completed = await claimTranscriptionTransitionRepo(stored.id, userId, [SUMMARISING], {
    status: COMPLETED,
    summary,
    error,
    completedAt: new Date(),
  });

  if (completed) await notifyFinished(completed, userId);

  return completed ?? stored;
}

// -------------------------------------------------------------------
// The whole screen: this user's transcriptions, plus the one being opened.
//
// An unknown or someone else's `transcriptionId` is not an error - it falls
// back to the most recent one, so a stale link or a tampered id lands on a
// working screen and reveals nothing either way.
//
// THIS READS THE DATABASE AND NOTHING ELSE. No Speech call, no blob call,
// no model call - and that restriction is the whole reason the screen is
// reliable.
//
// It did sweep unfinished jobs here once, and it was wrong in a way that
// only showed up in production: a server component that awaits an external
// service renders NOTHING until that service answers, so one stuck job
// meant the tab sat blank. Worse, when the request was eventually killed,
// the work it was part-way through was never written, so the row stayed
// exactly as it was and the next page load began the same doomed attempt.
//
// The sweep now runs from the browser instead - see sweepTranscriptionsService
// below. The page paints immediately from stored state, and jobs move
// forward in a request nobody is watching a blank screen for.
// -------------------------------------------------------------------
export async function getTranscriptionPageService(transcriptionId?: string): Promise<TranscriptionPageDTO> {
  try {
    const user = await requireUser();

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
      isSpeechConfigured: isSpeechConfigured(),
      isStorageReachableByAzure: isMediaReachableByAzureServices(),
      // Independent of all three above: importing from Teams uploads
      // nothing, stores nothing and never asks the Speech service. An
      // environment with Microsoft sign-in and no Azure Speech key can still
      // do this, and saying so is the difference between a usable screen and
      // one that reports itself as broken.
      isTeamsImportConfigured: isTeamsImportConfigured(),
      transcriptions,
      active: activeRow ? mapDBTranscriptionToDetailDTO(activeRow) : null,
    };
  } catch (error) {
    throw handleError("getTranscriptionPageService", error);
  }
}

// -------------------------------------------------------------------
// Move every unfinished job of this user's forward.
//
// THE ONE PLACE JOBS ADVANCE. Called from the browser on the transcription
// screen, on a timer while anything is unfinished. Everything slow lives
// here - Speech status checks, fetching a finished transcript, deleting the
// recording, summarising - and none of it is in the path of rendering a
// page. A slow or stuck job now delays this request only; the screen it
// belongs to is already on the reader's display, showing stored state.
//
// It is also what makes "close the tab and come back" work. The Speech
// service carries on whether or not anybody is watching, and this is what
// collects the result when somebody returns.
//
// Returns whether anything actually changed, so the caller can re-render
// once instead of on every tick.
// -------------------------------------------------------------------
export async function sweepTranscriptionsService(): Promise<{ changed: boolean }> {
  try {
    const user = await requireUser();

    // Not an early return for the whole sweep, and that distinction matters
    // now that a row can arrive without ever going near Speech. A Teams
    // import lands in `summarising` with its transcript already stored, and
    // only needs the model - so an environment with Graph but no Speech key
    // must still finish those rather than leaving them in flight forever.
    const speechConfigured = isSpeechConfigured();

    const inFlight = await getInFlightTranscriptionsForUserRepo(user.id);

    let changed = false;

    // Sequential rather than parallel. Somebody with several jobs running at
    // once is the exception, and each of these is a call to an external
    // service plus a write - fanning them out would turn one sweep into a
    // burst against the Speech API and, when they all finish together, a
    // burst of model calls too.
    for (const row of inFlight) {
      // Everything before `summarising` is waiting on a Speech job. Without
      // the service there is nothing to ask and nothing to move.
      if (!speechConfigured && row.status !== TRANSCRIPTION_STATUSES.SUMMARISING) continue;

      try {
        const advanced = await advanceTranscription(row, user.id, { allowSummarise: true });

        if (advanced.status !== row.status) changed = true;
      } catch (error) {
        // One stuck job must not stop the others being collected.
        console.error(`sweepTranscriptionsService: could not advance transcription ${row.id}`, error);
      }
    }

    if (changed) revalidateTranscriptionViews();

    return { changed };
  } catch (error) {
    throw handleError("sweepTranscriptionsService", error);
  }
}

// -------------------------------------------------------------------
// Move EVERYBODY'S unfinished jobs forward.
//
// The background half, run from the scheduled job. It is what makes a
// notification possible at all: the browser-driven sweep only runs while
// somebody has the screen open, so with a locked phone nothing would ever
// finish the job and there would be nothing to notify about.
//
// It has no session, so it cannot use requireUser - each row carries the
// user it belongs to, and every call below is scoped to that id rather than
// to a caller. This is the only place in the feature that acts on rows it
// did not resolve from a session, and the endpoint in front of it is
// guarded by a bearer secret for exactly that reason.
//
// Bounded per run so one pass after an outage cannot pull an unbounded set
// into memory; the remainder is collected on the next tick.
// -------------------------------------------------------------------
const SWEEP_BATCH_SIZE = 50;

export async function sweepAllTranscriptionsService(): Promise<{
  examined: number;
  advanced: number;
}> {
  try {
    // Per row rather than for the whole batch - see the note in
    // sweepTranscriptionsService. A Teams import needs no Speech service.
    const speechConfigured = isSpeechConfigured();

    const inFlight = await getAllInFlightTranscriptionsRepo(SWEEP_BATCH_SIZE);

    let advanced = 0;

    // Sequential. Each of these is an external call plus a write, and when
    // several finish together each also becomes a model call - fanning that
    // out would turn one scheduled run into a burst against both services.
    for (const row of inFlight) {
      if (!speechConfigured && row.status !== TRANSCRIPTION_STATUSES.SUMMARISING) continue;

      try {
        const result = await advanceTranscription(row, row.userId, { allowSummarise: true });

        if (result.status !== row.status) advanced += 1;
      } catch (error) {
        // One stuck job must not stop the rest of the batch.
        console.error(`sweepAllTranscriptionsService: could not advance transcription ${row.id}`, error);
      }
    }

    if (advanced > 0) revalidateTranscriptionViews();

    return { examined: inFlight.length, advanced };
  } catch (error) {
    throw handleError("sweepAllTranscriptionsService", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// IMPORTING FROM TEAMS
// ===================================================================
//
// The third way a transcription can arrive, and the only one where this app
// does no transcribing at all. Teams records and transcribes the meeting
// itself, and this fetches the result through Microsoft Graph.
//
// WHAT THAT BUYS, and it is the whole reason the feature exists: Teams
// transcribes each participant's OWN microphone against their signed-in
// identity, so the transcript comes back with REAL NAMES on it. Azure Speech
// can tell voices apart and calls them "Speaker 0"; Teams knows it was
// Louis. For a meeting the organisation hosts, that is a better transcript
// than anything this app can produce from one microphone in a room.
//
// WHAT IT COSTS, stated plainly because it decides whether somebody can use
// it at all:
//
//   - THE MEETING MUST ALREADY HAVE BEEN TRANSCRIBED BY TEAMS. Nothing here
//     can turn that on retrospectively. If nobody started transcription,
//     there is nothing to fetch and no code can change that.
//   - IT MUST BE A MEETING THIS TENANT HOSTS. A client running the meeting
//     on their own tenant owns the transcript, and a delegated call finds
//     nothing for it. The recorder is still the answer for those, which is
//     why it stays.
//
// EVERY CALL IS DELEGATED - made as the signed-in person, so Graph itself
// enforces that they were in the meeting. Nothing here decides who may read
// a transcript, which is worth more than any check this code could make.
// -------------------------------------------------------------------

// Whether the Teams import can work on this deployment at all.
//
// It needs a real Microsoft sign-in, because the whole thing runs on a
// delegated token. The fake-SharePoint door is excluded deliberately: it
// hands out a token that is deliberately not a credential, and a request
// carrying it to real Graph would fail as an authentication problem - a
// confusing way to learn that a local shortcut does not extend this far.
function isTeamsImportConfigured(): boolean {
  return isMicrosoftSignInConfigured() && !isFakeSharepointEnabled();
}

// -------------------------------------------------------------------
// Turn a Graph failure into something worth reading.
//
// The three outcomes have three different remedies and only one of them is
// "try again": a lapsed grant needs a person to sign in, a throttle needs
// time, and anything else is genuinely unexpected. Collapsing them into one
// message would send somebody looking in the wrong place - and the re-auth
// case especially, because it is the one that will actually happen the day
// this ships, to everybody who signed in before the new scopes existed.
// -------------------------------------------------------------------
function teamsGraphFailure(error: unknown): DisplayErrorMessage {
  // graphOutcomeOf, not instanceof - class identity is per bundle chunk in a
  // production build, and the re-auth message is the one that must survive.
  switch (graphOutcomeOf(error)) {
    case GRAPH_OUTCOMES.NEEDS_REAUTH:
      return new DisplayErrorMessage(
        "Microsoft would not grant access to your meetings. Sign out and sign in again to renew it - if that does not help, an administrator has to approve this app's access to Teams transcripts.",
      );

    case GRAPH_OUTCOMES.THROTTLED:
      return new DisplayErrorMessage("Microsoft is rate-limiting this app. Try again in a few minutes.");

    default:
      return new DisplayErrorMessage(`Microsoft could not be reached: ${boundError(error)}`);
  }
}

// -------------------------------------------------------------------
// This person's recent Teams meetings, and which they have already imported.
//
// FETCHED ON DEMAND, NOT WITH THE PAGE. Rendering the transcription screen
// reads the database and nothing else, and that restriction is what makes it
// reliable - see getTranscriptionPageService. A Graph call in the render
// path would put the whole screen behind Microsoft answering.
//
// It says nothing about whether a given meeting HAS a transcript. Graph has
// no endpoint that answers that for a list; finding out means resolving the
// meeting and asking, which is two calls per row. A fortnight of meetings
// would be dozens of calls to grey out some rows, so the question is asked
// once, for the meeting somebody actually picks.
// -------------------------------------------------------------------
export async function listTeamsMeetingsService(): Promise<TeamsMeetingsDTO> {
  try {
    const user = await requireUser();

    if (!isTeamsImportConfigured()) {
      return { isConfigured: false, lookbackDays: MEETING_LOOKBACK_DAYS, meetings: [] };
    }

    let meetings;

    try {
      meetings = await listRecentTeamsMeetings(user.id);
    } catch (error) {
      throw teamsGraphFailure(error);
    }

    // One query for the whole list rather than one per row.
    const imported = await getTranscriptionSourceRefsForUserRepo(user.id, TRANSCRIPTION_SOURCES.TEAMS);

    // Keyed by the EVENT id, because that is what the list has in hand. See
    // teamsSourceRef for why a row stores both ids.
    const byEvent = new Map(imported.map((row) => [eventIdFromSourceRef(row.sourceRef), row.id]));

    return {
      isConfigured: true,
      lookbackDays: MEETING_LOOKBACK_DAYS,
      meetings: meetings.map(
        (meeting): TeamsMeetingDTO => ({
          eventId: meeting.eventId,
          subject: meeting.subject,
          startsAt: meeting.startsAt,
          endsAt: meeting.endsAt,
          organiser: meeting.organiser,
          importedAs: byEvent.get(meeting.eventId) ?? null,
        }),
      ),
    };
  } catch (error) {
    throw handleError("listTeamsMeetingsService", error);
  }
}

// -------------------------------------------------------------------
// Import one meeting's transcript.
//
// A SERVER ACTION RATHER THAN A ROUTE HANDLER, unlike the sweep, and the
// reason is how long it runs. This makes three Graph calls and a write, and
// then STOPS: the row lands in `summarising` with its transcript already
// stored, and the existing sweep writes the summary. So the slow part - a
// model call measured in tens of seconds - stays where every other slow part
// of this feature lives, and an import holds nothing behind it for more than
// a moment.
//
// It also means an import gets the rest of the machine for free: the poll
// finishes it, the push notification fires, a failed summary can be retried
// by hand, and a browser closed halfway is picked up by the background
// sweep.
//
// The request carries ONLY an event id. The join URL and the title are read
// back from Graph, so nothing the browser sends names a row or reaches a
// meeting - and every call is delegated, so an id belonging to somebody
// else's meeting resolves to nothing rather than to their transcript.
// -------------------------------------------------------------------
export async function importTeamsMeetingService(
  requestDTO: ImportTeamsMeetingRequestDTO,
): Promise<TranscriptionDetailDTO> {
  try {
    const user = await requireUser();

    if (!isTeamsImportConfigured()) {
      throw new DisplayErrorMessage(
        "Importing from Teams needs Microsoft sign-in, which is not configured on this environment.",
      );
    }

    let meeting;
    let onlineMeetingId: string | null;
    let transcripts;

    try {
      meeting = await getTeamsMeeting(user.id, requestDTO.eventId);

      if (!meeting) {
        throw new DisplayErrorMessage("That meeting is no longer in your calendar.");
      }

      onlineMeetingId = await findOnlineMeetingId(user.id, meeting.joinUrl);

      if (!onlineMeetingId) {
        // The signature of a meeting somebody else's organisation hosted.
        // Named as such rather than reported as a failure, because it is not
        // one - and because the answer is the recorder, which is on the next
        // tab along.
        throw new DisplayErrorMessage(
          "Microsoft has no record of that meeting. It was most likely hosted on another organisation's Teams, in which case they hold the transcript - record it here instead.",
        );
      }

      transcripts = await listMeetingTranscripts(user.id, onlineMeetingId);
    } catch (error) {
      // A DisplayErrorMessage above is already the sentence to show. Only a
      // Graph fault needs translating. isDisplayError rather than instanceof,
      // for the reason given in errors.ts.
      if (isDisplayError(error)) throw error;

      throw teamsGraphFailure(error);
    }

    if (transcripts.length === 0) {
      throw new DisplayErrorMessage(
        "Teams has no transcript for that meeting. Transcription has to be started while the meeting is running, and a transcript can take a few minutes to appear after it ends.",
      );
    }

    // The newest, when there is more than one - a meeting stopped and
    // restarted produces a second, and the later one is the fuller record.
    // A missing createdDateTime sorts last rather than upsetting the order.
    const transcript = [...transcripts].sort(
      (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
    )[0];

    const sourceRef = teamsSourceRef(meeting.eventId, transcript.id);

    // Already imported. Answered with the row that exists rather than
    // refused: somebody who clicks Import on a meeting they did last week
    // wants to READ it, and opening it is what they meant.
    const existing = await getTranscriptionBySourceRefRepo(user.id, TRANSCRIPTION_SOURCES.TEAMS, sourceRef);

    if (existing) return mapDBTranscriptionToDetailDTO(existing);

    let vtt: string;

    try {
      vtt = await fetchTranscriptVtt(user.id, onlineMeetingId, transcript.id);
    } catch (error) {
      throw teamsGraphFailure(error);
    }

    const segments = parseTeamsVtt(vtt);
    const text = teamsSegmentsToText(segments);

    if (text.trim().length === 0) {
      // A transcript that exists and says nothing: a meeting where
      // transcription was started and nobody spoke, or one Teams was still
      // writing when it was asked for.
      throw new DisplayErrorMessage(
        "That meeting's transcript is empty. If the meeting has only just finished, Teams may still be writing it - try again in a few minutes.",
      );
    }

    // The LAST turn's end, which is when talking stopped rather than when the
    // meeting was scheduled to. Two people who stay on for five minutes past
    // the hour are part of the meeting; five minutes of silence are not.
    const durationSeconds = Math.round((segments[segments.length - 1]?.endMs ?? 0) / 1000);

    const now = new Date();

    let created: Transcription;

    try {
      created = await addTranscriptionRepo({
        id: generateId(),
        userId: user.id,
        // The meeting's own subject. Renameable like any other title, and it
        // is what the person will look for in the list.
        title: meeting.subject.slice(0, TITLE_MAX_CHARS),
        source: TRANSCRIPTION_SOURCES.TEAMS,
        // STRAIGHT TO `summarising`, skipping the states that exist only to
        // describe waiting for Speech. The transcript is already in hand; the
        // summary is all that is left, and the sweep already writes those.
        status: TRANSCRIPTION_STATUSES.SUMMARISING,
        // No media and no media type: nothing was uploaded and there is no
        // recording. See migration 014 for why these are nullable rather than
        // holding a key that points at nothing.
        storageKey: null,
        mediaType: null,
        sourceRef,
        byteSize: null,
        durationSeconds: durationSeconds > 0 ? durationSeconds : null,
        speechJobId: null,
        transcript: text,
        segments: JSON.stringify(segments),
        summary: null,
        error: null,
        // THE MEETING'S TIME, not now. The list is ordered by this, so an
        // import of last Tuesday's meeting belongs where last Tuesday is -
        // not at the top, above one somebody recorded an hour ago.
        createdAt: meeting.startsAt,
        updatedAt: now,
        completedAt: null,
      });
    } catch (error) {
      // Two clicks, or two tabs. The unique index on (user_id, source_ref) is
      // what stops the second becoming a duplicate; this is what stops it
      // becoming an error message about a constraint.
      const raced = await getTranscriptionBySourceRefRepo(user.id, TRANSCRIPTION_SOURCES.TEAMS, sourceRef);

      if (!raced) throw error;

      return mapDBTranscriptionToDetailDTO(raced);
    }

    revalidateTranscriptionViews();

    return mapDBTranscriptionToDetailDTO(created);
  } catch (error) {
    throw handleError("importTeamsMeetingService", error);
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

    // A Teams import has no media and no Speech job, so there is nothing
    // here to start or to retry. It cannot reach this in practice - it never
    // holds a startable status - but the column is nullable now, and a
    // narrowing check that also states the invariant is better than a
    // non-null assertion that assumes it.
    if (!transcription.storageKey) {
      throw new DisplayErrorMessage("That transcription has no recording to transcribe.");
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

    // A Teams import has no key and never had a recording; everything else
    // may or may not still hold one, and deleteIfExists makes an absent blob
    // a no-op rather than an error.
    if (transcription.storageKey && isMediaStorageConfigured()) {
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
// The recording itself, for download.
//
// Returns an open STREAM rather than bytes. A meeting recording is hundreds
// of megabytes and reading one into memory to hand back would hold all of
// it in the instance for the length of the transfer.
//
// Null when the recording is gone - a row whose media has aged out, or one
// transcribed back when recordings were deleted on success. The caller
// answers 404, which is what it looks like from the reader's side.
// -------------------------------------------------------------------
export async function getTranscriptionMediaService(requestDTO: TranscriptionIdRequestDTO): Promise<{
  stream: NodeJS.ReadableStream;
  mediaType: string;
  byteSize: number | null;
  fileName: string;
} | null> {
  try {
    const user = await requireUser();

    // Ownership FIRST. Storage is only touched once the row has been proved
    // to be this caller's, so an id that is not theirs never reaches a blob.
    const transcription = await requireOwnedTranscription(requestDTO.transcriptionId, user.id);

    if (!isMediaStorageConfigured()) return null;

    // No key means there was never a recording - a Teams import, where the
    // meeting was transcribed by Teams and nothing was ever uploaded here.
    // The same null a recording that has aged out gets, and the route turns
    // both into a 404: there is no file either way, and the caller does not
    // need to be told which kind of nothing it is.
    if (!transcription.storageKey || !transcription.mediaType) return null;

    const media = await openMediaStream(transcription.storageKey);

    if (!media) return null;

    const mediaType = transcription.mediaType;

    return {
      stream: media.stream,
      // The type recorded on the row, which the server derived from the
      // filename at upload - never the one storage reports back, which is
      // whatever the browser set on the blob.
      mediaType,
      byteSize: media.byteSize ?? transcription.byteSize,
      fileName: `${safeDownloadName(transcription.title, "")}${extensionForMediaType(mediaType)}`,
    };
  } catch (error) {
    throw handleError("getTranscriptionMediaService", error);
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
                `[${formatTimestamp(segment.startMs)}] ${speakerLabel(segment)}: ${segment.text}`,
            )
            .join("\n\n")
        : transcription.transcript;

    const header = [
      transcription.title,
      // In the app timezone, like every other date this app shows. A raw ISO
      // string would read as the wrong day for anybody who opens the file.
      `Recorded: ${formatDateTime(transcription.createdAt)}`,
      TRANSCRIPTION_SOURCE_DESCRIPTIONS[transcription.source],
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
