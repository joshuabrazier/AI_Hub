import "server-only";

import { generateId } from "better-auth";
import { notFound } from "next/navigation";
import { z } from "zod";

import { isBedrockConfigured } from "@/lib/ai/bedrock-client";
import { converseCeilingFor, converseText } from "@/lib/ai/converse";
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
  admitModelFolder,
  chooseFilingDestination,
  matchFolderByName,
  type CandidateFolder,
} from "@/lib/sharepoint/filing-destination";
import { chooseFilingLibrary } from "@/lib/sharepoint/filing-library";
import { buildFilingPrompt, FILING_SYSTEM_PROMPT } from "@/lib/sharepoint/filing.prompt";
import { buildNotesFileName, parseFolderPath } from "@/lib/sharepoint/folder-path";
import { graphStatusOf } from "@/lib/sharepoint/graph-client";
import { buildNotesDocument } from "@/lib/sharepoint/notes-document";
import {
  isAlreadySubfolder,
  resolveFilingSubfolder,
  subfolderPath,
} from "@/lib/sharepoint/filing-subfolder";
import { ensureChildFolder, ensureFolderPath, uploadTextFile } from "@/lib/sharepoint/sharepoint-write";
import { dateInAppZone } from "@/lib/timezone";

import { revalidateTranscriptionViews } from "./transcription.revalidate";
import {
  formatTimestamp,
  speakerLabel,
  type ConfirmTranscriptionFilingRequestDTO,
  type FilingFolderChoiceDTO,
  type TranscriptionIdRequestDTO,
} from "./transcription.types";

// ===================================================================
// FILING A MEETING'S NOTES INTO SHAREPOINT
//
// The piece that joins the tested parts: which library, which client, which
// folder, what the file says, and a record of all four. The note lands in a
// folder of its own inside whichever folder was matched, so meeting
// transcripts do not sit among a client's contracts and drawings.
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

// -------------------------------------------------------------------
// The ceiling on that call, derived from the token cap rather than
// inherited.
//
// MEASURED, NOT ESTIMATED. This call ran on the shared 120-second default,
// and in production a stalled one used every second of it - four times over
// for one meeting, because each retry pays the ceiling again. Eight minutes
// of Bedrock to not choose a folder.
//
// 300 tokens does not need two minutes. The derivation allows for a slow
// prefill on a prompt carrying up to MAX_FOLDER_OPTIONS paths, which is the
// large part of this request; the generation itself is a few seconds.
// -------------------------------------------------------------------
const FILING_TIMEOUT_MS = converseCeilingFor(FILING_MAX_TOKENS);

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
): Promise<{ folderId: string | null; reason: string | null; failure: string | null }> {
  if (!isBedrockConfigured()) {
    return { folderId: null, reason: null, failure: null };
  }

  if (folders.length === 0) return { folderId: null, reason: null, failure: null };

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
      timeoutMs: FILING_TIMEOUT_MS,
    });

    const parsed = FilingReplySchema.safeParse(parseJsonReply(result.text));

    if (!parsed.success) {
      return {
        folderId: null,
        reason: null,
        failure: "The model's answer did not fit the expected shape, so it was ignored.",
      };
    }

    const reason = parsed.data.reason?.trim() || null;

    return {
      folderId: parsed.data.folderId,
      // TRUNCATION IS REPORTED, not swallowed. A model choosing nothing from
      // a list that was missing the right answer looks, from outside, exactly
      // like one that read everything and found nothing.
      reason: prompt.truncated
        ? `${reason ?? "No reason given."} (Only part of the library was offered, so this was chosen from an incomplete list.)`
        : reason,
      failure: null,
    };
  } catch (error) {
    console.warn(`suggestFolder: could not get a filing suggestion for ${transcription.id}`, error);

    // -----------------------------------------------------------------
    // REPORTED, NOT ONLY LOGGED, and this was a real gap. The middle tier
    // failing is not the same as the middle tier finding nothing, and both
    // used to record the same thing: "No folder matches X". Somebody reading
    // that went looking for a missing folder, when what had actually
    // happened was that the model call timed out and never saw the list.
    // -----------------------------------------------------------------
    return {
      folderId: null,
      reason: null,
      failure: `The model could not be asked which folder to use (${describeError(error)}).`,
    };
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

function describeError(error: unknown): string {
  const status = graphStatusOf(error);
  const message = error instanceof Error ? error.message : String(error);

  return status !== null ? `${message} (HTTP ${status})` : message;
}

// -------------------------------------------------------------------
// Put the note in a folder of its own inside the one that was matched.
//
// Returns the folder to upload into, plus a note for the record when it is
// NOT the subfolder - because "we filed it in the client folder" and "we
// filed it in the client folder because the subfolder could not be made" are
// different facts and the second is the one somebody would want to know.
//
// THREE WAYS THIS DOES NOTHING, and none of them is a failure:
//
//   1. The configured name is invalid. Reported, and the note still gets
//      filed - a misconfigured tidying step must not cost somebody their
//      meeting notes.
//   2. The chosen folder IS the subfolder already. Once these exist and the
//      library is re-crawled, every client has one and the model is offered
//      them like any other folder; nesting again would give
//      ".../Meeting Transcriptions/Meeting Transcriptions".
//   3. Graph refused to create it. Almost always a permission that allows
//      writing a file but not creating a folder, which is worth saying
//      rather than turning into a failed filing.
// -------------------------------------------------------------------
async function nestInSubfolder(
  userId: string,
  driveId: string,
  parent: CandidateFolder,
): Promise<{ folder: CandidateFolder; note: string | null }> {
  const subfolder = resolveFilingSubfolder(envServer.SHAREPOINT_FILING_SUBFOLDER);

  if (!subfolder.ok) {
    return { folder: parent, note: `Filed directly in the folder: ${subfolder.reason}` };
  }

  if (isAlreadySubfolder(parent.name, subfolder.name)) {
    return { folder: parent, note: null };
  }

  try {
    const created = await ensureChildFolder(userId, driveId, parent.itemId, subfolder.name);

    return {
      folder: {
        itemId: created.itemId,
        path: subfolderPath(parent.path, subfolder.name),
        name: subfolder.name,
      },
      note: null,
    };
  } catch (error) {
    console.warn(`nestInSubfolder: could not create "${subfolder.name}" under ${parent.path}`, error);

    return {
      folder: parent,
      note: `Filed directly in the folder because "${subfolder.name}" could not be created (${describeError(error)}).`,
    };
  }
}

// Two sentences about one filing, joined without inventing punctuation when
// either is absent.
function joinNotes(first: string | null, second: string | null): string | null {
  return [first, second].filter((part): part is string => Boolean(part)).join(" ") || null;
}

// ===================================================================
// PROPOSE A DESTINATION. WRITE NOTHING.
//
// This used to choose a folder and upload into it in one movement. It now
// stops at the choice, and a person says yes before anything reaches
// SharePoint.
//
// WHY, in one sentence: every other guard in this feature makes a wrong
// answer VISIBLE afterwards, and this one makes it impossible beforehand.
// The reason is recorded, the method is recorded, the screen shows both -
// all of which help somebody who already suspects a note is in the wrong
// client's folder, and none of which help the client whose meeting notes
// were readable by another client in the meantime.
//
// NOTHING HERE TOUCHES SHAREPOINT. Not the upload, not the subfolder, not
// the holding folder. A proposal is three columns on a row:
//
//   folderItemId + folderPath   a catalogued folder, chosen by name or model
//   folderPath only             the configured holding folder, which does
//                               NOT exist yet and is created only if the
//                               answer is yes
//   neither                     nothing matched; the person picks one
//
// THE HOLDING FOLDER IS NOW A SUGGESTION RATHER THAN A DESTINATION, and
// that is a consequence rather than a separate decision. It existed because
// nobody was going to look at an unmatched meeting, so somewhere safe and
// automatic beat nothing. Somebody is going to look now, so it is offered
// like any other answer and confirmed like any other answer.
//
// Idempotent by the claim, as before: one filing row per transcription,
// inserted with DO NOTHING, so of two sweeps arriving together only one
// proceeds. The file-name collision that used to be the second defence
// still applies, but at confirm time.
//
// Returns the filing row, or null when there is nothing to do.
// ===================================================================
export async function proposeTranscriptionFiling(
  transcription: Transcription,
  userId: string,
): Promise<TranscriptionFiling | null> {
  try {
    // Only a finished transcription is worth filing, and only one with words
    // in it. A completed row with no transcript cannot happen today, but
    // proposing a home for an empty document is a bad enough outcome to
    // check for rather than assume away.
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
    // assuming - it may already be proposed or filed, which is the answer
    // the caller wanted.
    const filing = claimed ?? (await getTranscriptionFilingRepo(transcription.id, userId));

    if (!filing) return null;

    // Anything other than pending has either been decided already or is
    // waiting on a person. Deciding again would overwrite a proposal
    // somebody is looking at.
    if (filing.status !== TRANSCRIPTION_FILING_STATUSES.PENDING) return filing;

    if (library.kind === "misconfigured") {
      return (
        (await updateTranscriptionFilingRepo(filing.id, {
          status: TRANSCRIPTION_FILING_STATUSES.NOWHERE,
          reason: library.reason,
        })) ?? filing
      );
    }

    // Counted before the work, so a run that dies mid-decision still spends
    // an attempt. The status predicate inside is what makes two sweeps
    // meeting the same row safe.
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
      ? { folderId: null, reason: null, failure: null }
      : await suggestFolder(userId, transcription, clientName, participants, folders);

    const decision = chooseFilingDestination({
      clientName,
      folders,
      modelFolderId: suggestion.folderId,
      modelReason: suggestion.reason,
      // Still always null, and now for a second reason on top of the first:
      // materialising a fallback is a write, and this function makes none.
      fallback: null,
    });

    const withFailure = (reason: string | null): string | null =>
      suggestion.failure ? `${reason ? `${reason} ` : ""}${suggestion.failure}` : reason;

    if (decision.kind === "matched") {
      return (
        (await updateTranscriptionFilingRepo(filing.id, {
          status: TRANSCRIPTION_FILING_STATUSES.AWAITING_APPROVAL,
          driveId: library.driveId,
          folderItemId: decision.folder.itemId,
          folderPath: decision.folder.path,
          decidedVia: decision.via,
          reason: withFailure(decision.reason),
          error: null,
        })) ?? filing
      );
    }

    // Nothing matched. The holding folder is offered by PATH if one is
    // configured - it is not looked up and not created, so a proposal
    // nobody accepts leaves no trace of itself in the library.
    const fallback = parseFolderPath(envServer.SHAREPOINT_FILING_FALLBACK_PATH);

    return (
      (await updateTranscriptionFilingRepo(filing.id, {
        status: TRANSCRIPTION_FILING_STATUSES.AWAITING_APPROVAL,
        driveId: library.driveId,
        folderItemId: null,
        folderPath: fallback.ok ? `/${fallback.segments.join("/")}` : null,
        decidedVia: fallback.ok ? "fallback" : null,
        reason: withFailure(decision.reason),
        error: null,
      })) ?? filing
    );
  } catch (error) {
    // NOT rethrown: a finished transcription must not be reported as failed
    // because SharePoint was unreachable. The row stays pending with an
    // attempt spent, and the sweep comes back.
    console.error(`proposeTranscriptionFiling: could not decide for ${transcription.id}`, error);

    return null;
  }
}

// ===================================================================
// THE ANSWER IS YES. NOW WRITE.
//
// Everything that touches SharePoint lives here, and it only runs because
// somebody said so: create the holding folder if that is what was accepted,
// create the notes subfolder, upload the file.
//
// A FOLDER ID FROM THE BROWSER IS UNTRUSTED EXACTLY LIKE ONE FROM THE MODEL,
// and gets the same treatment - admitModelFolder checks it against the
// catalogue this app actually crawled. That is not defensiveness about the
// person: it is what stops a stale tab, a copied id or a tampered request
// addressing a write at a folder nobody offered. The person picks from a
// list; the server re-checks the list.
//
// THE PROPOSED FOLDER IS RE-ADMITTED TOO, not trusted because we wrote it.
// A proposal can sit for a week, and a folder can be renamed or deleted in
// that week - so "the folder we suggested" is re-checked against the
// catalogue at the moment of the write, and a proposal that has gone stale
// is reported rather than uploaded into whatever now holds that id.
// ===================================================================
export async function confirmTranscriptionFilingService(
  requestDTO: ConfirmTranscriptionFilingRequestDTO,
): Promise<TranscriptionFilingStatus> {
  try {
    const user = await requireUser();

    const transcription = await getTranscriptionForUserRepo(requestDTO.transcriptionId, user.id);

    // Not theirs, or not there. notFound rather than "forbidden", so a
    // guessed id cannot be used to discover which ones exist.
    if (!transcription) notFound();

    const filing = await getTranscriptionFilingRepo(transcription.id, user.id);

    if (!filing) {
      throw new DisplayErrorMessage("There is nothing waiting to be filed for this transcription.");
    }

    if (filing.status === TRANSCRIPTION_FILING_STATUSES.FILED) {
      throw new DisplayErrorMessage(
        "These notes are already filed in SharePoint. Filing again would add a second copy rather than move the first, so move it there instead.",
      );
    }

    // Approving is only meaningful once a destination has been worked out or
    // an attempt has failed. A row still being decided has nothing to say
    // yes to.
    if (
      filing.status !== TRANSCRIPTION_FILING_STATUSES.AWAITING_APPROVAL &&
      filing.status !== TRANSCRIPTION_FILING_STATUSES.FAILED
    ) {
      throw new DisplayErrorMessage("This is still working out where it should go. Try again in a moment.");
    }

    const library = await resolveLibrary();

    if (library.kind !== "chosen") {
      throw new DisplayErrorMessage(
        library.kind === "off"
          ? "SharePoint filing is not set up on this environment."
          : library.reason,
      );
    }

    const folders = await loadCandidateFolders(library.driveId);

    const parent = await resolveConfirmedParent(user.id, library.driveId, folders, filing, requestDTO);

    // A person choosing a folder is the most certain of the four ways a
    // destination gets picked, and it is recorded as its own value so the
    // log can tell it from the model's guess that they happened to accept.
    const via = requestDTO.folderItemId ? "chosen" : (filing.decidedVia ?? "chosen");

    const nested =
      via === "fallback"
        ? { folder: parent, note: null }
        : await nestInSubfolder(user.id, library.driveId, parent);

    const participants = participantsOf(transcription);
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
        userId: user.id,
        driveId: library.driveId,
        parentItemId: nested.folder.itemId,
        fileName,
        content: document.text,
      });

      await updateTranscriptionFilingRepo(filing.id, {
        status: TRANSCRIPTION_FILING_STATUSES.FILED,
        driveId: library.driveId,
        // The folder the file is actually IN, which is the subfolder when one
        // was made. A record pointing one level up is the near-miss that
        // wastes an afternoon for whoever goes looking.
        folderItemId: nested.folder.itemId,
        // A SNAPSHOT. Folders get renamed and moved, and "where we put it"
        // has to stay answerable afterwards.
        folderPath: nested.folder.path,
        decidedVia: via,
        reason: joinNotes(filing.reason, nested.note),
        fileItemId: uploaded.item.itemId,
        fileWebUrl: uploaded.item.webUrl,
        fileName,
        filedAt: new Date(),
        error: null,
      });

      revalidateTranscriptionViews();

      return TRANSCRIPTION_FILING_STATUSES.FILED;
    } catch (error) {
      console.error(`confirmTranscriptionFilingService: could not file ${transcription.id}`, error);

      // FAILED rather than back to awaiting: the destination is settled and
      // it was the write that did not work, so the next attempt is the same
      // attempt rather than a fresh decision. The button offers exactly that.
      await updateTranscriptionFilingRepo(filing.id, {
        status: TRANSCRIPTION_FILING_STATUSES.FAILED,
        driveId: library.driveId,
        folderItemId: nested.folder.itemId,
        folderPath: nested.folder.path,
        decidedVia: via,
        reason: joinNotes(filing.reason, nested.note),
        error: describeError(error),
      });

      revalidateTranscriptionViews();

      return TRANSCRIPTION_FILING_STATUSES.FAILED;
    }
  } catch (error) {
    throw handleError("confirmTranscriptionFilingService", error);
  }
}

// -------------------------------------------------------------------
// Which folder the file is actually going into, having been agreed.
//
// Three sources, in order of who decided:
//
//   1. THE PERSON, when they picked a different one. Admitted against the
//      catalogue, so an id the app never offered is refused.
//   2. THE PROPOSAL, re-admitted rather than trusted. It may be a week old,
//      and a folder can be renamed or deleted in a week.
//   3. THE HOLDING FOLDER, created now because this is the moment somebody
//      said yes to it. Still the only multi-segment path this app builds,
//      still from configuration, still never from a model.
//
// Throws a message a person can act on, because every one of these is
// something they can fix by choosing again.
// -------------------------------------------------------------------
async function resolveConfirmedParent(
  userId: string,
  driveId: string,
  folders: readonly CandidateFolder[],
  filing: TranscriptionFiling,
  requestDTO: ConfirmTranscriptionFilingRequestDTO,
): Promise<CandidateFolder> {
  if (requestDTO.folderItemId) {
    const chosen = admitModelFolder(requestDTO.folderItemId, folders);

    if (!chosen) {
      throw new DisplayErrorMessage(
        "That folder is not one of the catalogued folders. It may have been removed since the list was loaded - reload and choose again.",
      );
    }

    return chosen;
  }

  if (filing.folderItemId) {
    const proposed = admitModelFolder(filing.folderItemId, folders);

    if (!proposed) {
      throw new DisplayErrorMessage(
        "The folder that was suggested is no longer in the catalogue, so it was not used. Choose a folder instead.",
      );
    }

    return proposed;
  }

  // No catalogued folder, so this is the holding folder being accepted. It
  // is created here and nowhere else.
  const fallback = parseFolderPath(envServer.SHAREPOINT_FILING_FALLBACK_PATH);

  if (!fallback.ok) {
    throw new DisplayErrorMessage("No folder was suggested for this meeting, so choose one.");
  }

  const created = await ensureFolderPath(userId, driveId, fallback.segments);

  return {
    itemId: created.itemId,
    path: `/${fallback.segments.join("/")}`,
    name: fallback.segments[fallback.segments.length - 1],
  };
}

// ===================================================================
// THE FOLDERS SOMEBODY MAY CHOOSE FROM
//
// The same closed vocabulary the model gets, for the same reason: the app
// can only write where it has actually looked. A free-text path would let a
// typo create a folder anywhere in the library, and a folder that is missing
// from this list means the crawl is stale rather than that the folder cannot
// be used.
//
// Guarded on OWNING A TRANSCRIPTION THAT NEEDS ONE, not merely on being
// signed in. Folder names in a client library name clients, so this is not
// a browse endpoint - it is the list attached to a decision somebody has
// been asked to make.
// ===================================================================
export async function getFilingFolderChoicesService(
  requestDTO: TranscriptionIdRequestDTO,
): Promise<FilingFolderChoiceDTO[]> {
  try {
    const user = await requireUser();

    const transcription = await getTranscriptionForUserRepo(requestDTO.transcriptionId, user.id);

    if (!transcription) notFound();

    const filing = await getTranscriptionFilingRepo(transcription.id, user.id);

    if (
      !filing ||
      (filing.status !== TRANSCRIPTION_FILING_STATUSES.AWAITING_APPROVAL &&
        filing.status !== TRANSCRIPTION_FILING_STATUSES.FAILED)
    ) {
      return [];
    }

    const library = await resolveLibrary();

    if (library.kind !== "chosen") return [];

    const folders = await loadCandidateFolders(library.driveId);

    return folders.map((folder) => ({ itemId: folder.itemId, path: folder.path }));
  } catch (error) {
    throw handleError("getFilingFolderChoicesService", error);
  }
}

// ===================================================================
// THE SWEEP
//
// Retries DECIDING, never writing. The only rows it touches are 'pending' -
// ones whose destination has not been worked out yet, or whose last attempt
// at working it out failed - and the result is a proposal somebody still has
// to confirm. A row waiting on a person is a different status precisely so
// this cannot keep re-deciding a question nobody has answered.
//
// It has no session, so it acts on rows that name their own owner and runs
// each model call on that person's account - the same arrangement as
// sweepAllTranscriptionsService, and the endpoint in front of it is guarded
// by a bearer secret for the same reason.
// ===================================================================
export async function sweepTranscriptionFilingService(): Promise<{
  examined: number;
  // Proposals made, NOT files written. Nothing this sweep does reaches
  // SharePoint, and a counter called "filed" would have quietly reported
  // zero forever while working perfectly.
  proposed: number;
}> {
  try {
    const pending = await getPendingTranscriptionFilingsRepo({
      maxAttempts: FILING_MAX_ATTEMPTS,
      limit: FILING_SWEEP_BATCH_SIZE,
    });

    let proposed = 0;

    // Sequential. Each row is a model call plus a catalogue read, and fanning
    // them out would turn one scheduled pass into a burst against both.
    for (const row of pending) {
      try {
        const transcription = await getTranscriptionForUserRepo(row.transcriptionId, row.userId);

        if (!transcription) continue;

        const result = await proposeTranscriptionFiling(transcription, row.userId);

        if (result?.status === TRANSCRIPTION_FILING_STATUSES.AWAITING_APPROVAL) proposed += 1;
      } catch (error) {
        // One stuck row must not stop the rest of the batch.
        console.error(
          `sweepTranscriptionFilingService: could not decide for ${row.transcriptionId}`,
          error,
        );
      }
    }

    return { examined: pending.length, proposed };
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

    // -----------------------------------------------------------------
    // A NOTE THAT IS ALREADY FILED IS NOT RE-FILED, and refusing is the
    // honest answer rather than a missing feature.
    //
    // Nothing in this app moves or deletes anything in SharePoint - that is
    // a property of sharepoint-write.ts, not an oversight - so "file it
    // again" cannot mean "put it somewhere else". It would upload a SECOND
    // copy at the new destination and leave the first where it was, and the
    // row would then point at the new one as though the old had gone.
    //
    // The case this actually comes up in: notes filed before a change to
    // where notes go, sitting in the folder above the one they would land in
    // today. Two copies of a meeting in one client folder is a worse answer
    // to that than one copy in the wrong place, and moving them is a
    // SharePoint job where the person doing it can see what is already
    // there.
    //
    // The interface does not offer this - a filed note shows no button - so
    // this guards the action against being reached another way rather than
    // duplicating a check the screen already makes.
    // -----------------------------------------------------------------
    if (existing?.status === TRANSCRIPTION_FILING_STATUSES.FILED) {
      throw new DisplayErrorMessage(
        "These notes are already filed in SharePoint. Filing again would add a second copy rather than move the first, so move it there instead.",
      );
    }

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
    const filing = await proposeTranscriptionFiling(transcription, user.id);

    revalidateTranscriptionViews();

    return filing?.status ?? null;
  } catch (error) {
    throw handleError("retryTranscriptionFilingService", error);
  }
}
