import "server-only";

import { generateId } from "better-auth";
import { notFound } from "next/navigation";
import { z } from "zod";

import { isBedrockConfigured } from "@/lib/ai/bedrock-client";
import { converseText } from "@/lib/ai/converse";
import {
  AI_CHAT_REQUEST_KINDS,
  TRANSCRIPTION_FILING_STATUSES,
  TRANSCRIPTION_SOURCE_DESCRIPTIONS,
  TRANSCRIPTION_STATUSES,
  type Transcription,
  type TranscriptionFiling,
  type TranscriptionFilingStatus,
} from "@/lib/data/kysely-database-types";
import { getClientsRepo } from "@/lib/data/repositories/clients.repository";
import { listSharepointDrivesRepo } from "@/lib/data/repositories/sharepoint-drive.repository";
import { listSharepointFoldersRepo } from "@/lib/data/repositories/sharepoint-item.repository";
import {
  claimTranscriptionFilingRepo,
  getPendingTranscriptionFilingsRepo,
  getTranscriptionFilingRepo,
  markTranscriptionFilingAttemptRepo,
  updateTranscriptionFilingRepo,
} from "@/lib/data/repositories/transcription-filing.repository";
import { getTranscriptionForUserRepo } from "@/lib/data/repositories/transcriptions.repository";
import { requireUser } from "@/lib/auth/session-auth-server";
import { DisplayErrorMessage } from "@/lib/errors";
import { envServer } from "@/lib/env-server";
import { formatDateTime } from "@/lib/format";
import { handleError } from "@/lib/handle-errors";
import { clientFromTitle } from "@/lib/sharepoint/client-from-title";
import {
  chooseFilingDestination,
  matchFolderByName,
  type CandidateFolder,
} from "@/lib/sharepoint/filing-destination";
import { chooseFilingLibrary } from "@/lib/sharepoint/filing-library";
import { buildFilingPrompt, FILING_SYSTEM_PROMPT } from "@/lib/sharepoint/filing.prompt";
import { buildNotesFileName, parseFolderPath } from "@/lib/sharepoint/folder-path";
import { GRAPH_OUTCOMES, graphOutcomeOf, graphStatusOf } from "@/lib/sharepoint/graph-client";
import { buildNotesDocument } from "@/lib/sharepoint/notes-document";
import { ensureFolderPath, uploadTextFile } from "@/lib/sharepoint/sharepoint-write";
import { dateInAppZone } from "@/lib/timezone";

import { revalidateTranscriptionViews } from "./transcription.revalidate";
import {
  formatTimestamp,
  speakerLabel,
  type TranscriptionIdRequestDTO,
} from "./transcription.types";

// ===================================================================
// FILING A MEETING'S NOTES INTO SHAREPOINT
//
// The piece that joins the tested parts: which library, which client, which
// folder, what the file says, and a record of all four.
//
// THE FAILURE THAT MATTERS IS NOT "UNFILED", IT IS "WRONG CLIENT", and every
// decision below is shaped by that. A note in a holding folder is untidy and
// fixed in ten seconds. The same note in another client's folder is sitting
// where people who should not read it will find it, and nobody is looking for
// it there. So: refuse rather than guess, record why, and prefer a visible
// nothing to a confident something.
//
// IT NEVER THROWS AT ITS CALLER. Filing runs immediately after a summary
// completes, and the transcript is the thing the person was waiting for. An
// unreachable SharePoint must not turn a finished transcription into a failed
// one, so every failure here lands in the filing row and nowhere else. Same
// reasoning as summarising being allowed to fail without costing somebody
// their transcript.
//
// THE UPLOAD RUNS ON THE OWNER'S OWN DELEGATED TOKEN. Nothing here decides
// who may write to which folder - SharePoint does, against the person whose
// meeting it was. That is also why the filing row carries a user id rather
// than resolving one from a session: the background sweep acts on rows
// belonging to people who are not here.
// ===================================================================

// Four tries, then stop. A folder somebody deleted fails identically every
// time, and retrying forever fills the log with one meeting. Four rides out a
// throttle or a token refresh and is short enough that a real problem
// surfaces the same day.
const FILING_MAX_ATTEMPTS = 4;

// One scheduled pass. Each row is a model call plus two or three Graph calls,
// so a burst here is a burst against two external services.
const FILING_SWEEP_BATCH_SIZE = 20;

// The whole universe of destinations, before the prompt's own cap. Generous
// because the deterministic client-name match runs against ALL of it, so a
// client past this limit would silently stop matching - the failure the
// folder cap already taught us once.
const FOLDER_QUERY_LIMIT = 5_000;

// A folder id and one sentence. Anything longer is the model explaining
// itself at length into a column nobody reads.
const FILING_MAX_TOKENS = 300;

// Markdown, because it reads as plain text in SharePoint's preview and needs
// no library to produce. Not .docx: that means a dependency and a binary blob
// whose contents nobody can search from outside SharePoint.
const NOTES_EXTENSION = "md";

// Closed shape. A reply that does not fit is discarded rather than salvaged -
// a half-understood filing decision is exactly the confident wrong answer
// this feature exists to avoid.
const FilingReplySchema = z.object({
  folderId: z.string().min(1).nullable().catch(null),
  reason: z.string().max(2_000).optional(),
});

// -------------------------------------------------------------------
// The library, resolved from what is nominated plus configuration.
//
// "off" means SharePoint filing is not set up at all, and no row is written
// for it - a pending row against a feature nobody turned on would be retried
// until the retention job removed it.
//
// "misconfigured" is different, and the distinction is the point: a library
// nominated but AMBIGUOUS is a mistake somebody can fix, so it is recorded
// where they can see it rather than passed over in silence.
// -------------------------------------------------------------------
async function resolveLibrary(): Promise<
  { kind: "off" } | { kind: "chosen"; driveId: string } | { kind: "misconfigured"; reason: string }
> {
  const drives = await listSharepointDrivesRepo();

  if (drives.length === 0) return { kind: "off" };

  const choice = chooseFilingLibrary(
    drives.map((drive) => ({
      driveId: drive.driveId,
      siteName: drive.siteName,
      driveName: drive.driveName,
    })),
    envServer.SHAREPOINT_FILING_LIBRARY,
  );

  return choice.kind === "chosen"
    ? { kind: "chosen", driveId: choice.library.driveId }
    : { kind: "misconfigured", reason: choice.reason };
}

// A configured container path and a crawled path agree on the words and
// nothing else: one is typed by a person, the other arrives with a slash on
// the front.
function stripPath(value: string): string {
  return value
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

// -------------------------------------------------------------------
// The candidate folders, minus the ones that are containers rather than
// destinations. "Clients" holds the client folders; a meeting note belongs in
// one of those and not in the lobby.
// -------------------------------------------------------------------
async function loadCandidateFolders(driveId: string): Promise<CandidateFolder[]> {
  const folders = await listSharepointFoldersRepo(driveId, {
    maxDepth: envServer.SHAREPOINT_FILING_MAX_DEPTH,
    limit: FOLDER_QUERY_LIMIT,
  });

  const containers = new Set(envServer.SHAREPOINT_FILING_CONTAINER_PATHS.map(stripPath));

  return folders
    .filter((folder) => !containers.has(stripPath(folder.path)))
    .map((folder) => ({ itemId: folder.itemId, path: folder.path, name: folder.name }));
}

// -------------------------------------------------------------------
// Which client is this meeting about?
//
// A transcription has no client link - it is a meeting somebody recorded or
// imported, and nothing joins it to one - so the title is all there is. See
// client-from-title.ts for why ambiguity there is treated as a miss.
//
// INACTIVE CLIENTS ARE INCLUDED, deliberately. A meeting about work that has
// finished still belongs in that client's folder, and their folder still
// exists.
// -------------------------------------------------------------------
async function clientNameForMeeting(title: string): Promise<string | null> {
  const clients = await getClientsRepo({ includeInactive: true });

  const found = clientFromTitle(
    title,
    clients.map((client) => ({ id: client.id, name: client.name })),
  );

  return found.kind === "matched" ? found.client.name : null;
}

// -------------------------------------------------------------------
// Ask the model, and admit nothing it was not offered.
//
// Failures here are SWALLOWED and reported as "no suggestion", because this
// is the middle tier of three: without it the fallback folder still catches
// the meeting. Throwing would turn a soft miss into a failed filing.
// -------------------------------------------------------------------
async function suggestFolder(
  userId: string,
  transcription: Transcription,
  clientName: string | null,
  participants: readonly string[],
  folders: readonly CandidateFolder[],
): Promise<{ folderId: string | null; reason: string | null }> {
  if (!isBedrockConfigured() || folders.length === 0) return { folderId: null, reason: null };

  const prompt = buildFilingPrompt({
    title: transcription.title,
    clientName,
    participants,
    summary: transcription.summary,
    folders,
  });

  try {
    const result = await converseText({
      userId,
      kind: AI_CHAT_REQUEST_KINDS.MEETING_FILING,
      system: FILING_SYSTEM_PROMPT,
      prompt: prompt.text,
      maxTokens: FILING_MAX_TOKENS,
    });

    const parsed = FilingReplySchema.safeParse(parseJsonReply(result.text));

    if (!parsed.success) return { folderId: null, reason: null };

    const reason = parsed.data.reason?.trim() || null;

    return {
      folderId: parsed.data.folderId,
      // TRUNCATION IS REPORTED, not swallowed. A model choosing nothing from
      // a list that was missing the right answer looks, from outside, exactly
      // like one that read everything and found nothing.
      reason: prompt.truncated
        ? `${reason ?? "No reason given."} (Only part of the library was offered, so this was chosen from an incomplete list.)`
        : reason,
    };
  } catch (error) {
    console.warn(`suggestFolder: could not get a filing suggestion for ${transcription.id}`, error);

    return { folderId: null, reason: null };
  }
}

// Tolerant of a fence and of a sentence either side of the object, and of
// nothing else. Same parser as the timesheet query box, same reasoning: a
// reply less structured than an object with braces round it is a genuine
// failure rather than something to rescue. Null rather than a throw, because
// the caller's answer to a bad reply is "no suggestion".
function parseJsonReply(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();

  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace <= firstBrace) return null;

  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------
// The document, assembled from the row.
//
// Speaker labels and timestamps are built HERE rather than inside the pure
// document builder, because "a diarization number is not a name" is a rule
// that already lives in this feature and must not end up implemented twice.
// -------------------------------------------------------------------
function buildDocument(transcription: Transcription, participants: readonly string[]) {
  const segments = transcription.segments ?? [];

  const transcriptLines =
    segments.length > 0
      ? segments.map(
          (segment) => `[${formatTimestamp(segment.startMs)}] ${speakerLabel(segment)}: ${segment.text}`,
        )
      : transcription.transcript
        ? [transcription.transcript]
        : [];

  return buildNotesDocument({
    title: transcription.title,
    recordedLabel: `Recorded: ${formatDateTime(transcription.createdAt)}`,
    sourceDescription: TRANSCRIPTION_SOURCE_DESCRIPTIONS[transcription.source],
    participants,
    summary: transcription.summary,
    transcriptLines,
  });
}

// Real names, and only Teams supplies them. Deduplicated in first-heard order
// rather than sorted, because the organiser usually speaks first and a list
// starting with them reads correctly.
function participantsOf(transcription: Transcription): string[] {
  const seen = new Set<string>();

  for (const segment of transcription.segments ?? []) {
    const name = segment.speakerName?.trim();
    if (name) seen.add(name);
  }

  return [...seen];
}

// -------------------------------------------------------------------
// Is this worth trying again?
//
// A throttle or a network blip fixes itself, so the row stays pending. A
// missing scope, a deleted folder or a revoked consent does not, and leaving
// those pending means the same failure every few minutes forever - which is
// how a log stops being worth reading.
// -------------------------------------------------------------------
function isRetryable(error: unknown): boolean {
  if (graphOutcomeOf(error) === GRAPH_OUTCOMES.THROTTLED) return true;

  const status = graphStatusOf(error);

  // No status at all is a transport failure, which is the most retryable
  // thing there is.
  if (status === null) return true;

  return status >= 500 || status === 429;
}

function describeError(error: unknown): string {
  const status = graphStatusOf(error);
  const message = error instanceof Error ? error.message : String(error);

  return status !== null ? `${message} (HTTP ${status})` : message;
}

// -------------------------------------------------------------------
// The fallback folder, created if it is not already there.
//
// THE ONLY PATH THIS APP EVER CREATES, and it comes from configuration -
// never from model output, never from a client name. A model that could name
// a path could create one anywhere in the library, so there is deliberately
// no route from one to the other.
//
// Null when nothing is configured, or when what is configured does not
// validate, or when the folder could not be made. All three are "there is
// nowhere to put this", which is a legitimate answer rather than an error:
// unset means anything ambiguous is left unfiled and reported instead of
// guessed at.
// -------------------------------------------------------------------
async function materialiseFallback(
  userId: string,
  driveId: string,
  reason: string,
): Promise<{ folder: CandidateFolder; via: string; reason: string } | null> {
  const parsed = parseFolderPath(envServer.SHAREPOINT_FILING_FALLBACK_PATH);

  if (!parsed.ok) return null;

  try {
    const created = await ensureFolderPath(userId, driveId, parsed.segments);

    return {
      folder: {
        itemId: created.itemId,
        path: `/${parsed.segments.join("/")}`,
        name: parsed.segments[parsed.segments.length - 1],
      },
      via: "fallback",
      reason,
    };
  } catch (error) {
    // The holding folder itself could not be made - almost always a missing
    // write scope, which is worth seeing in the log rather than reported as
    // "nowhere to file it".
    console.error(`materialiseFallback: could not create the fallback folder on drive ${driveId}`, error);

    return null;
  }
}

// ===================================================================
// FILE ONE TRANSCRIPTION
//
// Idempotent by two separate mechanisms, because one is not enough:
//
//   1. THE CLAIM. One filing row per transcription, inserted with DO NOTHING,
//      so of two sweeps arriving together only one proceeds.
//   2. THE FILE NAME. Derived from the meeting's date and title, so a second
//      upload of the same meeting collides with the first and is reported as
//      the existing file rather than added beside it. That covers the gap the
//      claim does not: two runs that both pass the pending check.
//
// Returns the filing row, or null when there is nothing to do.
// ===================================================================
export async function fileTranscription(
  transcription: Transcription,
  userId: string,
): Promise<TranscriptionFiling | null> {
  try {
    // Only a finished transcription is worth filing, and only one with words
    // in it. A completed row with no transcript cannot happen today, but
    // uploading an empty document into a client folder is a bad enough
    // outcome to check for rather than assume away.
    if (transcription.status !== TRANSCRIPTION_STATUSES.COMPLETED) return null;
    if (!transcription.transcript) return null;

    const library = await resolveLibrary();

    if (library.kind === "off") return null;

    const claimed = await claimTranscriptionFilingRepo({
      id: generateId(),
      transcriptionId: transcription.id,
      userId,
      status: TRANSCRIPTION_FILING_STATUSES.PENDING,
    });

    // Somebody else holds it. Read what the row says now rather than
    // assuming - it may already be filed, which is the answer the caller
    // wanted.
    const filing = claimed ?? (await getTranscriptionFilingRepo(transcription.id, userId));

    if (!filing) return null;

    // Filed, given up on, or parked with nowhere to go. Nothing to do, and
    // the row is the honest report.
    if (filing.status !== TRANSCRIPTION_FILING_STATUSES.PENDING) return filing;

    if (library.kind === "misconfigured") {
      return (
        (await updateTranscriptionFilingRepo(filing.id, {
          status: TRANSCRIPTION_FILING_STATUSES.NOWHERE,
          reason: library.reason,
        })) ?? filing
      );
    }

    // Counted before the work, so a run that dies mid-upload still spends an
    // attempt. The status predicate inside is what makes two sweeps meeting
    // the same row safe.
    const attempted = await markTranscriptionFilingAttemptRepo(filing.id);

    if (!attempted) return filing;

    const participants = participantsOf(transcription);
    const clientName = await clientNameForMeeting(transcription.title);
    const folders = await loadCandidateFolders(library.driveId);

    // Tier 1 first and on its own, so the model is never paid for a decision
    // already made deterministically. chooseFilingDestination re-runs the
    // same match a moment later - it is pure and cheap, and having ONE place
    // that decides is worth more than saving the work.
    const byName = matchFolderByName(clientName, folders);

    const suggestion = byName.folder
      ? { folderId: null, reason: null }
      : await suggestFolder(userId, transcription, clientName, participants, folders);

    const decision = chooseFilingDestination({
      clientName,
      folders,
      modelFolderId: suggestion.folderId,
      modelReason: suggestion.reason,
      // ALWAYS NULL, and not a gap. Materialising the fallback is a WRITE:
      // passing one here would mean creating a holding folder for every
      // meeting, including the ones that never needed it. It is created
      // below, only once nothing better has been found.
      fallback: null,
    });

    const destination =
      decision.kind === "nowhere"
        ? await materialiseFallback(userId, library.driveId, decision.reason)
        : {
            folder: decision.folder,
            via: decision.kind === "matched" ? decision.via : "fallback",
            reason: decision.reason,
          };

    if (!destination) {
      return (
        (await updateTranscriptionFilingRepo(filing.id, {
          status: TRANSCRIPTION_FILING_STATUSES.NOWHERE,
          driveId: library.driveId,
          reason: decision.kind === "nowhere" ? decision.reason : null,
        })) ?? filing
      );
    }

    const document = buildDocument(transcription, participants);

    const fileName = buildNotesFileName({
      // The meeting's own date in the app zone, not the server's. A 9am
      // Adelaide meeting is stored as the previous day in UTC, and a folder
      // sorted by name would file it under yesterday.
      workDate: dateInAppZone(transcription.createdAt),
      title: transcription.title,
      extension: NOTES_EXTENSION,
    });

    try {
      const uploaded = await uploadTextFile({
        userId,
        driveId: library.driveId,
        parentItemId: destination.folder.itemId,
        fileName,
        content: document.text,
      });

      return (
        (await updateTranscriptionFilingRepo(filing.id, {
          status: TRANSCRIPTION_FILING_STATUSES.FILED,
          driveId: library.driveId,
          folderItemId: destination.folder.itemId,
          // A SNAPSHOT. Folders get renamed and moved, and "where we put it"
          // has to stay answerable afterwards.
          folderPath: destination.folder.path,
          decidedVia: destination.via,
          reason: destination.reason,
          fileItemId: uploaded.item.itemId,
          fileWebUrl: uploaded.item.webUrl,
          fileName,
          filedAt: new Date(),
          error: null,
        })) ?? filing
      );
    } catch (error) {
      const retryable = isRetryable(error) && attempted.attempts < FILING_MAX_ATTEMPTS;

      console.error(`fileTranscription: could not file transcription ${transcription.id}`, error);

      return (
        (await updateTranscriptionFilingRepo(filing.id, {
          // Left pending when another go is worth it. The sweep picks it up;
          // nothing else has to remember.
          status: retryable
            ? TRANSCRIPTION_FILING_STATUSES.PENDING
            : TRANSCRIPTION_FILING_STATUSES.FAILED,
          driveId: library.driveId,
          // The destination is recorded even on a failure. "We could not put
          // it in this folder" is a different problem from "we did not know
          // where to put it", and the remedies differ.
          folderItemId: destination.folder.itemId,
          folderPath: destination.folder.path,
          decidedVia: destination.via,
          reason: destination.reason,
          error: describeError(error),
        })) ?? filing
      );
    }
  } catch (error) {
    // NOT rethrown: see the note at the top of the file. A finished
    // transcription must not be reported as failed because SharePoint was
    // unreachable.
    console.error(`fileTranscription: filing ${transcription.id} failed outright`, error);

    return null;
  }
}

// ===================================================================
// THE SWEEP
//
// Retries what did not finish. It has no session, so it acts on rows that
// name their own owner and runs each upload on that person's token - the same
// arrangement as sweepAllTranscriptionsService, and the endpoint in front of
// it is guarded by a bearer secret for the same reason.
// ===================================================================
export async function sweepTranscriptionFilingService(): Promise<{
  examined: number;
  filed: number;
}> {
  try {
    const pending = await getPendingTranscriptionFilingsRepo({
      maxAttempts: FILING_MAX_ATTEMPTS,
      limit: FILING_SWEEP_BATCH_SIZE,
    });

    let filed = 0;

    // Sequential. Each row is a model call plus Graph calls, and fanning them
    // out would turn one scheduled pass into a burst against both.
    for (const row of pending) {
      try {
        const transcription = await getTranscriptionForUserRepo(row.transcriptionId, row.userId);

        if (!transcription) continue;

        const result = await fileTranscription(transcription, row.userId);

        if (result?.status === TRANSCRIPTION_FILING_STATUSES.FILED) filed += 1;
      } catch (error) {
        // One stuck row must not stop the rest of the batch.
        console.error(`sweepTranscriptionFilingService: could not file ${row.transcriptionId}`, error);
      }
    }

    return { examined: pending.length, filed };
  } catch (error) {
    throw handleError("sweepTranscriptionFilingService", error);
  }
}

// ===================================================================
// FILE THIS ONE NOW
//
// The manual path, and it covers two cases that the automatic one cannot
// reach on its own.
//
// A RETRY. A filing that ended 'nowhere' or 'failed' is terminal by design -
// the sweep does not pick those up, because a folder somebody deleted fails
// identically every few minutes forever and that is how a log stops being
// worth reading. So somebody has to say "try again", and until now there was
// nowhere to say it from.
//
// A BACKFILL. Every transcription that finished before this feature existed
// has no filing row at all, and nothing would ever give it one. That is not
// a small set - it is every meeting anybody had recorded up to the day this
// shipped - and without this they stay unfiled forever with no explanation.
//
// IT DOES NOT SKIP THE DECISION. This does not take a folder, and there is
// deliberately no way for a caller to name one: the destination is chosen by
// the same three tiers as an automatic filing, so a retry cannot put a note
// somewhere the rules would refuse to. Moving a note that landed in the
// wrong place is a job for SharePoint, where the person doing it can see
// what else is in the folder.
//
// The guard is the transcription's own owner. The upload runs on their
// delegated token, so a caller who could retry somebody else's filing would
// be causing a write to SharePoint as them.
// ===================================================================
export async function retryTranscriptionFilingService(
  requestDTO: TranscriptionIdRequestDTO,
): Promise<TranscriptionFilingStatus | null> {
  try {
    const user = await requireUser();

    const transcription = await getTranscriptionForUserRepo(requestDTO.transcriptionId, user.id);

    // Not theirs, or not there. notFound rather than "forbidden", so a
    // guessed id cannot be used to discover which ones exist.
    if (!transcription) notFound();

    if (transcription.status !== TRANSCRIPTION_STATUSES.COMPLETED) {
      throw new DisplayErrorMessage("This can be filed once the transcription has finished.");
    }

    const existing = await getTranscriptionFilingRepo(transcription.id, user.id);

    // Reset to pending so fileTranscription will act on it. The attempt
    // counter goes back to zero because this is a person deciding to try
    // again, not the sweep spending another of its four - and a row that had
    // exhausted its attempts is exactly the one somebody is here about.
    if (existing) {
      await updateTranscriptionFilingRepo(existing.id, {
        status: TRANSCRIPTION_FILING_STATUSES.PENDING,
        attempts: 0,
        error: null,
      });
    }

    // No row at all is the backfill case, and needs nothing: the claim
    // inside fileTranscription creates one.
    const filing = await fileTranscription(transcription, user.id);

    revalidateTranscriptionViews();

    return filing?.status ?? null;
  } catch (error) {
    throw handleError("retryTranscriptionFilingService", error);
  }
}
