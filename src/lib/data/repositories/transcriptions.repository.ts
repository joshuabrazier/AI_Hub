import "server-only";

import { sql } from "kysely";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import {
  TRANSCRIPTION_IN_FLIGHT_STATUSES,
  TRANSCRIPTION_STATUSES,
  type NewTranscription,
  type Transcription,
  type TranscriptionSource,
  type TranscriptionStatus,
  type UpdateTranscription,
} from "../kysely-database-types";

// -------------------------------------------------------------------
// Meeting transcriptions.
//
// Same boundary as AI chat: `user_id` IS the authorization check, not a
// filter applied after one, so every function here takes it and puts it
// in the WHERE clause. A recording of a meeting is at least as private as
// a chat transcript.
//
// The three unscoped functions at the bottom are the retention pass, and
// they are reachable only from the monthly job behind its bearer secret.
// Everything above them takes a user id and puts it in the WHERE clause.
// -------------------------------------------------------------------

export async function addTranscriptionRepo(
  newTranscription: NewTranscription,
  db: DBClient = database,
): Promise<Transcription> {
  try {
    return await db
      .insertInto("transcriptions")
      .values(newTranscription)
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addTranscriptionRepo", error);
  }
}

// -------------------------------------------------------------------
// This user's transcriptions, newest first.
//
// Deliberately does NOT select `transcript` or `segments`: the list shows
// titles and status, and an hour of transcript per row would make opening
// the screen load megabytes nobody reads.
// -------------------------------------------------------------------
export async function getTranscriptionsForUserRepo(
  userId: string,
  db: DBClient = database,
): Promise<Omit<Transcription, "transcript" | "segments" | "summary">[]> {
  try {
    return await db
      .selectFrom("transcriptions")
      .select([
        "id",
        "userId",
        "title",
        "source",
        "status",
        "storageKey",
        "mediaType",
        "sourceRef",
        "byteSize",
        "durationSeconds",
        "speechJobId",
        "summaryAttempts",
        "summaryStartedAt",
        "error",
        "createdAt",
        "updatedAt",
        "completedAt",
      ])
      .where("userId", "=", userId)
      .orderBy("createdAt", "desc")
      .execute();
  } catch (error) {
    throw handleError("getTranscriptionsForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// One transcription, but only if this user owns it. Undefined otherwise -
// the same answer a missing id gets, so a guessed id cannot confirm that
// somebody else's recording exists.
// -------------------------------------------------------------------
export async function getTranscriptionForUserRepo(
  transcriptionId: string,
  userId: string,
  db: DBClient = database,
): Promise<Transcription | undefined> {
  try {
    return await db
      .selectFrom("transcriptions")
      .selectAll()
      .where("id", "=", transcriptionId)
      .where("userId", "=", userId)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getTranscriptionForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// Update one the caller owns. Undefined when it is not theirs.
// -------------------------------------------------------------------
export async function updateTranscriptionForUserRepo(
  transcriptionId: string,
  userId: string,
  patch: UpdateTranscription,
  db: DBClient = database,
): Promise<Transcription | undefined> {
  try {
    // Updateable allows id, userId and createdAt. None is ever
    // legitimately patched, and an id in a patch would rewrite the primary
    // key of whichever row the WHERE matched.
    const safePatch: UpdateTranscription = { ...patch };
    delete safePatch.id;
    delete safePatch.userId;
    delete safePatch.createdAt;

    return await db
      .updateTable("transcriptions")
      // Nothing stamps updated_at in the database, so the repository does.
      .set({ ...safePatch, updatedAt: new Date() })
      .where("id", "=", transcriptionId)
      .where("userId", "=", userId)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("updateTranscriptionForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// Move a transcription on, but ONLY from the status it is expected to be
// in. Undefined when it has already moved.
//
// This is what stops two tabs doing the same expensive work twice. Both
// poll, both can see the same job finish, and without the status predicate
// both would store the transcript and both would pay for a summary. The
// database decides which one wins, because it is the only thing that can.
// -------------------------------------------------------------------
export async function claimTranscriptionTransitionRepo(
  transcriptionId: string,
  userId: string,
  fromStatuses: readonly TranscriptionStatus[],
  patch: UpdateTranscription,
  db: DBClient = database,
): Promise<Transcription | undefined> {
  try {
    const safePatch: UpdateTranscription = { ...patch };
    delete safePatch.id;
    delete safePatch.userId;
    delete safePatch.createdAt;

    return await db
      .updateTable("transcriptions")
      .set({ ...safePatch, updatedAt: new Date() })
      .where("id", "=", transcriptionId)
      .where("userId", "=", userId)
      .where("status", "in", fromStatuses)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("claimTranscriptionTransitionRepo", error);
  }
}

// -------------------------------------------------------------------
// Delete one the caller owns. Returns how many rows went, so a caller can
// tell "deleted" from "was not yours" without a separate ownership read.
//
// The MEDIA is not removed by this - a blob is not reachable from a
// Postgres delete. Callers clear storage first; see the service.
// -------------------------------------------------------------------
export async function deleteTranscriptionForUserRepo(
  transcriptionId: string,
  userId: string,
  db: DBClient = database,
): Promise<number> {
  try {
    const result = await db
      .deleteFrom("transcriptions")
      .where("id", "=", transcriptionId)
      .where("userId", "=", userId)
      .executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  } catch (error) {
    throw handleError("deleteTranscriptionForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// This user's unfinished jobs, oldest first.
//
// Transcribing an hour of audio takes minutes, so a person can easily
// start one and close the tab. Nothing would then move the row on, and it
// would sit at 'transcribing' forever even though the Speech service had
// finished. The service sweeps these on every page load, which is why this
// is scoped to one user rather than run from a job: the person waiting for
// the answer is the one who comes back to look at it.
// -------------------------------------------------------------------
export async function getInFlightTranscriptionsForUserRepo(
  userId: string,
  db: DBClient = database,
): Promise<Transcription[]> {
  try {
    return await db
      .selectFrom("transcriptions")
      .selectAll()
      .where("userId", "=", userId)
      .where("status", "in", TRANSCRIPTION_IN_FLIGHT_STATUSES)
      .orderBy("createdAt")
      .execute();
  } catch (error) {
    throw handleError("getInFlightTranscriptionsForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// Take the right to summarise this row, or find that somebody else has it.
//
// ONE STATEMENT, and it has to be one: it leases the row, counts the
// attempt and enforces the cap together. Split into a read and a write, two
// sweeps arriving at the same moment would both read "free, 1 attempt
// spent" and both proceed - which is the exact duplicate spending this
// exists to stop.
//
// Returns the claimed row on success and undefined when the claim was
// refused, which happens for two different reasons the caller has to tell
// apart: somebody else is working on it right now, or the row has spent its
// allowance. `getTranscriptionForUserRepo` answers which.
//
// The lease predicate reads "nobody holds it, or whoever did has gone
// quiet for longer than the window" - so an attempt killed halfway, by a
// deploy or a dropped request, frees the row on its own rather than
// stranding it.
// -------------------------------------------------------------------
export async function claimSummaryAttemptRepo(
  transcriptionId: string,
  userId: string,
  options: { leaseExpiresBefore: Date; maxAttempts: number; now?: Date },
  db: DBClient = database,
): Promise<Transcription | undefined> {
  try {
    const now = options.now ?? new Date();

    return await db
      .updateTable("transcriptions")
      .set({
        summaryStartedAt: now,
        summaryAttempts: sql<number>`summary_attempts + 1`,
        // NOT updatedAt. The give-up rule reads that column to decide how
        // long a row has been stuck, and bumping it here would reset that
        // clock on every attempt.
      })
      .where("id", "=", transcriptionId)
      .where("userId", "=", userId)
      .where("status", "=", TRANSCRIPTION_STATUSES.SUMMARISING)
      .where("summaryAttempts", "<", options.maxAttempts)
      .where((eb) =>
        eb.or([
          eb("summaryStartedAt", "is", null),
          eb("summaryStartedAt", "<", options.leaseExpiresBefore),
        ]),
      )
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("claimSummaryAttemptRepo", error);
  }
}

// -------------------------------------------------------------------
// Give the row back without counting a further attempt.
//
// For the case where a claim was taken and the work then could not be done
// at all - the summariser is not configured, there is no transcript. The
// attempt is already counted by the claim, so this only clears the lease;
// re-counting or un-counting here would both be wrong.
// -------------------------------------------------------------------
export async function releaseSummaryLeaseRepo(
  transcriptionId: string,
  userId: string,
  db: DBClient = database,
): Promise<void> {
  try {
    await db
      .updateTable("transcriptions")
      .set({ summaryStartedAt: null })
      .where("id", "=", transcriptionId)
      .where("userId", "=", userId)
      .execute();
  } catch (error) {
    throw handleError("releaseSummaryLeaseRepo", error);
  }
}

// -------------------------------------------------------------------
// The one this user already imported from a given source record, if any.
//
// Both the check before an import and the recovery after one: the unique
// index means two simultaneous clicks race, and the loser reads the winner's
// row back through here rather than reporting a constraint violation to
// somebody who only pressed a button twice.
// -------------------------------------------------------------------
export async function getTranscriptionBySourceRefRepo(
  userId: string,
  source: TranscriptionSource,
  sourceRef: string,
  db: DBClient = database,
): Promise<Transcription | undefined> {
  try {
    return await db
      .selectFrom("transcriptions")
      .selectAll()
      .where("userId", "=", userId)
      .where("source", "=", source)
      .where("sourceRef", "=", sourceRef)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getTranscriptionBySourceRefRepo", error);
  }
}

// -------------------------------------------------------------------
// What this user has already imported, keyed by where it came from.
//
// Read whole rather than asked one id at a time: the meetings list shows a
// fortnight at once, and a query per row would be a dozen round trips to
// answer a question the whole set answers in one.
//
// Scoped to the user like everything else here, which is also what makes
// the answer correct: two people in the same meeting each import their own
// copy, so "already imported" is only ever a statement about the person
// asking.
// -------------------------------------------------------------------
export async function getTranscriptionSourceRefsForUserRepo(
  userId: string,
  source: TranscriptionSource,
  db: DBClient = database,
): Promise<{ id: string; sourceRef: string }[]> {
  try {
    const rows = await db
      .selectFrom("transcriptions")
      .select(["id", "sourceRef"])
      .where("userId", "=", userId)
      .where("source", "=", source)
      .where("sourceRef", "is not", null)
      .execute();

    // The predicate above already excludes them; this is what convinces the
    // compiler, and it costs nothing.
    return rows.filter((row): row is { id: string; sourceRef: string } => row.sourceRef !== null);
  } catch (error) {
    throw handleError("getTranscriptionSourceRefsForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// Retention: the storage keys of transcriptions older than the cutoff.
//
// Read BEFORE the delete, because once the rows are gone nothing knows
// which blobs to remove.
//
// A key can be NULL - a Teams import has no media - and the null is
// returned rather than filtered out here, so the caller counts the rows it
// actually deleted a file for instead of the rows it looked at.
// -------------------------------------------------------------------
export async function getExpiredTranscriptionKeysRepo(
  cutoff: Date,
  db: DBClient = database,
): Promise<{ id: string; storageKey: string | null }[]> {
  try {
    return await db
      .selectFrom("transcriptions")
      .select(["id", "storageKey"])
      .where("createdAt", "<", cutoff)
      .execute();
  } catch (error) {
    throw handleError("getExpiredTranscriptionKeysRepo", error);
  }
}

// -------------------------------------------------------------------
// EVERYBODY'S unfinished jobs, oldest first.
//
// For the background sweep, which has no session and therefore no user to
// scope by. It is the only unscoped read of transcription rows, and it
// deliberately returns whole rows rather than a projection - the sweep has
// to act on them, not display them.
//
// Bounded by `limit` so one run cannot pull an unbounded set into memory
// after an outage; anything left over is picked up on the next tick.
// -------------------------------------------------------------------
export async function getAllInFlightTranscriptionsRepo(
  limit: number,
  db: DBClient = database,
): Promise<Transcription[]> {
  try {
    return await db
      .selectFrom("transcriptions")
      .selectAll()
      .where("status", "in", TRANSCRIPTION_IN_FLIGHT_STATUSES)
      .orderBy("createdAt")
      .limit(limit)
      .execute();
  } catch (error) {
    throw handleError("getAllInFlightTranscriptionsRepo", error);
  }
}

// -------------------------------------------------------------------
// Every storage key the database still claims.
//
// For the reconciliation pass: anything in the media container whose key
// is not in this set belongs to no row and is nobody's to keep. The big
// case is de-identifying a user, which cascades to these rows without any
// transcription code running - and a cascade cannot delete a blob.
// -------------------------------------------------------------------
export async function getAllTranscriptionStorageKeysRepo(db: DBClient = database): Promise<string[]> {
  try {
    const rows = await db.selectFrom("transcriptions").select("storageKey").execute();

    // Rows with no key claim no blob. Letting a null through would put it
    // in the "still claimed" set, where it matches nothing and means
    // nothing - and would quietly weaken the one check that catches an
    // orphaned recording.
    return rows.map((row) => row.storageKey).filter((key): key is string => key !== null);
  } catch (error) {
    throw handleError("getAllTranscriptionStorageKeysRepo", error);
  }
}

export async function deleteTranscriptionsOlderThanRepo(
  cutoff: Date,
  db: DBClient = database,
): Promise<number> {
  try {
    const result = await db.deleteFrom("transcriptions").where("createdAt", "<", cutoff).executeTakeFirst();

    return Number(result.numDeletedRows ?? 0);
  } catch (error) {
    throw handleError("deleteTranscriptionsOlderThanRepo", error);
  }
}
