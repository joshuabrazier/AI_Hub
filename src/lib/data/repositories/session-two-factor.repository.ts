import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import type { SessionTwoFactor } from "../kysely-database-types";

// -------------------------------------------------------------------
// Per-session two-factor state.
//
// Everything here is keyed on the SESSION id, which the caller reads from
// the session itself - never from a request. There is no shape in which one
// session could mark another verified.
// -------------------------------------------------------------------

export async function getSessionTwoFactorRepo(
  sessionId: string,
  db: DBClient = database,
): Promise<SessionTwoFactor | undefined> {
  try {
    return await db
      .selectFrom("sessionTwoFactor")
      .selectAll()
      .where("sessionId", "=", sessionId)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getSessionTwoFactorRepo", error);
  }
}

// -------------------------------------------------------------------
// Mark this session through.
//
// An upsert because the row usually already exists from a failed attempt,
// and clearing the counters on success is deliberate: the lockout protects
// against guessing, and somebody who has just proved they hold the secret
// is not guessing.
// -------------------------------------------------------------------
export async function markSessionTwoFactorVerifiedRepo(
  sessionId: string,
  db: DBClient = database,
): Promise<void> {
  try {
    const now = new Date();

    await db
      .insertInto("sessionTwoFactor")
      .values({ sessionId, verifiedAt: now, failedCount: 0, lockedUntil: null })
      .onConflict((conflict) =>
        conflict.column("sessionId").doUpdateSet({
          verifiedAt: now,
          failedCount: 0,
          lockedUntil: null,
          updatedAt: now,
        }),
      )
      .execute();
  } catch (error) {
    throw handleError("markSessionTwoFactorVerifiedRepo", error);
  }
}

// -------------------------------------------------------------------
// Record a wrong code, and return the new count.
//
// The increment happens in the database rather than read-modify-write in
// the service, so two requests racing cannot both read 4 and both write 5.
// A six-digit code is 1,000,000 guesses; a lost increment is a free one.
// -------------------------------------------------------------------
export async function recordSessionTwoFactorFailureRepo(
  sessionId: string,
  lockAfter: number,
  lockFor: { minutes: number },
  db: DBClient = database,
): Promise<number> {
  try {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + lockFor.minutes * 60 * 1000);

    const row = await db
      .insertInto("sessionTwoFactor")
      .values({ sessionId, verifiedAt: null, failedCount: 1, lockedUntil: null })
      .onConflict((conflict) =>
        conflict.column("sessionId").doUpdateSet((eb) => ({
          failedCount: eb("sessionTwoFactor.failedCount", "+", 1),
          // Locked once the incremented count reaches the threshold. Compared
          // against the pre-increment value because the SET clause cannot see
          // its own result.
          lockedUntil: eb
            .case()
            .when(eb("sessionTwoFactor.failedCount", ">=", lockAfter - 1))
            .then(lockedUntil)
            .else(null)
            .end(),
          updatedAt: now,
        })),
      )
      .returning("failedCount")
      .executeTakeFirst();

    return row?.failedCount ?? 1;
  } catch (error) {
    throw handleError("recordSessionTwoFactorFailureRepo", error);
  }
}

// -------------------------------------------------------------------
// Drop every verification a user holds.
//
// Called when 2FA is turned off or reset for somebody: the sessions stay
// signed in, but any that were riding on a verification lose it and are
// re-challenged. Without this, disabling and re-enrolling would leave
// already-verified sessions through on the old secret.
// -------------------------------------------------------------------
export async function clearSessionTwoFactorForUserRepo(
  userId: string,
  db: DBClient = database,
): Promise<void> {
  try {
    await db
      .deleteFrom("sessionTwoFactor")
      .where("sessionId", "in", (eb) =>
        eb.selectFrom("sessions").select("sessions.id").where("sessions.userId", "=", userId),
      )
      .execute();
  } catch (error) {
    throw handleError("clearSessionTwoFactorForUserRepo", error);
  }
}
