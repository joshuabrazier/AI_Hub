import "server-only";

import { ConverseStreamCommand, type Message, type SystemContentBlock } from "@aws-sdk/client-bedrock-runtime";
import { generateId } from "better-auth";

import {
  armTeamsAutoImportRepo,
  cancelTeamsAutoImportRepo,
  getDueTeamsAutoImportsRepo,
  getTeamsAutoImportForMeetingRepo,
  recordTeamsAutoImportAttemptRepo,
  settleTeamsAutoImportRepo,
} from "@/lib/data/repositories/teams-auto-import.repository";
import { FIRST_TRY_AFTER_MINUTES, isAutoImportWindowClosed } from "./auto-import-window";

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
  TEAMS_AUTO_IMPORT_STATUSES,
  TRANSCRIPTION_FILING_STATUSES,
  TRANSCRIPTION_STATUSES,
  type TranscriptionFiling,
  type TranscriptionFilingStatus,
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
  claimSummaryAttemptRepo,
  claimTranscriptionTransitionRepo,
  deleteTranscriptionForUserRepo,
  getAllInFlightTranscriptionsRepo,
  getInFlightTranscriptionsForUserRepo,
  getTranscriptionBySourceRefRepo,
  getTranscriptionForUserRepo,
  getTranscriptionSourceRefsForUserRepo,
  getTranscriptionsForUserRepo,
  releaseSummaryLeaseRepo,
  updateTranscriptionForUserRepo,
} from "@/lib/data/repositories/transcriptions.repository";
import { envServer } from "@/lib/env-server";
import { DisplayErrorMessage, isDisplayError } from "@/lib/errors";
import { safeDownloadName } from "@/lib/download-blob";
import { formatDateTime } from "@/lib/format";
import { handleError } from "@/lib/handle-errors";
import {
  MEETING_LOOKBACK_DAYS,
  TEAMS_TRANSCRIPT_ERRORS,
  fetchTranscriptVtt,
  findOnlineMeetingId,
  getTeamsMeeting,
  listMeetingTranscripts,
  listRecentTeamsMeetings,
} from "@/lib/graph/teams-meetings";
import { selectTranscriptForOccurrence } from "@/lib/graph/teams-occurrence";
import {
  eventIdFromSourceRef,
  parseTeamsVtt,
  teamsSegmentsToText,
  teamsSourceRef,
} from "@/lib/graph/teams-transcript";
import { type AudioProbe, describeAudioProbe, fatalAudioProblem } from "@/lib/media/audio-probe";
import { probeStoredMedia } from "@/lib/media/stored-media-probe";
import { isPushConfigured, sendPushToUser } from "@/lib/push/push-notifications";
import { ROUTES, transcriptionHomeForRole } from "@/lib/routes";
import { GRAPH_OUTCOMES, graphInnerErrorOf, graphOutcomeOf } from "@/lib/sharepoint/graph-client";
import { isFakeSharepointEnabled } from "@/lib/sharepoint/dev-fake";
import {
  createUploadUrl,
  deleteMedia,
  getMediaInfo,
  isMediaReachableByAzureServices,
  isMediaStorageConfigured,
  mediaBlobUrl,
  mediaStorageKey,
  nextMediaStorageKey,
  openMediaStream,
} from "@/lib/storage/media-storage";
import {
  deleteTranscriptionJob,
  describeFailureReport,
  getTranscriptionFailureDetail,
  getTranscriptionResult,
  getTranscriptionStatus,
  isSpeechConfigured,
  SpeechApiError,
  startTranscription,
  type SpeechJobStatus,
} from "@/lib/speech/speech-client";

import { mapDBTranscriptionToDetailDTO, mapDBTranscriptionToSummaryDTO } from "./transcription.mappers";
import { getTranscriptionFilingsForUserRepo } from "@/lib/data/repositories/transcription-filing.repository";

import { proposeTranscriptionFiling } from "./filing.service";
import {
  classifyTranscriptionFailure,
  TRANSCRIPTION_FAILURE_KINDS,
} from "./transcription-failure";
import { logTranscriptionFailure, type TranscriptionFailureStage } from "./transcription-logging";
import { revalidateTranscriptionViews } from "./transcription.revalidate";
import {
  MAX_MEDIA_BYTES,
  MAX_MEDIA_MINUTES,
  MAX_SUMMARY_ATTEMPTS,
  MAX_SUMMARY_INPUT_CHARS,
  SUMMARY_LEASE_MS,
  SUMMARY_MAX_TOKENS,
  SUMMARY_TIMEOUT_MS,
  TITLE_MAX_CHARS,
  TRANSCRIPTION_TIMEOUT_HOURS,
  extensionForMediaType,
  formatTimestamp,
  SUPPORTED_MEDIA_EXTENSIONS,
  mediaTypeForFileName,
  type ReplaceTranscriptionMediaRequestDTO,
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

// Said by both guards below, so the two cannot drift apart. Aimed at a
// developer, because that is the only person who can ever see it - a
// deployed environment has a real storage account by definition.
const UNREACHABLE_STORAGE_MESSAGE =
  "Transcription cannot run against local storage. Azure fetches the recording itself and cannot reach the emulator, so point AZURE_STORAGE_CONNECTION_STRING at a real storage account.";

// Bounds an error before it goes in the column. Both services this feature
// talks to can return a great deal of text, and the message is shown to the
// person who was waiting - it needs to be a paragraph, not a payload.
//
// RAISED FROM 300 when failures started carrying what the file actually is
// alongside what the service said about it. Three hundred characters was
// enough for "InvalidData: the audio format is invalid", which is precisely
// the message that helped nobody; a useful failure now reads more like a
// short paragraph, and truncating it mid-sentence would cut off the half
// that says what to do.
// -------------------------------------------------------------------
const MAX_ERROR_CHARS = 900;

function boundError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  return message.length > MAX_ERROR_CHARS ? `${message.slice(0, MAX_ERROR_CHARS)}...` : message;
}

// -------------------------------------------------------------------
// Join what several sources said into one readable paragraph.
//
// Each source writes in its own style - Azure ends some messages with a
// full stop and some without - so this adds the punctuation rather than
// trusting it, and drops the ones that had nothing to say. The alternative
// was joining with " - ", which produced sentences that ran together and
// read as one garbled message rather than three findings.
// -------------------------------------------------------------------
function joinSentences(parts: (string | null | undefined)[]): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0))
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(" ");
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
// The budgets live in transcription.types.ts, where a test can reach them
// without importing Bedrock. They describe one calculation and are only
// correct together - see the note there.

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
    // the model has finished, so the entire generation reads as one
    // uninterrupted silence to anything measuring inactivity. Opus writing
    // up to SUMMARY_MAX_TOKENS from an hour-long transcript takes minutes,
    // so every summary of a real meeting timed out and was retried by a
    // request that was never going to be any faster.
    //
    // The inactivity measure is BEDROCK_SOCKET_IDLE_MS in bedrock-client.ts.
    // An earlier version of this note named READ_TIMEOUT_MS and put it at
    // 120 seconds; that option was `requestTimeout`, which only logs a
    // warning and never aborted anything, so for a period there was no
    // inactivity timeout on Bedrock at all. See that file.
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
async function notifyFinished(
  transcription: Transcription,
  userId: string,
  // What filing decided, so the notification can say the one thing the
  // reader has to do. Null when filing is not set up, which is the case
  // where saying nothing about it is correct.
  filingStatus: TranscriptionFilingStatus | null = null,
): Promise<void> {
  if (!isPushConfigured()) return;

  const failed = transcription.status === TRANSCRIPTION_STATUSES.FAILED;

  // The ask, not the status. A lock screen has room for one sentence and it
  // should be the one that needs an answer.
  const needsApproval = filingStatus === TRANSCRIPTION_FILING_STATUSES.AWAITING_APPROVAL;

  // Looked up rather than passed in, because the background sweep has no
  // session - it acts on rows belonging to people who are not here.
  const owner = await getUserByUserIdRepo(userId);

  await sendPushToUser(userId, {
    title: failed ? "Transcription failed" : "Your transcription is ready",
    body: failed
      ? `"${transcription.title}" could not be transcribed. The recording is still here.`
      : needsApproval
        ? `"${transcription.title}" is ready. Confirm where to file it in SharePoint.`
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
// The two things that happen when a row stops moving: tell the person, and
// put the notes in SharePoint.
//
// ONE HELPER RATHER THAN TWO CALLS AT FOUR SITES. There are four ways a
// transcription reaches a terminal state - a Speech failure, a summary given
// up on, the poll finishing one, the sweep finishing one - and filing added
// at three of them would work perfectly until somebody noticed one kind of
// meeting never got filed. Working out which of the four it was would then
// take an afternoon.
//
// NEITHER HALF MAY THROW. The transcript is already stored by the time this
// runs, and losing a finished job over a push service or an unreachable
// SharePoint would be exactly backwards. notifyFinished is best-effort by
// construction; fileTranscription catches its own and reports into its own
// row. The catches here are the third belt, for whatever either of them
// fails to hold.
//
// Proposing for a FAILED row is a no-op inside proposeTranscriptionFiling
// rather than a condition here, so the rule lives with the thing that owns
// it.
// -------------------------------------------------------------------
async function finishTranscription(transcription: Transcription, userId: string): Promise<void> {
  // -----------------------------------------------------------------
  // THE PROPOSAL COMES FIRST, AND THE ORDER IS THE WHOLE POINT.
  //
  // Filing no longer happens on its own: a destination is proposed and
  // nothing reaches SharePoint until the person whose meeting it was says
  // yes. That trade is right - a note in another client's folder is a
  // confidentiality problem and an unfiled note is not - but it has an
  // obvious way to fail, which is that nobody ever looks and every meeting
  // quietly queues up unfiled.
  //
  // The notification is the answer to that, and it can only say so if it
  // knows. So this decides first and tells them second, and they get one
  // notification carrying the whole picture rather than "it is ready"
  // followed by silence about the thing that still needs them.
  //
  // Deciding is a model call, so this costs the notification a few seconds.
  // A push that arrives ten seconds later and says what to do beats one that
  // arrives instantly and does not.
  // -----------------------------------------------------------------
  let filing: TranscriptionFiling | null = null;

  try {
    filing = await proposeTranscriptionFiling(transcription, userId);
  } catch (error) {
    console.error(`finishTranscription: could not propose a folder for ${transcription.id}`, error);
  }

  try {
    await notifyFinished(transcription, userId, filing?.status ?? null);
  } catch (error) {
    console.error(`finishTranscription: could not notify about ${transcription.id}`, error);
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

  // `awaiting_media` is the browser's turn; a row stuck there is handled
  // below, once failWith exists to end one.
  if (transcription.status === COMPLETED || transcription.status === FAILED) {
    return transcription;
  }

  // -------------------------------------------------------------------
  // Give up on this row, and say why in both places it needs saying.
  //
  // THE SCREEN AND THE LOG GET DIFFERENT THINGS FROM THE SAME CALL, because
  // they are read by different people asking different questions. The
  // person waiting wants a sentence about their recording; whoever is
  // working out why this keeps happening wants one greppable line with the
  // row, the stage, the declared type and what the bytes actually were.
  // Producing them apart is how they drifted, and how a failure ended up
  // being visible on screen and invisible in the log.
  //
  // `stage` is not optional. It is the field every later question filters
  // on first, and a default would quietly collapse the distinction between
  // a job that failed and a summary that did.
  //
  // IT IS A CLAIMED WRITE, NOT AN UNCONDITIONAL ONE, and that is the part
  // that protects a transcript. Two sweeps run over the same row - a page
  // load and a poll, or two open tabs - and a slow one can arrive with bad
  // news about a job the fast one has already collected the result of. An
  // unguarded write then stamps FAILED over a row that holds a finished
  // transcript, and the person is shown an error for a meeting that
  // transcribed perfectly. The status predicate makes that impossible:
  // only a row still in flight can be failed.
  // -------------------------------------------------------------------
  const failWith = async (
    message: string,
    context: {
      stage: TranscriptionFailureStage;
      probe?: AudioProbe | null;
      extra?: Record<string, string | number | boolean | null | undefined>;
    } = { stage: "job" },
  ): Promise<Transcription> => {
    logTranscriptionFailure({
      stage: context.stage,
      transcription,
      reason: message,
      probe: context.probe,
      extra: context.extra,
    });

    const updated = await claimTranscriptionTransitionRepo(
      transcription.id,
      userId,
      // Every status from which failing is still the truth. COMPLETED is
      // deliberately absent, and so is FAILED - re-failing a failed row
      // would replace its original reason with a later, vaguer one.
      [AWAITING_MEDIA, QUEUED, TRANSCRIBING, SUMMARISING],
      {
        status: FAILED,
        error: message.slice(0, MAX_ERROR_CHARS),
      },
    );

    // The claim was refused, which means another sweep moved this row on
    // while this one was deciding. That row is the newer truth and is
    // returned untouched.
    if (!updated) {
      const current = await getTranscriptionForUserRepo(transcription.id, userId);

      return current ?? transcription;
    }

    await finishTranscription(updated, userId);

    return updated;
  };

  // -------------------------------------------------------------------
  // AN UPLOAD THAT NEVER ARRIVED.
  //
  // `awaiting_media` is the browser's turn, so this is normally not ours to
  // advance - but "normally" turned out to mean "forever": a tab closed
  // mid-upload leaves a row in this state that no sweep, no timeout and no
  // retry path could ever resolve. It sat in the list reading "Uploading"
  // indefinitely, and because the blob was never committed there was
  // nothing behind it either.
  //
  // Given the same ceiling as a job that hangs. The wording is the point:
  // it says the upload did not finish rather than blaming the recording, so
  // whoever finds it knows to send the file again rather than concluding
  // the file is bad.
  // -------------------------------------------------------------------
  if (transcription.status === AWAITING_MEDIA) {
    const waitingHours = (Date.now() - transcription.createdAt.getTime()) / (60 * 60 * 1000);

    if (waitingHours > TRANSCRIPTION_TIMEOUT_HOURS) {
      return failWith(
        `The upload never finished, and this has been waiting ${TRANSCRIPTION_TIMEOUT_HOURS} hours for it. If the recording is still on the device that made it, it can be sent again from the recording screen.`,
        { stage: "start", extra: { neverUploaded: true } },
      );
    }

    return transcription;
  }

  // The transcript is already stored and only the summary is outstanding -
  // a summariser failure, or a tab closed between the two calls.
  //
  // CHECKED BEFORE THE TIMEOUT BELOW, and that ordering is load-bearing: a
  // row in this state already has the thing the person was waiting for, and
  // timing it out would mark a perfectly good transcript as failed and hide
  // it. Nothing can be stuck here anyway - summariseTranscript does not
  // throw, so this branch always resolves the row.
  if (transcription.status === SUMMARISING) {
    // Left where it is for the poll to pick up. Nothing is lost by waiting:
    // the transcript is stored and the screen already says "Summarising".
    // Checked BEFORE the claim, so a page-load sweep does not spend one of
    // this row's attempts on work it is not allowed to do.
    if (!allowSummarise) return transcription;

    // -----------------------------------------------------------------
    // THE CLAIM COMES FIRST, and that ordering is the whole point of it.
    //
    // It used to come after the model call, which meant it decided who got
    // to WRITE the summary rather than who got to PAY for one. Every sweep
    // that found the row began its own - every open tab polls every six
    // seconds, the page-load sweep runs, the background sweep runs - so one
    // meeting was summarised three times inside ninety seconds and paid for
    // all three, with only the last one's work kept.
    //
    // One statement leases the row, counts the attempt and enforces the cap
    // together; see the repository for why it cannot be split.
    // -----------------------------------------------------------------
    const claimed = await claimSummaryAttemptRepo(transcription.id, userId, {
      leaseExpiresBefore: new Date(Date.now() - SUMMARY_LEASE_MS),
      maxAttempts: MAX_SUMMARY_ATTEMPTS,
    });

    if (!claimed) {
      // Refused for one of two reasons, and they need different answers.
      const current = await getTranscriptionForUserRepo(transcription.id, userId);

      // Somebody else is summarising it right now, or it has already moved
      // on. Leave it alone - their run will finish it.
      if (!current || current.status !== SUMMARISING) return current ?? transcription;

      if (current.summaryAttempts < MAX_SUMMARY_ATTEMPTS) return current;

      // Out of attempts. The row is completed WITHOUT a summary rather than
      // retried forever: the transcript is already stored, so this loses
      // nothing but the prose, and the screen offers to write it by hand.
      // -------------------------------------------------------------
      // KEEP WHY. This line used to overwrite the error column with a
      // sentence saying only that the summary had not worked - destroying
      // the last attempt's actual reason, which was the one record anywhere
      // of whether three attempts had hit a timeout, a throttle or a
      // misconfiguration. Three identical unexplained failures look like
      // flakiness; three timeouts look like a budget that is too tight.
      // -------------------------------------------------------------
      const givenUp = await claimTranscriptionTransitionRepo(transcription.id, userId, [SUMMARISING], {
        status: COMPLETED,
        error: joinSentences([
          `The summary could not be generated after ${MAX_SUMMARY_ATTEMPTS} attempts. The transcript is unaffected`,
          current.error ? `The last attempt reported: ${current.error}` : null,
        ]).slice(0, MAX_ERROR_CHARS),
        completedAt: new Date(),
        summaryStartedAt: null,
      });

      logTranscriptionFailure({
        stage: "summary",
        transcription: current,
        reason: current.error ?? "no reason recorded",
        extra: { attempts: current.summaryAttempts, transcriptChars: current.transcript?.length },
      });

      if (givenUp) await finishTranscription(givenUp, userId);

      return givenUp ?? current;
    }

    const { summary, error } = await summariseTranscript(claimed, userId);

    const updated = await claimTranscriptionTransitionRepo(claimed.id, userId, [SUMMARISING], {
      status: COMPLETED,
      summary,
      error,
      completedAt: new Date(),
      // The lease is done with either way - the row is leaving `summarising`.
      summaryStartedAt: null,
    });

    // Only the run that WON the claim notifies. Two sweeps arriving together
    // would otherwise send the same person the same notification twice.
    if (updated) await finishTranscription(updated, userId);

    // The summary failed but attempts remain. The lease is released so the
    // next sweep can try again rather than waiting for it to expire - a
    // failure that took two seconds should not hold the row for four
    // minutes.
    if (!updated && !summary) await releaseSummaryLeaseRepo(claimed.id, userId);

    return updated ?? (await getTranscriptionForUserRepo(claimed.id, userId)) ?? claimed;
  }

  if (!transcription.speechJobId) {
    // Queued with no job id means startTranscription did not get as far as
    // writing one. The file is still there, so this is retryable.
    return failWith("This was never handed to the transcription service. Try again.", {
      stage: "start",
    });
  }

  let job: SpeechJobStatus;

  try {
    job = await getTranscriptionStatus(transcription.speechJobId);
  } catch (error) {
    // -----------------------------------------------------------------
    // NOT EVERY FAILURE TO ASK IS A REASON TO WAIT, and treating them alike
    // was wrong in a way nobody could see.
    //
    // A 429 or a 503 means the service is busy: the work is still running
    // there, the next poll will ask again, and failing the row would throw
    // away a recording over something that fixes itself. That was the whole
    // justification for swallowing these - and it was applied to all of
    // them.
    //
    // A 401 or a 403 is a Speech key that has been rotated or a resource
    // that has been locked down. It will answer identically on every poll
    // for as long as anybody cares to wait, so swallowing it leaves the row
    // saying "Transcribing" indefinitely, with nothing on the screen and
    // nothing in the row to say why. An expired key looked exactly like a
    // slow meeting, forever.
    // -----------------------------------------------------------------
    const speechError = error instanceof SpeechApiError ? error : null;

    // -----------------------------------------------------------------
    // A 404 IS NOT A REFUSAL. It means the job is no longer on the Speech
    // service - which is the NORMAL end state, because this app deletes a
    // job once its result is safely stored, and Azure clears them on its
    // own retention besides. Treating it as terminal would fail a row for
    // the crime of having already succeeded: a second tab polling a
    // transcription the first tab has just completed hits exactly this.
    //
    // The row is re-read rather than assumed, because whatever moved it on
    // is the newer truth.
    // -----------------------------------------------------------------
    if (speechError?.status === 404) {
      const current = await getTranscriptionForUserRepo(transcription.id, userId);

      if (current && current.status !== QUEUED && current.status !== TRANSCRIBING) return current;
    }

    if (speechError && !speechError.isTransient && speechError.status !== 404) {
      return failWith(
        joinSentences([
          "The transcription service refused to say how this job is going, and it will keep refusing",
          speechError.status === 401 || speechError.status === 403
            ? "This is a credentials problem on the transcription service rather than anything wrong with your recording - an administrator needs to check the Speech key. Your recording is safe and can be downloaded"
            : speechError.message,
        ]),
        { stage: "job", extra: { azureStatus: speechError.status, azureCode: speechError.code } },
      );
    }

    // -----------------------------------------------------------------
    // TRANSIENT IS NOT THE SAME AS FOREVER, and the early return below made
    // them the same thing. Leaving the row alone is right for a 429 or a
    // 503 - the work is still running on the service and the next poll will
    // ask again - but the age check that ends a job nobody can reach lives
    // further down this function, PAST this return. So a fault that never
    // cleared was retried politely until the end of time, and the row said
    // "Transcribing" for as long as anybody cared to look.
    //
    // The same ceiling applies here as to a job that is genuinely running:
    // past it, this stops.
    // -----------------------------------------------------------------
    const unreachableFor = Date.now() - (transcription.updatedAt ?? transcription.createdAt).getTime();

    if (unreachableFor > TRANSCRIPTION_TIMEOUT_HOURS * 60 * 60 * 1000) {
      return failWith(
        joinSentences([
          `The transcription service could not be reached for ${TRANSCRIPTION_TIMEOUT_HOURS} hours, so this has been stopped`,
          speechError?.message,
          "The recording is still here, so you can try again",
        ]),
        {
          stage: "timeout",
          extra: { azureStatus: speechError?.status, unreachable: true },
        },
      );
    }

    // Transient, and not yet old enough to give up on. Left alone for the
    // next poll, and logged with enough to see a pattern.
    console.warn(
      `[transcription] status poll failed id=${transcription.id} job=${transcription.speechJobId} ${speechError ? speechError.summary : "unrecognised"}`,
      error,
    );

    return transcription;
  }

  if (job.state === "Failed") {
    // -----------------------------------------------------------------
    // READ THE REPORT BEFORE GIVING UP, and do NOT delete the job.
    //
    // The job-level error is too coarse to act on: "InvalidData: The
    // recordings URI contains invalid data" is returned when the blob could
    // not be READ, when the bytes were not audio, and when the audio could
    // not be DECODED. Those need an Azure role change, a re-upload and a
    // re-encode respectively - and collapsed into one sentence, every
    // failure reads as "transcription is broken again".
    //
    // Azure writes the per-file reason into a TranscriptionReport alongside
    // the transcript. This used to delete the job on the same line it
    // failed, which destroyed that report before anything read it - so the
    // one place the real reason was written down was removed at exactly the
    // moment somebody needed it.
    //
    // The job is now LEFT for Azure's own retention to clear. It holds no
    // audio, only the outcome.
    // -----------------------------------------------------------------
    // -----------------------------------------------------------------
    // ===================================================================
    // SAY WHAT WENT WRONG, NOT THAT SOMETHING DID
    // ===================================================================
    //
    // Three sources, and each answers something the others cannot:
    //
    //   the JOB error       Azure's headline. "InvalidData" - accurate,
    //                       and returned for at least three unrelated
    //                       faults, so on its own it is close to useless.
    //   the REPORT          Azure's own per-file log, which distinguishes
    //                       a blob it could not fetch from bytes it could
    //                       not decode.
    //   the BYTES           what we actually stored. Neither of Azure's
    //                       answers says whether the recording is a video
    //                       with no audio in it, two takes joined
    //                       together, or forty megabytes of nothing - and
    //                       that is nearly always the real question.
    //
    // The third is why the probe exists. The row records a media type
    // DERIVED FROM A FILENAME, which is a claim, and this feature has
    // already been misled by one: a WAV still named .m4a was handed back to
    // Azure as the very thing it had just refused. Reading the header
    // settles it.
    //
    // ALL THREE ARE BEST EFFORT and the order is deliberate: Azure's own
    // words first, because they are what an administrator will search for,
    // then what the file is, because that is what the person waiting can
    // act on.
    //
    // The job is LEFT for Azure's own retention to clear - it holds no
    // audio, only the outcome. It used to be deleted on the same line that
    // failed the row, which destroyed the report before anything read it.
    // -----------------------------------------------------------------
    const report = await getTranscriptionFailureDetail(transcription.speechJobId);

    const probe = transcription.storageKey ? await probeStoredMedia(transcription.storageKey) : null;

    // The blob URL in the report names the storage account and container,
    // so it goes to the log and never to the screen.
    const sources = (report?.failures ?? [])
      .map((failure) => failure.source)
      .filter((source): source is string => Boolean(source));

    // The file stays. The person may want to convert it and try again
    // rather than find the meeting gone.
    return failWith(
      joinSentences([
        job.error
          ? [job.error.code, job.error.message].filter(Boolean).join(": ")
          : "The transcription service could not process this recording.",
        describeFailureReport(report),
        probe ? describeAudioProbe(probe) : null,
      ]),
      {
        stage: "job",
        probe,
        extra: {
          azureCode: job.error?.code,
          reportFailed: report?.failedCount,
          reportSucceeded: report?.successCount,
          errorKind: report?.failures[0]?.errorKind,
          source: sources[0],
        },
      },
    );
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
    // -----------------------------------------------------------------
    // THE AGE OF THE JOB, NOT OF THE ROW, and the difference loses meetings.
    //
    // createdAt is when the RECORDING was made. A meeting recorded on Friday
    // and retried on Monday starts a brand new Speech job with a row that is
    // three days old - so the very first poll of that new job aged it out
    // and failed it instantly, and every retry after that did the same. The
    // recording was fine and unreachable.
    //
    // updatedAt is stamped by every patch this service makes, including the
    // one that stores the new speechJobId on a retry, so it tracks the job
    // rather than the recording. It also advances on each status transition,
    // which is the right direction: a job that is visibly progressing is not
    // a job that has hung.
    // -----------------------------------------------------------------
    // -----------------------------------------------------------------
    // AZURE'S OWN TIMESTAMP, WHERE IT GAVE ONE. lastActionDateTime is
    // documented as "when the current status was entered", which is the
    // exact fact this check wants and the exact fact the two heuristics
    // below only approximate. updatedAt tracks the job better than
    // createdAt does - it is stamped when a retry stores a new job id - but
    // it also moves on every status transition, so it drifts; and createdAt
    // is when the RECORDING was made, which on a Monday retry of a Friday
    // meeting is three days before the job existed.
    // -----------------------------------------------------------------
    const jobStartedAt = job.lastActionAt ?? transcription.updatedAt ?? transcription.createdAt;
    const ageHours = (Date.now() - jobStartedAt.getTime()) / (60 * 60 * 1000);

    if (ageHours > TRANSCRIPTION_TIMEOUT_HOURS) {
      await deleteTranscriptionJob(transcription.speechJobId);

      return failWith(
        `This did not finish within ${TRANSCRIPTION_TIMEOUT_HOURS} hours and has been stopped. The recording is still here, so you can try again.`,
        { stage: "timeout" },
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
    // -----------------------------------------------------------------
    // THE SAME FAULT, TREATED OPPOSITELY DEPENDING ON WHICH CALL MET IT.
    // A 429 asking for the STATUS was tolerated and retried; the identical
    // 429 asking for the RESULT failed the row outright - and this one is
    // worse, because the transcript exists on the service and the row is
    // marked failed anyway. The next poll would have collected it.
    // -----------------------------------------------------------------
    const speechError = error instanceof SpeechApiError ? error : null;

    if (speechError?.isTransient) {
      console.warn(
        `[transcription] result read failed, will retry id=${transcription.id} job=${transcription.speechJobId} ${speechError.summary}`,
      );

      return transcription;
    }

    console.error(`advanceTranscription: could not read the result of job ${transcription.speechJobId}`, error);

    return failWith(boundError(error), { stage: "result" });
  }

  if (result.text.trim().length === 0) {
    await deleteTranscriptionJob(transcription.speechJobId);

    // -----------------------------------------------------------------
    // THE SERVICE SUCCEEDED AND HEARD NOTHING, which is the one failure
    // that is not about the file being unreadable - and is therefore the
    // one where "check your microphone" is sometimes the wrong advice.
    //
    // The bytes often say which. A video track with no audio in it, or a
    // recording lasting two seconds, explains an empty transcript
    // completely; a full hour of Opus does not, and points at the room or
    // the language instead. Both are worth more than the same sentence.
    // -----------------------------------------------------------------
    const probe = transcription.storageKey ? await probeStoredMedia(transcription.storageKey) : null;

    return failWith(
      joinSentences([
        "No speech was recognised in this recording. Check that the microphone was picking up the room, and that the language matches.",
        probe ? describeAudioProbe(probe) : null,
      ]),
      { stage: "result", probe },
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

  if (completed) await finishTranscription(completed, userId);

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

    // ONE QUERY FOR THE WHOLE LIST, not one per row. Filing is the part of
    // this feature that happens with nobody watching, so its status belongs
    // on every row rather than only on the one that happens to be open - a
    // status you have to open something to see is one you only find when you
    // already suspect it.
    const filings = await getTranscriptionFilingsForUserRepo(
      rows.map((row) => row.id),
      user.id,
    );

    const filingByTranscription = new Map(filings.map((filing) => [filing.transcriptionId, filing]));

    const transcriptions = rows.map((row) =>
      mapDBTranscriptionToSummaryDTO(row, filingByTranscription.get(row.id)),
    );

    const requested = transcriptionId
      ? transcriptions.find((item) => item.id === transcriptionId)
      : undefined;

    const target = requested ?? transcriptions[0];

    // The list read deliberately leaves out the heavy columns, so opening
    // one is a second, narrower query rather than a page that carries every
    // transcript it can see.
    const activeRow = target ? await getTranscriptionForUserRepo(target.id, user.id) : undefined;

    // The open row's filing, taken from the list read above rather than
    // fetched again: it is the same row, and a second query could disagree
    // with the first if a sweep landed between them.
    const activeFiling = activeRow ? filingByTranscription.get(activeRow.id) : undefined;

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
      active: activeRow ? mapDBTranscriptionToDetailDTO(activeRow, activeFiling) : null,
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
  // -----------------------------------------------------------------
  // THE INNER ERROR IS CHECKED FIRST, AND THAT ORDER IS THE WHOLE POINT.
  //
  // Both of these arrive as a 403, which the generic client classifies as
  // NEEDS_REAUTH because that is what a 403 usually means. Neither is. They
  // are tenant-wide Teams settings, both OFF by default in every tenant, and
  // neither can be fixed by the person who met the error - so "sign out and
  // sign in again" is advice that can never work, offered forever, on the two
  // failures a new deployment is most likely to hit first.
  //
  // Branching on the code rather than the message is Microsoft's own
  // instruction: the messages are documented as subject to change.
  // -----------------------------------------------------------------
  switch (graphInnerErrorOf(error)) {
    case TEAMS_TRANSCRIPT_ERRORS.GRAPH_ACCESS_DISABLED:
      return new DisplayErrorMessage(
        "This organisation has not allowed apps to read Teams meeting transcripts. An administrator has to turn on Teams admin centre, Meetings, Meeting settings, Transcript API access, Microsoft Graph access. Signing in again will not help.",
      );

    case TEAMS_TRANSCRIPT_ERRORS.ATTRIBUTION_DISABLED:
      // Deliberately NOT retried without attribution. The unattributed format
      // is a different shape this parser cannot read, so a silent fallback
      // would turn a visible refusal into an empty transcript - and the names
      // are the entire reason to import from Teams rather than record.
      return new DisplayErrorMessage(
        "This organisation has speaker names turned off for transcripts read by apps, and a transcript without them is not worth importing. An administrator has to turn on Include speaker attribution alongside Transcript API access.",
      );
  }

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
      return { isConfigured: false, lookbackDays: MEETING_LOOKBACK_DAYS, meetings: [], truncated: false };
    }

    let listed;

    try {
      listed = await listRecentTeamsMeetings(user.id);
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
      truncated: listed.truncated,
      meetings: listed.meetings.map(
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
// -------------------------------------------------------------------
// The import, for the SIGNED-IN person.
//
// A thin wrapper. Everything below it is in importTeamsMeetingForUser, which
// the background sweep also calls - see the note there about why the actor is
// a parameter in one and a session lookup in the other.
// -------------------------------------------------------------------
export async function importTeamsMeetingService(
  requestDTO: ImportTeamsMeetingRequestDTO,
): Promise<TranscriptionDetailDTO> {
  try {
    const user = await requireUser();

    return await importTeamsMeetingForUser(user.id, requestDTO.eventId);
  } catch (error) {
    throw handleError("importTeamsMeetingService", error);
  }
}

// -------------------------------------------------------------------
// The import itself, for a NAMED user.
//
// THE USER ID IS A PARAMETER HERE AND THAT IS A REAL DECISION, because
// everywhere else in this app the actor comes from the session and a
// parameter naming somebody else is the shape of a privilege escalation.
//
// It is safe for exactly one reason: this is not exported beyond the module
// and its only two callers are the wrapper above, which passes the session
// user, and the auto-import sweep, which passes the user_id off a row that
// person armed themselves. Nothing takes a user id from a request.
//
// The Graph calls remain DELEGATED - they run on that person's own refresh
// token - so Microsoft still enforces that they were in the meeting. This
// function cannot reach a transcript its user could not open by hand.
// -------------------------------------------------------------------
async function importTeamsMeetingForUser(
  userId: string,
  eventId: string,
): Promise<TranscriptionDetailDTO> {
  try {

    if (!isTeamsImportConfigured()) {
      throw new DisplayErrorMessage(
        "Importing from Teams needs Microsoft sign-in, which is not configured on this environment.",
      );
    }

    let meeting;
    let onlineMeetingId: string | null;
    let transcripts;

    try {
      meeting = await getTeamsMeeting(userId, eventId);

      if (!meeting) {
        throw new DisplayErrorMessage("That meeting is no longer in your calendar.");
      }

      onlineMeetingId = await findOnlineMeetingId(userId, meeting.joinUrl);

      if (!onlineMeetingId) {
        // The signature of a meeting somebody else's organisation hosted.
        // Named as such rather than reported as a failure, because it is not
        // one - and because the answer is the recorder, which is on the next
        // tab along.
        throw new DisplayErrorMessage(
          "Microsoft has no record of that meeting. It was most likely hosted on another organisation's Teams, in which case they hold the transcript - record it here instead.",
        );
      }

      transcripts = await listMeetingTranscripts(userId, onlineMeetingId);
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

    // -----------------------------------------------------------------
    // WHICH of the series' transcripts is THIS meeting's.
    //
    // Not a formality, and not answerable by ordering. Every occurrence of a
    // recurring meeting shares one join URL, so `onlineMeetingId` above is
    // the SERIES and these transcripts belong to any occurrence of it.
    //
    // Taking the newest - which this used to do - handed somebody the wrong
    // meeting entirely: a weekly series transcribed once months ago had that
    // one transcript stored under today's date and title, silently. See
    // teams-occurrence.ts, where the reported case is the first test.
    // -----------------------------------------------------------------
    const selection = selectTranscriptForOccurrence(transcripts, {
      startsAt: meeting.startsAt,
      endsAt: meeting.endsAt,
    });

    if (selection.kind === "undateable") {
      throw new DisplayErrorMessage(
        "Microsoft did not say when that meeting's transcript was made, so it cannot be matched to this meeting. Record it here instead.",
      );
    }

    if (selection.kind === "no-transcript-for-occurrence") {
      // Deliberately a different sentence from "this meeting has no
      // transcripts at all", because the remedy is different and the reason
      // is not obvious: the series HAS transcripts, just not for the day
      // being imported.
      throw new DisplayErrorMessage(
        "No transcript was made for this particular meeting. Other meetings in the same recurring series do have one, but transcription has to be started during each meeting separately.",
      );
    }

    const transcript = selection.transcript;

    const sourceRef = teamsSourceRef(meeting.eventId, transcript.id);

    // Already imported. Answered with the row that exists rather than
    // refused: somebody who clicks Import on a meeting they did last week
    // wants to READ it, and opening it is what they meant.
    const existing = await getTranscriptionBySourceRefRepo(userId, TRANSCRIPTION_SOURCES.TEAMS, sourceRef);

    if (existing) return mapDBTranscriptionToDetailDTO(existing);

    let vtt: string;

    try {
      vtt = await fetchTranscriptVtt(userId, onlineMeetingId, transcript.id);
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
        userId: userId,
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
      const raced = await getTranscriptionBySourceRefRepo(userId, TRANSCRIPTION_SOURCES.TEAMS, sourceRef);

      if (!raced) throw error;

      return mapDBTranscriptionToDetailDTO(raced);
    }

    revalidateTranscriptionViews();

    return mapDBTranscriptionToDetailDTO(created);
  } catch (error) {
    throw handleError("importTeamsMeetingForUser", error);
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
      // -----------------------------------------------------------------
      // SAY WHICH EXTENSION, because this refusal has been hit on a .webm -
      // the format the recorder itself produces and which is in the table
      // right above. That can only mean the name arriving here is not the
      // name anybody thinks it is, and the old message gave nobody a way to
      // find out which.
      //
      // THE EXTENSION ONLY, never the whole filename. An uploaded file is
      // named by the person who chose it and can carry a client's name or a
      // matter number; the extension is the entire diagnostic and carries
      // none of that. `source` travels with it because it separates the two
      // paths that build a name - a recording is named by this app, an
      // upload by whoever made the file - and that is the first fork any
      // investigation takes.
      //
      // An empty extension prints as (none), which is the shape a name with
      // no dot in it makes and is otherwise invisible in a log line.
      // -----------------------------------------------------------------
      const extension = requestDTO.fileName.toLowerCase().slice(
        requestDTO.fileName.lastIndexOf("."),
      );
      const shown = requestDTO.fileName.includes(".") ? extension : "(none)";

      console.warn(
        `[transcription] refused an upload: extension=${shown} source=${requestDTO.source}`,
      );

      throw new DisplayErrorMessage(
        `That is not a file type this can transcribe (${shown}). Recordings should be .webm, and uploads can be ${SUPPORTED_MEDIA_EXTENSIONS.slice(0, 4).join(", ")} and others.`,
      );
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
    const upload = await createUploadUrl(storageKey);

    revalidateTranscriptionViews();

    return { transcriptionId, uploadUrl: upload.url, mediaType, expiresAt: upload.expiresAt };
  } catch (error) {
    throw handleError("createTranscriptionService", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// A FRESH UPLOAD URL FOR AN UPLOAD ALREADY IN PROGRESS
// ===================================================================
//
// The SAS is signed for an hour, and a long recording on a client site's
// broadband can take longer than that. The upload then met a 403 part way
// through - after twenty minutes of somebody's afternoon, on a meeting that
// cannot be re-recorded - and nothing could tell that from a permissions
// problem, so it was not even retried.
//
// RESUMING COSTS NOTHING, which is what makes this worth having rather than
// merely possible. Blocks are STAGED: Azure holds them for seven days and
// the blob does not exist until Put Block List commits them. So a refreshed
// URL can carry on from the block it stopped at, and the blocks already
// sent are still there waiting.
//
// IT GRANTS NOTHING NEW. The same key, derived from a row this caller is
// proved to own, with the same write-only permission for the same hour -
// so a refresh is the credential the caller already had, re-issued. The
// only way to get one is to own a row that is still waiting for its media.
// -------------------------------------------------------------------
export async function refreshTranscriptionUploadUrlService(
  requestDTO: TranscriptionIdRequestDTO,
): Promise<TranscriptionUploadTicketDTO> {
  try {
    const user = await requireUser();

    const transcription = await requireOwnedTranscription(requestDTO.transcriptionId, user.id);

    if (!isMediaStorageConfigured()) {
      throw new DisplayErrorMessage("Transcription storage is not configured on this environment.");
    }

    // ONLY A ROW STILL WAITING FOR ITS MEDIA. A queued or completed row has
    // a file behind it that something is already working on, and handing
    // out a write credential for that blob would let a second tab overwrite
    // a transcript's own source.
    if (transcription.status !== TRANSCRIPTION_STATUSES.AWAITING_MEDIA) {
      throw new DisplayErrorMessage("That upload has already finished.");
    }

    if (!transcription.storageKey || !transcription.mediaType) {
      throw new DisplayErrorMessage("That transcription has no upload to continue.");
    }

    const upload = await createUploadUrl(transcription.storageKey);

    return {
      transcriptionId: transcription.id,
      uploadUrl: upload.url,
      mediaType: transcription.mediaType,
      expiresAt: upload.expiresAt,
    };
  } catch (error) {
    throw handleError("refreshTranscriptionUploadUrlService", error);
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
      // -----------------------------------------------------------------
      // WHY THE FILE IS MISSING DECIDES WHAT TO SAY. An over-size refusal
      // DELETES the media - correctly, because nothing will ever transcribe
      // it - and the retry then found no blob and reported an upload that
      // had not finished. That is a sentence inviting somebody to press a
      // button which removes a file that is already gone, forever, and it
      // was the wrong diagnosis besides.
      // -----------------------------------------------------------------
      const previously = classifyTranscriptionFailure(transcription.error);

      throw new DisplayErrorMessage(
        previously === TRANSCRIPTION_FAILURE_KINDS.TOO_LARGE
          ? joinSentences([
              "This recording was too large for the transcription service, so it is no longer stored and cannot be tried again",
              transcription.error,
            ])
          : "The recording did not finish uploading. Try again.",
      );
    }

    if (media.byteSize > MAX_MEDIA_BYTES) {
      const tooLarge = `That file is larger than the ${Math.round(MAX_MEDIA_BYTES / (1024 * 1024))} MB the transcription service accepts.`;

      // Removed rather than left to age out: it is over the limit, nothing
      // will ever transcribe it, and it would otherwise be the largest thing
      // in the container for the length of the retention window.
      await deleteMedia(transcription.storageKey);

      logTranscriptionFailure({
        stage: "start",
        transcription,
        reason: tooLarge,
        extra: { actualBytes: media.byteSize, limitBytes: MAX_MEDIA_BYTES },
      });

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

    // -----------------------------------------------------------------
    // ===================================================================
    // READ THE HEADER BEFORE PAYING ANYBODY TO READ THE FILE
    // ===================================================================
    //
    // The bytes are in storage and a Speech job takes minutes, so the cheap
    // question comes first: is this a thing that could ever transcribe? A
    // video with no audio track, a file whose beginning was never written,
    // or an empty container cannot, and finding that out from Azure costs a
    // job, a wait, and a sentence that does not say which of them it was.
    //
    // THIS IS ALSO WHERE THE DECLARED TYPE IS CHECKED AGAINST REALITY. The
    // row's media type was derived from a FILENAME, which is a claim; this
    // reads what is actually there. The two disagreeing has already caused
    // a real failure in this feature - a converted WAV still named .m4a was
    // handed to Azure as the very thing it had just refused - so the
    // mismatch is recorded rather than assumed away.
    //
    // IT ONLY REFUSES WHAT CANNOT WORK. The list is fatalAudioProblem's,
    // shared with the browser check, and an unrecognised container is not
    // on it: the probe knows six formats and Azure accepts more.
    // -----------------------------------------------------------------
    const probe = await probeStoredMedia(transcription.storageKey, media.byteSize);

    const fatal = probe ? fatalAudioProblem(probe) : null;

    if (probe && fatal) {
      const message = joinSentences([fatal.detail, describeAudioProbe(probe)]);

      logTranscriptionFailure({
        stage: "start",
        transcription,
        reason: message,
        probe,
        extra: { refusedBefore: "speech-job" },
      });

      // The media stays. It is the person's recording, they may want to
      // download it, and nothing here has proved it is worthless - only
      // that this service will not transcribe it.
      await updateTranscriptionForUserRepo(transcription.id, user.id, {
        status: TRANSCRIPTION_STATUSES.FAILED,
        error: message.slice(0, MAX_ERROR_CHARS),
      });

      revalidateTranscriptionViews();

      throw new DisplayErrorMessage(message);
    }

    // -----------------------------------------------------------------
    // THE LENGTH CEILING, WHICH IS SEPARATE FROM THE SIZE ONE AND WAS NOT
    // CHECKED AT ALL. Diarization caps a file at 240 minutes and this app
    // always asks for diarization, so a five hour workshop - well under a
    // gigabyte at any sensible bitrate - was accepted, uploaded, queued,
    // and then refused by Azure with a sentence about invalid audio.
    //
    // Only refused on a duration the FILE DECLARES. A container that does
    // not carry one is let through: unknown is not long, and the whole
    // point of reading the header is to stop guessing.
    // -----------------------------------------------------------------
    // NOT ON A GUESS. An MP3 carries no length, so its duration here is
    // derived from the file size and one frame's bitrate - which is wrong
    // for every variable-bitrate file, and most are. Refusing a recording
    // outright is a decision that has to rest on a figure the file actually
    // states; where it does not, the ceiling is left to Azure, which has
    // decoded the audio and knows.
    if (
      probe?.durationSeconds &&
      !probe.durationIsEstimated &&
      probe.durationSeconds > MAX_MEDIA_MINUTES * 60
    ) {
      const tooLong = `That recording is ${Math.round(probe.durationSeconds / 60)} minutes long, and the transcription service accepts up to ${MAX_MEDIA_MINUTES} minutes in one file when it is separating speakers. Split it and upload the parts, or record longer meetings in sections.`;

      logTranscriptionFailure({
        stage: "start",
        transcription,
        reason: tooLong,
        probe,
        extra: { refusedBefore: "speech-job", limitMinutes: MAX_MEDIA_MINUTES },
      });

      // The media STAYS, unlike the size refusal - it is within the size
      // limit, the person can download it, and splitting it is something
      // they may want to do from the original.
      await updateTranscriptionForUserRepo(transcription.id, user.id, {
        status: TRANSCRIPTION_STATUSES.FAILED,
        error: tooLong,
      });

      revalidateTranscriptionViews();

      throw new DisplayErrorMessage(tooLong);
    }

    if (probe && probe.container && transcription.mediaType) {
      const declared = transcription.mediaType;
      const detected = probe.container.toLowerCase();

      // Logged, never acted on. Azure sniffs the bytes rather than trusting
      // a content type, so a mismatch is not itself a failure - but it is
      // the first thing worth knowing when one happens, and it is invisible
      // everywhere else.
      if (!declared.toLowerCase().includes(detected)) {
        console.warn(
          `[transcription] type mismatch id=${transcription.id} declared=${declared} detected=${probe.container}`,
        );
      }
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
      logTranscriptionFailure({
        stage: "start",
        transcription,
        reason: boundError(error),
        probe,
        extra: { locale: envServer.AZURE_SPEECH_LOCALE },
      });

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
// ===================================================================
// TRYING AGAIN WITH DIFFERENT BYTES
// ===================================================================
//
// The "Try again" button on a failed row hands Azure the same file a second
// time. For a transient fault that is exactly right. For the commonest
// failure this feature has - the service downloaded the recording and could
// not decode it - it can never work, and it was being offered as though it
// might.
//
// So there is a second rung: re-encode the media and try THAT. The browser
// does the encoding, because ffmpeg is not on the App Service Node runtime
// and the device already has, or can fetch, the file. These two services
// are the server half - claim a destination, then accept the result.
//
// WHY TWO STEPS RATHER THAN ONE. The bytes never pass through the app; the
// browser writes them straight to storage on a write-only URL, exactly as a
// first upload does. Something has to sign that URL before, and something
// has to verify what landed after, and nothing can happen in between.
//
// WHAT THE BROWSER DOES NOT GET TO DECIDE. Not the destination - the key is
// computed from the row the server looked up - and not the media type,
// which is derived from the name on both steps. A `fileName` is a label and
// a source of an extension, and nothing else.
// -------------------------------------------------------------------
export async function replaceTranscriptionMediaService(
  requestDTO: ReplaceTranscriptionMediaRequestDTO,
): Promise<TranscriptionUploadTicketDTO> {
  try {
    const user = await requireUser();

    const transcription = await requireOwnedTranscription(requestDTO.transcriptionId, user.id);

    if (!isMediaStorageConfigured() || !isSpeechConfigured()) {
      throw new DisplayErrorMessage("Transcription is not configured on this environment.");
    }

    // Same check as a first upload and for the same reason: there is no
    // point re-encoding a meeting to put it somewhere Azure cannot read.
    if (!isMediaReachableByAzureServices()) {
      throw new DisplayErrorMessage(UNREACHABLE_STORAGE_MESSAGE);
    }

    const { mediaType, storageKey } = replacementTargetFor(transcription, requestDTO.fileName);

    const upload = await createUploadUrl(nextMediaStorageKey(storageKey));

    return {
      transcriptionId: transcription.id,
      // Write-only, one blob, an hour - the same credential shape a first
      // upload gets, on a key this row does not yet claim.
      uploadUrl: upload.url,
      mediaType,
      expiresAt: upload.expiresAt,
    };
  } catch (error) {
    throw handleError("replaceTranscriptionMediaService", error);
  }
}

// -------------------------------------------------------------------
// The re-encoded file has landed. Adopt it and start the job.
//
// THE ROW IS SWITCHED OVER IN ONE UPDATE, and only after the new blob has
// been proved to exist, to be non-empty and to be within the service's
// ceiling. Until that update the row still claims the original, so every
// way this can fail leaves the person exactly where they were - with their
// recording and a failure they can retry - rather than with neither.
//
// THE OLD BLOB IS DELETED AFTER, not before. A Postgres row cannot cascade
// into storage, so the rule throughout this feature is that a file goes
// when nothing claims it; doing it in the other order would, on a crash
// between the two, destroy the only copy of a meeting.
// -------------------------------------------------------------------
export async function finishTranscriptionMediaReplacementService(
  requestDTO: ReplaceTranscriptionMediaRequestDTO,
): Promise<TranscriptionDetailDTO> {
  try {
    const user = await requireUser();

    const transcription = await requireOwnedTranscription(requestDTO.transcriptionId, user.id);

    const { mediaType, storageKey: previousKey } = replacementTargetFor(
      transcription,
      requestDTO.fileName,
    );

    const replacementKey = nextMediaStorageKey(previousKey);

    const media = await getMediaInfo(replacementKey);

    if (!media.exists || media.byteSize === null || media.byteSize === 0) {
      throw new DisplayErrorMessage("The converted recording did not finish uploading. Try again.");
    }

    // ---------------------------------------------------------------
    // CHECKED BEFORE THE ROW MOVES, which is the whole reason this is not
    // left to startTranscriptionService. That one deletes the media it
    // refuses - correct for a file nothing will ever read, and catastrophic
    // here, because by then the media it would delete is the replacement
    // AND the original has already been let go. 16 kHz mono PCM is
    // uncompressed, so a long meeting genuinely can come out over the
    // ceiling: this is a real path rather than a defensive one.
    // ---------------------------------------------------------------
    if (media.byteSize > MAX_MEDIA_BYTES) {
      // The replacement is the thing nothing claims, so the replacement is
      // the thing that goes.
      await deleteMedia(replacementKey);

      throw new DisplayErrorMessage(
        `Converted, that recording comes to ${Math.round(media.byteSize / (1024 * 1024))} MB, which is over the ${Math.round(MAX_MEDIA_BYTES / (1024 * 1024))} MB the transcription service accepts. Your original recording is untouched and can still be downloaded.`,
      );
    }

    await updateTranscriptionForUserRepo(transcription.id, user.id, {
      storageKey: replacementKey,
      mediaType,
      byteSize: media.byteSize,
      // Cleared here as well as by the start below, so a failure between
      // the two does not leave the previous reason sitting on a row whose
      // file is no longer the one that produced it.
      error: null,
    });

    // Unclaimed as of the update above, so it goes now rather than waiting
    // for the monthly reconciliation pass to notice.
    await deleteMedia(previousKey).catch((error) => {
      console.warn(`[transcription] could not remove the replaced recording ${previousKey}`, error);
    });

    revalidateTranscriptionViews();

    // Every size, reachability and job-creation check lives there, and this
    // path must not grow a second copy of any of them.
    return await startTranscriptionService({ transcriptionId: transcription.id });
  } catch (error) {
    throw handleError("finishTranscriptionMediaReplacementService", error);
  }
}

// -------------------------------------------------------------------
// The checks both halves of a replacement share.
//
// In one place because they have to agree: the two calls are minutes apart
// and compute the same storage key from the same row, so a rule applied on
// one and not the other would sign a URL for a destination the second step
// would refuse.
// -------------------------------------------------------------------
function replacementTargetFor(
  transcription: Transcription,
  fileName: string,
): { mediaType: string; storageKey: string } {
  // Only a row with nothing to lose. A completed transcription has a
  // transcript people are reading, and replacing its media would either
  // orphan that text or throw it away - neither of which anybody asked for.
  const replaceable: string[] = [
    TRANSCRIPTION_STATUSES.FAILED,
    TRANSCRIPTION_STATUSES.AWAITING_MEDIA,
  ];

  if (!replaceable.includes(transcription.status)) {
    throw new DisplayErrorMessage("That transcription is not waiting to be transcribed.");
  }

  // A Teams import was never uploaded here - Teams transcribed the meeting
  // and only the text was fetched - so there is no file to replace.
  if (!transcription.storageKey) {
    throw new DisplayErrorMessage("That transcription has no recording to convert.");
  }

  const mediaType = mediaTypeForFileName(fileName);

  if (!mediaType) {
    throw new DisplayErrorMessage("That is not a file type this can transcribe.");
  }

  return { mediaType, storageKey: transcription.storageKey };
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

// ===================================================================
// AUTO-IMPORT: collecting the meeting somebody asked us to collect
// ===================================================================
//
// The in-meeting prompt asks you to start transcription in Teams. Confirming
// that you have arms a row here, and the sweep collects the transcript once
// the meeting is over. Nothing is imported that nobody armed - see migration
// 018 for why that is a row rather than "import everything recent".
// -------------------------------------------------------------------

// The window rules live in auto-import-window.ts, pure and tested: they are
// the one judgement in this loop and the failure they prevent is invisible.
const AUTO_IMPORT_SWEEP_BATCH = 20;

// -------------------------------------------------------------------
// Arm a meeting for collection, WITHOUT anybody pressing anything.
//
// THERE IS NO BUTTON, AND THAT IS THE POINT. The first version made somebody
// come back to the app mid-meeting and confirm, which is exactly the friction
// this feature exists to remove - and a confirmation nobody presses means a
// transcript nobody collects.
//
// Arming everything we detect is safe because OUR ROW IS NOT THE GATE. The
// gate is whether transcription was started in Teams at all, which is a
// deliberate act that Microsoft announces to everyone in the meeting. If
// nobody started one there is nothing to fetch and the row settles as
// no_transcript having cost a handful of Graph calls. So the worst case is
// quiet, and the best case is that it just works.
//
// Called from the polled read, so it must be cheap and idempotent: an
// existing row for this meeting is left completely alone, including one
// somebody cancelled - re-arming that would override a person who said no.
// -------------------------------------------------------------------
async function ensureAutoImportArmed(
  userId: string,
  meeting: { eventId: string; subject: string; endsAt: Date },
): Promise<boolean> {
  const existing = await getTeamsAutoImportForMeetingRepo(userId, meeting.eventId);

  if (existing) return existing.status !== TEAMS_AUTO_IMPORT_STATUSES.CANCELLED;

  await armTeamsAutoImportRepo({
    id: generateId(),
    userId,
    eventId: meeting.eventId,
    subject: meeting.subject,
    endsAt: meeting.endsAt,
  });

  // -----------------------------------------------------------------
  // ONE NOTIFICATION PER MEETING, and the dedupe is free.
  //
  // This runs only on the branch that CREATED the row, so a poll every
  // ninety seconds for the length of a meeting sends exactly one push. No
  // notified_at column, no timestamp arithmetic, and no way for a retry to
  // produce a second buzz - the uniqueness that stops a double import is the
  // same uniqueness that stops a double notification.
  //
  // WHY PUSH AT ALL WHEN THERE IS ALREADY A PANEL: the panel is inside the
  // browser, and during a meeting the browser is behind Teams. A push
  // notification is drawn by the operating system, so it appears over
  // whatever is on screen - the one thing no web page can do for itself.
  // -----------------------------------------------------------------
  await notifyMeetingStarted(userId, meeting.subject);

  return true;
}

// Best-effort, and never allowed to fail the arming it follows. A push
// service being briefly unavailable must not stop a meeting being collected;
// the collection is the part that cannot be redone later.
async function notifyMeetingStarted(userId: string, subject: string): Promise<void> {
  if (!isPushConfigured()) return;

  try {
    await sendPushToUser(userId, {
      title: "Start recording this meeting",
      body: `${subject} - in Teams: More actions, then Record and transcribe. It will be summarised for you afterwards.`,
      // Opens the prompt window, which carries the full instructions and
      // keeps running after the app is closed.
      url: ROUTES.MEETING_PROMPT,
      tag: "meeting-prompt",
      // THE ONE PLACE THIS APP ASKS FOR A STICKY NOTIFICATION. A meeting
      // cannot be transcribed retrospectively, so a prompt that auto-dismisses
      // after five seconds while somebody is talking is the same as never
      // having sent it.
      requireInteraction: true,
    });
  } catch (error) {
    console.error("notifyMeetingStarted: could not send", error);
  }
}

export async function ensureAutoImportArmedForMeeting(
  userId: string,
  meeting: { eventId: string; subject: string; endsAt: Date },
): Promise<boolean> {
  try {
    if (!isTeamsImportConfigured()) return false;

    return await ensureAutoImportArmed(userId, meeting);
  } catch (error) {
    // A polled read must not fail because the collection could not be
    // recorded. The prompt still tells somebody to start transcription in
    // Teams, which is the part that cannot be recovered later; the row can be
    // written on the next poll.
    console.error("ensureAutoImportArmedForMeeting: could not arm", error);
    return false;
  }
}

export async function cancelTeamsAutoImportService(
  requestDTO: ImportTeamsMeetingRequestDTO,
): Promise<void> {
  try {
    const user = await requireUser();

    await cancelTeamsAutoImportRepo(user.id, requestDTO.eventId);
  } catch (error) {
    throw handleError("cancelTeamsAutoImportService", error);
  }
}

// -------------------------------------------------------------------
// The sweep. Runs unauthenticated on the job route's bearer token, like the
// transcription sweep beside it, and acts for each row's OWN user.
//
// THREE OUTCOMES, AND THEY ARE DELIBERATELY NOT ALL "FAILED":
//
//   imported       a transcript existed and is now a transcription row, which
//                  the ordinary sweep will summarise
//   no_transcript  the window closed and nothing appeared. Almost always
//                  means nobody started transcription, which is an ordinary
//                  outcome and reads as one
//   failed         Graph refused in a way that will not fix itself - another
//                  tenant's meeting, the transcript API switched off, consent
//                  missing
//
// Collapsing the middle one into "failed" would make the commonest, most
// innocent case look like a broken feature every time.
// -------------------------------------------------------------------
export async function sweepTeamsAutoImportsService(): Promise<{
  examined: number;
  imported: number;
  gaveUp: number;
}> {
  try {
    if (!isTeamsImportConfigured()) return { examined: 0, imported: 0, gaveUp: 0 };

    const now = Date.now();
    const readyBefore = new Date(now - FIRST_TRY_AFTER_MINUTES * 60 * 1000);

    const due = await getDueTeamsAutoImportsRepo(readyBefore, AUTO_IMPORT_SWEEP_BATCH);

    let imported = 0;
    let gaveUp = 0;

    // Sequential, for the same reason the transcription sweep is: each of
    // these is several Graph calls and a successful one becomes a model call
    // as well. Fanning out would turn one scheduled run into a burst against
    // a throttle shared with the SharePoint crawl.
    for (const row of due) {
      const expired = isAutoImportWindowClosed({
        attempts: row.attempts,
        endsAt: new Date(row.endsAt),
        now: new Date(now),
      });

      try {
        const created = await importTeamsMeetingForUser(row.userId, row.eventId);

        await settleTeamsAutoImportRepo({
          id: row.id,
          userId: row.userId,
          status: TEAMS_AUTO_IMPORT_STATUSES.IMPORTED,
          transcriptionId: created.id,
        });

        imported += 1;
      } catch (error) {
        // "No transcript yet" is the expected answer for most of a row's
        // life, so it is a retry rather than a failure - until the window
        // closes, at which point it becomes the no_transcript outcome rather
        // than an error nobody can act on.
        const message = isDisplayError(error) ? error.message : "The transcript could not be collected.";
        const noTranscriptYet = isDisplayError(error) && /no transcript/i.test(error.message);

        if (noTranscriptYet && !expired) {
          await recordTeamsAutoImportAttemptRepo({ id: row.id, userId: row.userId, error: null });
          continue;
        }

        await settleTeamsAutoImportRepo({
          id: row.id,
          userId: row.userId,
          status: noTranscriptYet
            ? TEAMS_AUTO_IMPORT_STATUSES.NO_TRANSCRIPT
            : TEAMS_AUTO_IMPORT_STATUSES.FAILED,
          error: noTranscriptYet ? null : message,
        });

        gaveUp += 1;

        if (!noTranscriptYet) {
          console.error(`sweepTeamsAutoImportsService: giving up on ${row.eventId}`, error);
        }
      }
    }

    if (imported > 0) revalidateTranscriptionViews();

    return { examined: due.length, imported, gaveUp };
  } catch (error) {
    throw handleError("sweepTeamsAutoImportsService", error);
  }
}
