import "server-only";

import { deleteTextSummariesOlderThanRepo } from "@/lib/data/repositories/text-summaries.repository";
import { envServer } from "@/lib/env-server";
import { handleError } from "@/lib/handle-errors";

// -------------------------------------------------------------------
// ===================================================================
// SAVED SUMMARIES DO NOT LIVE FOREVER
// ===================================================================
//
// THIS IS WHAT MAKES STORING THEM DEFENSIBLE, so it went in with the table
// rather than after it. The material in `text_summaries` is whatever
// somebody pasted - contracts, board papers, letters - and a table of that
// which only ever grows is a liability that compounds on its own: every
// month it holds more, and every month the consequences of losing control
// of it get worse, for material nobody has looked at since the afternoon
// they pasted it.
//
// A YEAR BY DEFAULT, matching AI chat rather than transcription. The two
// are the same kind of thing: a person's own private working material, kept
// for that person's own use, with no operational reason to age out sooner.
// Transcription's ninety days is about the size of the recordings, which
// does not apply here.
//
// NO GRACE FOR RECENT USE. Age is from `created_at` and nothing touches it
// afterwards, so opening a summary does not extend its life. That is
// deliberate: a retention window somebody can reset by reading is one that
// never expires for the documents they care most about, which are exactly
// the ones the window exists for.
// -------------------------------------------------------------------
export async function purgeExpiredTextSummariesService(): Promise<{
  retentionDays: number;
  purgedSummaries: number;
}> {
  try {
    const retentionDays = envServer.TEXT_SUMMARY_RETENTION_DAYS;

    // Zero means "keep indefinitely", the same convention every other
    // retention window in this app uses. It is a legitimate setting and a
    // deliberate one; it is not the default.
    if (retentionDays <= 0) return { retentionDays: 0, purgedSummaries: 0 };

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    return { retentionDays, purgedSummaries: await deleteTextSummariesOlderThanRepo(cutoff) };
  } catch (error) {
    throw handleError("purgeExpiredTextSummariesService", error);
  }
}
