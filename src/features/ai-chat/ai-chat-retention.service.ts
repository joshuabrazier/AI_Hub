import "server-only";

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
};

export async function purgeExpiredAiChatsService(): Promise<AiChatPurgeResult> {
  const retentionDays = envServer.AI_CHAT_RETENTION_DAYS;

  if (retentionDays <= 0) {
    return { retentionDays: 0, purgedSubjects: 0 };
  }

  // An instant comparison against a timestamptz, so UTC is correct and no
  // app-zone conversion is needed.
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const purgedSubjects = await deleteAiChatSubjectsInactiveSinceRepo(cutoff);

  return { retentionDays, purgedSubjects };
}
