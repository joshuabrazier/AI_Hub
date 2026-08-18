import "server-only";

import {
  deleteStagedAiChatAttachmentsOlderThanRepo,
  getAllAiChatAttachmentKeysRepo,
} from "@/lib/data/repositories/ai-chat-attachments.repository";
import { deleteAiChatRequestLogsOlderThanRepo } from "@/lib/data/repositories/ai-chat-request-logs.repository";
import {
  deleteAiChatSubjectsInactiveSinceRepo,
  getAiChatSubjectIdsInactiveSinceRepo,
} from "@/lib/data/repositories/ai-chat-subjects.repository";
import { envServer } from "@/lib/env-server";
import {
  deleteAttachment,
  deleteAttachmentsForSubject,
  isAttachmentStorageConfigured,
  listAllAttachmentKeys,
} from "@/lib/storage/attachment-storage";

// -------------------------------------------------------------------
// AI chat retention.
//
// Deletes conversations with no activity for AI_CHAT_RETENTION_DAYS, and
// their messages cascade. Run from the monthly job.
//
// Kept separate from the chat service on purpose: everything in that file
// resolves the acting user from the session and scopes every query to them,
// and this has no session at all - it runs behind the retention endpoint's
// bearer secret. Mixing an unscoped delete in among the session-scoped reads
// is how one gets called from the wrong place.
//
// NOT gated on RETENTION_JOB_ENABLED, unlike de-identification. That switch
// guards an irreversible scrub of a person's identity across the whole
// system; this is routine rotation of the user's own chat transcripts on a
// window they can see, closer to the audit-log purge. Set
// AI_CHAT_RETENTION_DAYS to 0 to keep chat history indefinitely.
//
// ATTACHMENTS ARE THE HARD PART, and the reason this file grew. The files
// live in Azure Blob, so a Postgres cascade removes the ROW and cannot
// touch the file. Three of the four passes below exist for that:
//
//   - expiring conversations have their blobs cleared BEFORE the rows go,
//     because once the rows are gone nothing knows which files to remove;
//   - the staged sweep returns the keys it deleted so their blobs follow;
//   - the reconciliation pass catches everything else - most importantly
//     files orphaned when a user was de-identified, which cascades through
//     conversations to attachment rows without this code being involved at
//     all. Without that pass those files would be paid for forever.
// -------------------------------------------------------------------
export type AiChatPurgeResult = {
  // The window applied, in days. 0 means purging is off.
  retentionDays: number;
  // Conversations deleted (0 when off). Messages go with them.
  purgedSubjects: number;
  // The request log has its own, shorter window - it duplicates private
  // content that admins can read, and it grows quadratically with thread
  // length, so it is not tied to how long the chats themselves are kept.
  logRetentionDays: number;
  purgedRequestLogs: number;
  // Files uploaded but never sent. Measured in HOURS, and independent of
  // both windows above: an abandoned upload is not history anybody is
  // keeping, it is bytes with no message to belong to.
  stagedAttachmentHours: number;
  purgedStagedAttachments: number;
  // Blobs the database no longer claims, removed by the reconciliation
  // pass. A steady non-zero number here means something is deleting rows
  // without clearing files first - worth investigating rather than
  // tolerating.
  purgedOrphanedBlobs: number;
};

// An instant comparison against a timestamptz, so UTC is correct and no
// app-zone conversion is needed.
const cutoffFor = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const cutoffForHours = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

export async function purgeExpiredAiChatsService(): Promise<AiChatPurgeResult> {
  const retentionDays = envServer.AI_CHAT_RETENTION_DAYS;
  const logRetentionDays = envServer.AI_CHAT_LOG_RETENTION_DAYS;
  const stagedAttachmentHours = envServer.AI_CHAT_STAGED_ATTACHMENT_HOURS;

  // With no storage configured there are no blobs to reconcile, and the
  // storage helpers would throw on a missing connection string.
  const storageConfigured = isAttachmentStorageConfigured();

  // ---------------------------------------------------------------
  // Expired conversations. Files first, then rows.
  // ---------------------------------------------------------------
  let purgedSubjects = 0;

  if (retentionDays > 0) {
    const cutoff = cutoffFor(retentionDays);

    if (storageConfigured) {
      // Read the ids under the SAME predicate the delete uses. If the two
      // ever drift apart, files are orphaned silently - which is exactly
      // the failure the reconciliation pass below exists to catch, but it
      // is far better not to create it.
      const expiring = await getAiChatSubjectIdsInactiveSinceRepo(cutoff);

      for (const subjectId of expiring) {
        await deleteAttachmentsForSubject(subjectId);
      }
    }

    purgedSubjects = await deleteAiChatSubjectsInactiveSinceRepo(cutoff);
  }

  // ---------------------------------------------------------------
  // The request log, which holds no files.
  // ---------------------------------------------------------------
  const purgedRequestLogs =
    logRetentionDays > 0 ? await deleteAiChatRequestLogsOlderThanRepo(cutoffFor(logRetentionDays)) : 0;

  // ---------------------------------------------------------------
  // Uploads that were never sent. The repo hands back the keys so the
  // blobs can follow the rows.
  // ---------------------------------------------------------------
  let purgedStagedAttachments = 0;

  if (stagedAttachmentHours > 0) {
    const staleKeys = await deleteStagedAiChatAttachmentsOlderThanRepo(cutoffForHours(stagedAttachmentHours));

    purgedStagedAttachments = staleKeys.length;

    if (storageConfigured) {
      for (const key of staleKeys) {
        await deleteAttachment(key);
      }
    }
  }

  // ---------------------------------------------------------------
  // Reconciliation. The backstop, and the only thing that catches files
  // orphaned by a cascade this code never saw.
  //
  // Runs LAST, so everything deleted above is already reflected in both
  // the database and the container and cannot be mistaken for an orphan.
  // The database side is read AFTER the blob listing for the same reason
  // in the other direction: a file uploaded mid-sweep appears in the
  // listing but would be missing from an earlier snapshot of the rows, and
  // deleting it would destroy a file somebody just attached.
  // ---------------------------------------------------------------
  let purgedOrphanedBlobs = 0;

  if (storageConfigured) {
    const blobKeys = await listAllAttachmentKeys();
    const claimed = new Set(await getAllAiChatAttachmentKeysRepo());

    for (const key of blobKeys) {
      if (claimed.has(key)) continue;

      await deleteAttachment(key);
      purgedOrphanedBlobs += 1;
    }
  }

  return {
    retentionDays: retentionDays > 0 ? retentionDays : 0,
    purgedSubjects,
    logRetentionDays: logRetentionDays > 0 ? logRetentionDays : 0,
    purgedRequestLogs,
    stagedAttachmentHours: stagedAttachmentHours > 0 ? stagedAttachmentHours : 0,
    purgedStagedAttachments,
    purgedOrphanedBlobs,
  };
}
