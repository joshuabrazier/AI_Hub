import "server-only";

import { deleteStagedAiChatAttachmentsOlderThanRepo } from "@/lib/data/repositories/ai-chat-attachments.repository";
import { deleteAiChatRequestLogsOlderThanRepo } from "@/lib/data/repositories/ai-chat-request-logs.repository";
import { deleteAiChatSubjectsInactiveSinceRepo } from "@/lib/data/repositories/ai-chat-subjects.repository";
import { envServer } from "@/lib/env-server";

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
};

// An instant comparison against a timestamptz, so UTC is correct and no
// app-zone conversion is needed.
const cutoffFor = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const cutoffForHours = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);

export async function purgeExpiredAiChatsService(): Promise<AiChatPurgeResult> {
  const retentionDays = envServer.AI_CHAT_RETENTION_DAYS;
  const logRetentionDays = envServer.AI_CHAT_LOG_RETENTION_DAYS;
  const stagedAttachmentHours = envServer.AI_CHAT_STAGED_ATTACHMENT_HOURS;

  // The three windows are independent: purging the log does not touch the
  // conversations, and vice versa. Any of them can be switched off alone.
  const purgedSubjects =
    retentionDays > 0 ? await deleteAiChatSubjectsInactiveSinceRepo(cutoffFor(retentionDays)) : 0;

  const purgedRequestLogs =
    logRetentionDays > 0 ? await deleteAiChatRequestLogsOlderThanRepo(cutoffFor(logRetentionDays)) : 0;

  // Sent attachments are NOT touched here - they cascade with the message
  // and the conversation, so they are already covered by the window above.
  // This only collects uploads that never became part of a turn.
  const purgedStagedAttachments =
    stagedAttachmentHours > 0
      ? await deleteStagedAiChatAttachmentsOlderThanRepo(cutoffForHours(stagedAttachmentHours))
      : 0;

  return {
    retentionDays: retentionDays > 0 ? retentionDays : 0,
    purgedSubjects,
    logRetentionDays: logRetentionDays > 0 ? logRetentionDays : 0,
    purgedRequestLogs,
    stagedAttachmentHours: stagedAttachmentHours > 0 ? stagedAttachmentHours : 0,
    purgedStagedAttachments,
  };
}
