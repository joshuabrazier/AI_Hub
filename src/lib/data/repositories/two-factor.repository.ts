import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";

// -------------------------------------------------------------------
// The two_factor table.
//
// Better Auth's plugin owns this table and normally does every write to it.
// This repository is the ONE deliberate exception, and it exists because the
// plugin has no way to express what an admin reset needs.
//
// `disableTwoFactor` operates on `ctx.context.session.user` - the caller's
// OWN account - so there is no plugin endpoint through which an admin can
// clear somebody else's secret. The whole point of a reset is that the
// person cannot authenticate, so it can only ever be done by another party.
//
// Nothing here reads the secret or the backup codes. A reset removes the
// row; it never inspects it.
// -------------------------------------------------------------------

// -------------------------------------------------------------------
// Does this account have a second factor set up?
//
// `verified` is not considered: a half-finished enrolment is still a row
// that has to be cleared before a fresh one can be made, and an admin
// looking at somebody stuck mid-enrolment needs the reset offered to them.
// -------------------------------------------------------------------
export async function hasTwoFactorRepo(userId: string, db: DBClient = database): Promise<boolean> {
  try {
    const row = await db
      .selectFrom("twoFactor")
      .select("id")
      .where("userId", "=", userId)
      .executeTakeFirst();

    return Boolean(row);
  } catch (error) {
    throw handleError("hasTwoFactorRepo", error);
  }
}

// -------------------------------------------------------------------
// Every account that currently has a second factor.
//
// Returns a Set of user ids so the admin list can mark rows without one
// query per person - the same reason team memberships are grouped rather
// than fetched per row.
// -------------------------------------------------------------------
export async function getUserIdsWithTwoFactorRepo(db: DBClient = database): Promise<Set<string>> {
  try {
    const rows = await db.selectFrom("twoFactor").select("userId").execute();

    return new Set(rows.map((row) => row.userId));
  } catch (error) {
    throw handleError("getUserIdsWithTwoFactorRepo", error);
  }
}

// -------------------------------------------------------------------
// Remove an account's second factor entirely.
//
// deleteMany rather than delete-one: the plugin's own enable path deletes
// by userId too, and an account should only ever have one row. Clearing by
// user id means a duplicate left by some earlier failure cannot survive a
// reset and lock somebody out against a secret nobody holds.
// -------------------------------------------------------------------
export async function deleteTwoFactorForUserRepo(
  userId: string,
  db: DBClient = database,
): Promise<void> {
  try {
    await db.deleteFrom("twoFactor").where("userId", "=", userId).execute();
  } catch (error) {
    throw handleError("deleteTwoFactorForUserRepo", error);
  }
}
