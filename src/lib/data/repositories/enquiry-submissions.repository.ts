import "server-only";

import { generateId } from "better-auth";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";

// -------------------------------------------------------------------
// Enquiry submissions - a small throttling ledger used to rate-limit the
// public enquiry form per IP. Not a record of enquiry content (that's emailed).
// -------------------------------------------------------------------

// How many enquiries from one IP since `since` (the start of the rate window).
export async function countRecentEnquiriesByIpRepo(ipAddress: string, since: Date): Promise<number> {
  try {
    const row = await database
      .selectFrom("enquirySubmissions")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("ipAddress", "=", ipAddress)
      .where("createdAt", ">=", since)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  } catch (error) {
    throw handleError("countRecentEnquiriesByIpRepo", error);
  }
}

// Record one sent enquiry against an IP, and prune rows older than a day so the
// ledger stays tiny (it exists only for the rolling rate window).
//
// The prune is swallowed separately: once the row is in, the throttle is
// correct, and failing the call over housekeeping would tell the caller the
// enquiry went unrecorded when it did not.
export async function recordEnquirySubmissionRepo(
  ipAddress: string | null,
  db: DBClient = database,
): Promise<void> {
  try {
    await db.insertInto("enquirySubmissions").values({ id: generateId(), ipAddress }).execute();
  } catch (error) {
    throw handleError("recordEnquirySubmissionRepo", error);
  }

  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // Always the pool, never the caller's `db`. Swallowing the error only
    // works if it stays swallowed, and a statement that fails inside a
    // transaction aborts that transaction no matter what this catch does.
    await database.deleteFrom("enquirySubmissions").where("createdAt", "<", cutoff).execute();
  } catch (error) {
    handleError("recordEnquirySubmissionRepo.prune", error);
  }
}
