import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import {
  NewTranscriptionFiling,
  TRANSCRIPTION_FILING_STATUSES,
  TranscriptionFiling,
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
    // `id` is stripped before the spread. A caller-supplied id in a patch
    // would rewrite the primary key, and `updatedAt` is set here because
    // this table has no trigger for it - both are house rules that have
    // bitten before.
    const { id: _ignored, ...fields } = patch;

    return await db
      .updateTable("transcriptionFiling")
      .set({ ...fields, updatedAt: new Date() })
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
