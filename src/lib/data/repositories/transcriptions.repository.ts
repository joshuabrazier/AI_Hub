import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import {
  TRANSCRIPTION_IN_FLIGHT_STATUSES,
  type NewTranscription,
  type Transcription,
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
        "byteSize",
        "durationSeconds",
        "speechJobId",
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
// Retention: the storage keys of transcriptions older than the cutoff.
//
// Read BEFORE the delete, because once the rows are gone nothing knows
// which blobs to remove.
// -------------------------------------------------------------------
export async function getExpiredTranscriptionKeysRepo(
  cutoff: Date,
  db: DBClient = database,
): Promise<{ id: string; storageKey: string }[]> {
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

    return rows.map((row) => row.storageKey);
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
