import "server-only";

import { database, DBClient } from "@/lib/data/kysely-database-client";
import { handleError } from "@/lib/handle-errors";

// -------------------------------------------------------------------
// The `accounts` table is Better Auth's, and this is the first thing in the
// app to read it directly. Everything else about accounts goes through the
// auth API, which is the right default: the columns are the library's to
// change, and reading them here is a small coupling to keep an eye on.
//
// The one question worth asking directly is below, and the auth API has no
// endpoint for it.
// -------------------------------------------------------------------

// The provider id Better Auth writes for an email-and-password account. Not
// spelled inline anywhere else, because a typo would silently answer "no
// password" and skip a check rather than fail.
const CREDENTIAL_PROVIDER_ID = "credential";

// -------------------------------------------------------------------
// Does this user sign in with a password?
//
// Asked so the two-factor screen knows whether enrolment will need one.
// Better Auth's twoFactor plugin makes exactly this distinction internally -
// `allowPasswordless` skips the password check only for accounts that have
// NONE - so this mirrors the plugin's own rule rather than inventing one.
//
// An Entra account has no credential row and answers false, which is the
// production case and the reason nothing changes there.
// -------------------------------------------------------------------
export async function hasCredentialAccountRepo(userId: string, db: DBClient = database): Promise<boolean> {
  try {
    const row = await db
      .selectFrom("accounts")
      .select("id")
      .where("userId", "=", userId)
      .where("providerId", "=", CREDENTIAL_PROVIDER_ID)
      .executeTakeFirst();

    return Boolean(row);
  } catch (error) {
    throw handleError("hasCredentialAccountRepo", error);
  }
}
