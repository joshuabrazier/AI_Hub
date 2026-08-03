import "server-only";

import { handleError } from "@/lib/handle-errors";
import { database, DBClient } from "../kysely-database-client";

// -------------------------------------------------------------------
// Login sessions (better-auth), not class sessions - the dated occurrences
// of a class are class_sessions.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Delete every login session for a user. This is the session-invalidation
// primitive: deactivating an account only stops the next sign-in, so an
// already-signed-in user keeps their access until their sessions are gone.
// Takes a DBClient so it can run in the same transaction as the change that
// revoked the access, leaving no window where one landed without the other.
// -------------------------------------------------------------------
export async function deleteSessionsByUserIdRepo(userId: string, db: DBClient = database): Promise<void> {
  try {
    await db.deleteFrom("sessions").where("userId", "=", userId).execute();
  } catch (error) {
    throw handleError("deleteSessionsByUserIdRepo", error);
  }
}
