import "server-only";

import {
  deleteTranscriptionsOlderThanRepo,
  getAllTranscriptionStorageKeysRepo,
  getExpiredTranscriptionKeysRepo,
} from "@/lib/data/repositories/transcriptions.repository";
import { envServer } from "@/lib/env-server";
import { deleteMedia, isMediaStorageConfigured, listAllMediaKeys } from "@/lib/storage/media-storage";

// -------------------------------------------------------------------
// Transcription retention.
//
// Deletes transcriptions older than TRANSCRIPTION_RETENTION_DAYS, and
// clears any recording still held for them. Run from the monthly job.
//
// Kept separate from the transcription service for the same reason chat's
// is: everything in that file resolves the acting user from the session and
// scopes every query to them, and this has no session at all - it runs
// behind the retention endpoint's bearer secret. Mixing an unscoped delete
// in among session-scoped reads is how one gets called from the wrong place.
//
// NOT gated on RETENTION_JOB_ENABLED. That switch guards an irreversible
// scrub of a person's identity across the whole system; this is routine
// rotation of the user's own recordings on a window they can see. Set
// TRANSCRIPTION_RETENTION_DAYS to 0 to keep transcripts indefinitely.
//
// MOST ROWS HAVE NO FILE BY THE TIME THEY GET HERE. A recording is deleted
// as soon as its transcript is stored, so the media this sweep finds
// belongs to the jobs that FAILED - which keep their file on purpose, so
// they can be retried - and to jobs abandoned before they ever started.
// Both are exactly the kind of thing nothing else would ever collect.
//
// A TEAMS IMPORT NEVER HAD ONE AT ALL. Its row expires on the same window
// as everything else; it simply has no blob behind it.
// -------------------------------------------------------------------
export type TranscriptionPurgeResult = {
  // The window applied, in days. 0 means purging is off.
  retentionDays: number;
  // Transcriptions deleted (0 when off).
  purgedTranscriptions: number;
  // Recordings still held by those rows, removed before them.
  purgedMedia: number;
  // Recordings the database no longer claims, removed by the
  // reconciliation pass. A steady non-zero number here means a delete path
  // is missing its storage cleanup - worth investigating rather than
  // tolerating. The expected source is de-identifying a user, which
  // cascades to these rows without any transcription code running.
  purgedOrphanedMedia: number;
};

// An instant comparison against a timestamptz, so UTC is correct and no
// app-zone conversion is needed.
const cutoffFor = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

export async function purgeExpiredTranscriptionsService(): Promise<TranscriptionPurgeResult> {
  const retentionDays = envServer.TRANSCRIPTION_RETENTION_DAYS;

  // With no storage configured there is nothing to reconcile, and the
  // storage helpers would throw on a missing connection string.
  const storageConfigured = isMediaStorageConfigured();

  // ---------------------------------------------------------------
  // Expired transcriptions. Files first, then rows - once the rows are
  // gone nothing knows which recordings to remove.
  // ---------------------------------------------------------------
  let purgedTranscriptions = 0;
  let purgedMedia = 0;

  if (retentionDays > 0) {
    const cutoff = cutoffFor(retentionDays);

    if (storageConfigured) {
      // Read under the SAME predicate the delete uses. If the two ever
      // drift apart, recordings are orphaned silently - which is what the
      // reconciliation pass below exists to catch, but it is far better not
      // to create the problem.
      const expiring = await getExpiredTranscriptionKeysRepo(cutoff);

      for (const row of expiring) {
        // A Teams import never had media - Teams transcribed the meeting
        // and only the text was fetched - so there is no blob to remove and
        // nothing to count. The row itself still expires with the rest.
        if (!row.storageKey) continue;

        await deleteMedia(row.storageKey);
        purgedMedia += 1;
      }
    }

    purgedTranscriptions = await deleteTranscriptionsOlderThanRepo(cutoff);
  }

  // ---------------------------------------------------------------
  // Reconciliation. The backstop, and the only thing that catches
  // recordings orphaned by a cascade this code never saw.
  //
  // Runs LAST, so everything deleted above is already reflected in both
  // the database and the container and cannot be mistaken for an orphan.
  // The database side is read AFTER the blob listing for the same reason
  // in the other direction: a recording uploaded mid-sweep appears in the
  // listing but would be missing from an earlier snapshot of the rows, and
  // deleting it would destroy a file somebody is in the middle of sending.
  // ---------------------------------------------------------------
  let purgedOrphanedMedia = 0;

  if (storageConfigured) {
    const blobKeys = await listAllMediaKeys();
    const claimed = new Set(await getAllTranscriptionStorageKeysRepo());

    for (const key of blobKeys) {
      if (claimed.has(key)) continue;

      await deleteMedia(key);
      purgedOrphanedMedia += 1;
    }
  }

  return {
    retentionDays: retentionDays > 0 ? retentionDays : 0,
    purgedTranscriptions,
    purgedMedia,
    purgedOrphanedMedia,
  };
}
