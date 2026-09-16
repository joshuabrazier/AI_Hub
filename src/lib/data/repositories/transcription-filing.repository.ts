import "server-only";

import { sql } from "kysely";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import {
  NewTranscriptionFiling,
  TRANSCRIPTION_FILING_STATUSES,
  TRANSCRIPTION_SOURCES,
  TranscriptionFiling,
  TranscriptionFilingStatus,
  UpdateTranscriptionFiling,
} from "../kysely-database-types";

// -------------------------------------------------------------------
// The record of what this app put into somebody else's SharePoint.
//
// ONE ROW PER TRANSCRIPTION, enforced by a unique constraint, and that
// constraint is doing real work rather than tidying. SharePoint accepts a
// second upload of the same file name as a NEW VERSION, not an error - so a
// sweep that retried without a "this one is done" marker would quietly fill
// a client folder with copies of one meeting, and every copy would look
// legitimate.
//
// So the claim below is the gate: whoever inserts the row owns the upload,
// and everybody else walks away. It is the same shape as
// claimTranscriptionTransitionRepo, for the same reason - several sweeps
// reach the same finished meeting at once and only one may pay for it.
//
// Every read is scoped by user_id, except the sweep's own due-work query.
// The row names whose delegated token an upload runs on, so a caller able to
// fetch somebody else's row could cause a write to SharePoint as them.
// -------------------------------------------------------------------

export async function getTranscriptionFilingRepo(
  transcriptionId: string,
  userId: string,
  db: DBClient = database,
): Promise<TranscriptionFiling | undefined> {
  try {
    return await db
      .selectFrom("transcriptionFiling")
      .selectAll()
      .where("transcriptionId", "=", transcriptionId)
      .where("userId", "=", userId)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getTranscriptionFilingRepo", error);
  }
}

// -------------------------------------------------------------------
// Claim the right to file this transcription.
//
// Returns the row on success and UNDEFINED when somebody else already holds
// it - the caller's cue to do nothing at all. Written as an insert with
// DO NOTHING rather than a read-then-write, because a read-then-write has a
// window between the two halves and two sweeps landing in that window is
// exactly the case this exists to prevent.
//
// A row in 'pending' whose attempt died is retried by the sweep, not by a
// second claim - see markTranscriptionFilingAttemptRepo. That keeps the
// attempt counter honest: retries are counted, and a claim happens once.
// -------------------------------------------------------------------
export async function claimTranscriptionFilingRepo(
  row: NewTranscriptionFiling,
  db: DBClient = database,
): Promise<TranscriptionFiling | undefined> {
  try {
    return await db
      .insertInto("transcriptionFiling")
      .values(row)
      .onConflict((oc) => oc.column("transcriptionId").doNothing())
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("claimTranscriptionFilingRepo", error);
  }
}

export async function updateTranscriptionFilingRepo(
  filingId: string,
  patch: UpdateTranscriptionFiling,
  db: DBClient = database,
): Promise<TranscriptionFiling | undefined> {
  try {
    // The identity columns are stripped before the spread, matching the
    // transcriptions repository. A caller-supplied id in a patch rewrites the
    // primary key; a caller-supplied transcription_id or user_id moves the
    // record of a SharePoint write onto somebody else's meeting. Neither is
    // ever intended, so neither is accepted.
    const safePatch = { ...patch };
    delete safePatch.id;
    delete safePatch.transcriptionId;
    delete safePatch.userId;
    delete safePatch.createdAt;

    return await db
      .updateTable("transcriptionFiling")
      // Nothing stamps updated_at in the database, so the repository does.
      .set({ ...safePatch, updatedAt: new Date() })
      .where("id", "=", filingId)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateTranscriptionFilingRepo", error);
  }
}

// -------------------------------------------------------------------
// Count an attempt, and only for a row still worth attempting.
//
// The status predicate is what makes two sweeps meeting the same pending row
// safe: the loser's update matches nothing and it moves on. The counter is
// what stops a permanently broken destination being retried forever - a
// folder somebody deleted fails identically every few minutes otherwise, and
// the log fills with it.
// -------------------------------------------------------------------
export async function markTranscriptionFilingAttemptRepo(
  filingId: string,
  db: DBClient = database,
): Promise<TranscriptionFiling | undefined> {
  try {
    return await db
      .updateTable("transcriptionFiling")
      .set((eb) => ({ attempts: eb("attempts", "+", 1), updatedAt: new Date() }))
      .where("id", "=", filingId)
      .where("status", "=", TRANSCRIPTION_FILING_STATUSES.PENDING)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("markTranscriptionFilingAttemptRepo", error);
  }
}

// -------------------------------------------------------------------
// What the background sweep should pick up: still pending, not yet given up
// on. Oldest first, so the longest-waiting meeting is filed first, and
// capped so one pass after an outage cannot pull an unbounded set into
// memory.
// -------------------------------------------------------------------
export async function getPendingTranscriptionFilingsRepo(
  options: { maxAttempts: number; limit: number },
  db: DBClient = database,
): Promise<TranscriptionFiling[]> {
  try {
    return await db
      .selectFrom("transcriptionFiling")
      .selectAll()
      .where("status", "=", TRANSCRIPTION_FILING_STATUSES.PENDING)
      .where("attempts", "<", options.maxAttempts)
      .orderBy("createdAt", "asc")
      .limit(options.limit)
      .execute();
  } catch (error) {
    throw handleError("getPendingTranscriptionFilingsRepo", error);
  }
}

// -------------------------------------------------------------------
// The filing rows for a set of transcriptions, for the screen.
//
// Scoped by owner as well as by id, because the ids come from a page the
// caller was already shown - belt and braces costs one predicate here and
// removes a whole class of mistake in whatever calls it later.
// -------------------------------------------------------------------
export async function getTranscriptionFilingsForUserRepo(
  transcriptionIds: readonly string[],
  userId: string,
  db: DBClient = database,
): Promise<TranscriptionFiling[]> {
  if (transcriptionIds.length === 0) return [];

  try {
    return await db
      .selectFrom("transcriptionFiling")
      .selectAll()
      .where("userId", "=", userId)
      .where("transcriptionId", "in", [...transcriptionIds])
      .execute();
  } catch (error) {
    throw handleError("getTranscriptionFilingsForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// How filing is going, as COUNTS AND NOTHING ELSE.
//
// THE ONLY UNSCOPED READ IN THIS FILE, and the shape is the reason it is
// allowed to be. Every other function here is scoped by owner because a
// filing row names whose delegated token wrote to SharePoint. This one is
// for an administrator asking "is filing working", and that question is
// answerable with four numbers.
//
// IT DELIBERATELY RETURNS NO TITLES, NO PATHS AND NO REASONS. A
// transcription is private from other users - that is the whole access
// model of the feature - and a meeting title is often the most disclosive
// thing about it ("Bowhill redundancy consultation"). An admin list of
// everybody's filings would quietly undo that in a screen nobody thought of
// as a privacy surface. The counts say whether the configuration is right,
// which is what an admin can actually act on; the reason for one particular
// filing is shown to the person whose meeting it was.
//
// The split between 'nowhere' and 'failed' is the actionable part: the
// first means the configuration cannot choose a destination, the second
// means SharePoint refused. Different people fix those.
// -------------------------------------------------------------------
export type TranscriptionFilingCounts = Record<TranscriptionFilingStatus, number>;

export async function countTranscriptionFilingsByStatusRepo(
  db: DBClient = database,
): Promise<TranscriptionFilingCounts> {
  try {
    const rows = await db
      .selectFrom("transcriptionFiling")
      .select(({ fn }) => ["status", fn.countAll<string>().as("count")])
      .groupBy("status")
      .execute();

    // Started from zeroes so a status with no rows reads as none rather than
    // as absent, and the caller never has to decide what a missing key means.
    const counts: TranscriptionFilingCounts = {
      [TRANSCRIPTION_FILING_STATUSES.PENDING]: 0,
      [TRANSCRIPTION_FILING_STATUSES.AWAITING_APPROVAL]: 0,
      [TRANSCRIPTION_FILING_STATUSES.FILED]: 0,
      [TRANSCRIPTION_FILING_STATUSES.NOWHERE]: 0,
      [TRANSCRIPTION_FILING_STATUSES.FAILED]: 0,
    };

    for (const row of rows) {
      // count() comes back as a string because Postgres counts in bigint and
      // node-postgres will not silently narrow one.
      counts[row.status] = Number(row.count ?? 0);
    }

    return counts;
  } catch (error) {
    throw handleError("countTranscriptionFilingsByStatusRepo", error);
  }
}

// -------------------------------------------------------------------
// ===================================================================
// HAS SOMEBODY ELSE ALREADY FILED THIS MEETING?
// ===================================================================
//
// THE ONE READ IN THIS FILE THAT CROSSES USERS, and it is deliberate rather
// than an oversight in the rule above.
//
// Several of our people sit in the same meeting. Each imports it, so each
// gets their own transcription row - that part is right and stays, because a
// transcription is somebody's own private record with their own summary. But
// SHAREPOINT IS SHARED. Filing the same meeting twice puts two copies of one
// set of notes in a client's library, and on a big internal meeting it is
// however many people were in the room.
//
// WHY A CROSS-USER LOOKUP IS SAFE HERE, which is the question worth
// answering before adding one:
//
//   The key is the TRANSCRIPT ID, and Graph only hands that to somebody it
//   has already decided may read the transcript - every call in this feature
//   is delegated, so attendance is enforced by Microsoft and not by us. A
//   caller therefore cannot ask about a meeting they were not in: they would
//   have no transcript id to ask with. What comes back is that a colleague
//   filed a meeting THIS PERSON also attended, and a link to a file they can
//   already open.
//
//   It returns no transcript, no summary and no content. Only where the
//   notes went, who put them there, and when.
//
// WHY THE TRANSCRIPT HALF AND NOT THE WHOLE source_ref. A source ref is
// `eventId|transcriptId`, and an EVENT ID IS PER MAILBOX - each attendee
// holds their own copy of the calendar item with its own id, so two people
// in one meeting have two different source refs. The transcript half is a
// property of the online meeting itself, resolved from the join URL everyone
// shares, so it is the same for all of them. It is the only part of the ref
// that identifies the MEETING rather than somebody's view of it.
//
// split_part rather than LIKE, because a LIKE pattern would have to escape
// whatever Graph put in the id and a wildcard match could hit an event id
// that merely ends the same way.
// -------------------------------------------------------------------
export type FiledElsewhere = {
  filingId: string;
  userId: string;
  /** Who filed it, for the sentence shown to the second person. */
  userName: string | null;
  filedAt: Date | null;
  driveId: string | null;
  folderItemId: string | null;
  folderPath: string | null;
  fileItemId: string | null;
  fileWebUrl: string | null;
  fileName: string | null;
};

export async function findFiledCopyByTranscriptIdRepo(
  transcriptId: string,
  excludeUserId: string,
  db: DBClient = database,
): Promise<FiledElsewhere | null> {
  try {
    // An empty id would match every row whose source ref has no second half.
    // Refused here rather than trusted to the caller, because the cost of
    // getting it wrong is linking somebody's notes to an unrelated file.
    if (transcriptId.trim().length === 0) return null;

    const row = await db
      .selectFrom("transcriptionFiling as f")
      .innerJoin("transcriptions as t", "t.id", "f.transcriptionId")
      .leftJoin("users as u", "u.id", "f.userId")
      .select([
        "f.id as filingId",
        "f.userId as userId",
        "u.name as userName",
        "f.filedAt as filedAt",
        "f.driveId as driveId",
        "f.folderItemId as folderItemId",
        "f.folderPath as folderPath",
        "f.fileItemId as fileItemId",
        "f.fileWebUrl as fileWebUrl",
        "f.fileName as fileName",
      ])
      .where("f.status", "=", TRANSCRIPTION_FILING_STATUSES.FILED)
      // Somebody else's. This person's own row is handled by the
      // already-filed refusal in the service and says something different.
      .where("f.userId", "!=", excludeUserId)
      .where("t.source", "=", TRANSCRIPTION_SOURCES.TEAMS)
      .where(sql<string>`split_part(${sql.ref("t.sourceRef")}, '|', 2)`, "=", transcriptId)
      // A file item id is what makes the copy LINKABLE. A filed row without
      // one cannot be offered to the second person, so it is not a copy for
      // this purpose.
      .where("f.fileItemId", "is not", null)
      // The earliest, so repeated runs name the same person rather than
      // whichever row the planner happened to return.
      .orderBy("f.filedAt")
      .orderBy("f.id")
      .executeTakeFirst();

    return row ?? null;
  } catch (error) {
    throw handleError("findFiledCopyByTranscriptIdRepo", error);
  }
}
