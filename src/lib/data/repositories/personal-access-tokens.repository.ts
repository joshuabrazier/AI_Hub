import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";
import { NewPersonalAccessToken, PersonalAccessToken } from "../kysely-database-types";

// -------------------------------------------------------------------
// Tokens that let something which is not a browser act as a person.
//
// EVERY READ EXCEPT THE VERIFICATION ONE IS SCOPED BY OWNER. A token is
// somebody's credential; a caller able to list or revoke another person's
// would be able to lock them out of their own tooling, and able to see when
// they last used it.
//
// The verification read is by HASH and is therefore unscoped by definition -
// it is the thing that establishes who the caller is. It returns the row and
// judges nothing: whether a token is revoked, expired or wrongly scoped is
// decided above, where the answer can be phrased for whoever asked.
// -------------------------------------------------------------------

export async function addPersonalAccessTokenRepo(
  row: NewPersonalAccessToken,
  db: DBClient = database,
): Promise<PersonalAccessToken> {
  try {
    return await db
      .insertInto("personalAccessTokens")
      .values(row)
      .returningAll()
      .executeTakeFirstOrThrow();
  } catch (error) {
    throw handleError("addPersonalAccessTokenRepo", error);
  }
}

// -------------------------------------------------------------------
// The verification lookup. By hash, because that is all the app has: the
// token itself was shown once and never stored.
// -------------------------------------------------------------------
export async function getPersonalAccessTokenByHashRepo(
  tokenHash: string,
  db: DBClient = database,
): Promise<PersonalAccessToken | undefined> {
  try {
    return await db
      .selectFrom("personalAccessTokens")
      .selectAll()
      .where("tokenHash", "=", tokenHash)
      .executeTakeFirst();
  } catch (error) {
    throw handleError("getPersonalAccessTokenByHashRepo", error);
  }
}

export async function getPersonalAccessTokensForUserRepo(
  userId: string,
  db: DBClient = database,
): Promise<PersonalAccessToken[]> {
  try {
    return await db
      .selectFrom("personalAccessTokens")
      .selectAll()
      .where("userId", "=", userId)
      .orderBy("createdAt", "desc")
      .execute();
  } catch (error) {
    throw handleError("getPersonalAccessTokensForUserRepo", error);
  }
}

// -------------------------------------------------------------------
// Note that a token was used.
//
// BEST EFFORT AND DELIBERATELY NOT AWAITED BY THE CALLER'S CRITICAL PATH -
// see the note where it is called. This is what answers "is this still being
// used" before somebody revokes a token they have forgotten the purpose of,
// and what shows a leaked one being used at all. Neither is worth failing a
// request over.
// -------------------------------------------------------------------
export async function touchPersonalAccessTokenRepo(
  tokenId: string,
  usedAt: Date,
  db: DBClient = database,
): Promise<void> {
  try {
    await db
      .updateTable("personalAccessTokens")
      .set({ lastUsedAt: usedAt })
      .where("id", "=", tokenId)
      .execute();
  } catch (error) {
    throw handleError("touchPersonalAccessTokenRepo", error);
  }
}

// -------------------------------------------------------------------
// Revoke one. Scoped by owner as well as by id: the id comes from a page the
// caller was shown, and one predicate here removes a whole class of mistake
// in whatever calls it later.
//
// Already-revoked stays as it was. Re-revoking would move the timestamp and
// lose the date somebody actually turned it off.
// -------------------------------------------------------------------
export async function revokePersonalAccessTokenRepo(
  tokenId: string,
  userId: string,
  revokedAt: Date,
  db: DBClient = database,
): Promise<PersonalAccessToken | undefined> {
  try {
    return await db
      .updateTable("personalAccessTokens")
      .set({ revokedAt })
      .where("id", "=", tokenId)
      .where("userId", "=", userId)
      .where("revokedAt", "is", null)
      .returningAll()
      .executeTakeFirst();
  } catch (error) {
    throw handleError("revokePersonalAccessTokenRepo", error);
  }
}
