import { Client } from "pg";
import { readEnvVar } from "./env";

const RESET_PREFIX = "reset-password:";

// -------------------------------------------------------------------
// Run a query against the app database (Playwright has no DB access of
// its own, so we connect directly using DATABASE_URL from .env).
//
// Writes belong in the Seeder (helpers/seed.ts), which records what it creates
// so it can remove exactly that. What lives here is the read side: the
// assertions a spec makes about stored state, plus the auth tokens that are
// only ever emailed and so cannot be read back through the UI.
// -------------------------------------------------------------------
export async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: readEnvVar("DATABASE_URL") });
  await client.connect();

  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

// -------------------------------------------------------------------
// Fetch the latest Better Auth password-reset token for a user.
// Better Auth stores it in `verifications` as:
//   identifier = "reset-password:<token>", value = <userId>
// -------------------------------------------------------------------
export async function getLatestResetToken(email: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query(
      `SELECT v.identifier
         FROM verifications v
         JOIN users u ON u.id = v.value
        WHERE u.email = $1
          AND v.identifier LIKE $2
        ORDER BY v.created_at DESC
        LIMIT 1`,
      [email, `${RESET_PREFIX}%`],
    );

    const identifier: string | undefined = result.rows[0]?.identifier;

    return identifier ? identifier.slice(RESET_PREFIX.length) : null;
  });
}

// -------------------------------------------------------------------
// Fetch the most recent emailed two-factor OTP. Better Auth stores it in
// `verifications` as identifier = "2fa-otp-<key>", value = "<code>:<attempts>"
// (the code is stored in plain form by default). Only the email-OTP test ever
// creates one of these, so the latest row is that test's code.
// -------------------------------------------------------------------
export async function getLatestTwoFactorOtp(): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query(
      `SELECT value
         FROM verifications
        WHERE identifier LIKE '2fa-otp-%'
        ORDER BY created_at DESC
        LIMIT 1`,
    );

    const value: string | undefined = result.rows[0]?.value;

    return value ? value.split(":")[0] : null;
  });
}

// -------------------------------------------------------------------
// Look up a user's id by email. Returns null when no user exists.
// -------------------------------------------------------------------
export async function getUserIdByEmail(email: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query("SELECT id FROM users WHERE email = $1", [email]);

    return result.rows[0]?.id ?? null;
  });
}

// -------------------------------------------------------------------
// The stored role for a user. Roles are server-assigned, so a spec that cares
// whether a flow granted the right one has to read it here rather than infer
// it from the interface.
// -------------------------------------------------------------------
export async function getUserRoleByEmail(email: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query("SELECT role FROM users WHERE email = $1", [email]);

    return result.rows[0]?.role ?? null;
  });
}

// -------------------------------------------------------------------
// The profile fields the portal account form writes.
// -------------------------------------------------------------------
export async function getUserProfileById(
  userId: string,
): Promise<{ name: string; preferredName: string | null; phoneNumber: string | null } | null> {
  return withClient(async (client) => {
    const result = await client.query(
      "SELECT name, preferred_name, phone_number FROM users WHERE id = $1",
      [userId],
    );
    const row = result.rows[0];

    return row
      ? { name: row.name, preferredName: row.preferred_name, phoneNumber: row.phone_number }
      : null;
  });
}

// -------------------------------------------------------------------
// A user's team role within one team, or null when they are not in it. The
// answer to "did accepting the invitation actually place them in the team".
// -------------------------------------------------------------------
export async function getTeamRoleForUser(teamId: string, userId: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query(
      "SELECT team_role FROM team_members WHERE team_id = $1 AND user_id = $2",
      [teamId, userId],
    );

    return result.rows[0]?.team_role ?? null;
  });
}

// -------------------------------------------------------------------
// A member's stored status for one session. Cancelling a place is an UPDATE to
// this column, never a delete, so the row is still here afterwards.
// -------------------------------------------------------------------
export async function getAttendanceStatus(attendeeId: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query(
      "SELECT attendance_status FROM session_attendees WHERE id = $1",
      [attendeeId],
    );

    return result.rows[0]?.attendance_status ?? null;
  });
}

// -------------------------------------------------------------------
// When a notification was read, or null while it is still unread. read_at
// being NULL is the whole definition of unread.
// -------------------------------------------------------------------
export async function getNotificationReadAt(notificationId: string): Promise<Date | null> {
  return withClient(async (client) => {
    const result = await client.query("SELECT read_at FROM notifications WHERE id = $1", [
      notificationId,
    ]);

    return result.rows[0]?.read_at ?? null;
  });
}

// -------------------------------------------------------------------
// Fetch an invitation's status by token (id). Returns null when the
// invitation does not exist.
// -------------------------------------------------------------------
export async function getUserInvitationStatusById(id: string): Promise<string | null> {
  return withClient(async (client) => {
    const result = await client.query("SELECT status FROM user_invitations WHERE id = $1", [id]);

    return result.rows[0]?.status ?? null;
  });
}

// -------------------------------------------------------------------
// Remove the trail an account leaves behind that a delete BY USER ID cannot
// reach. Two shapes hide from one:
//
//   - A failed sign-in is audited with no actor. There is no session to
//     resolve at that point, so actor_user_id and subject_user_id are both
//     NULL and the attempted address is the only thing identifying the row.
//     That address is matched here whether or not an account still holds it,
//     because the change-email flow deliberately fails a sign-in for an
//     address that has just been given up.
//
//   - Better Auth's two-factor challenge writes rows off ONE identifier: the
//     challenge itself (value = the user id), plus "2fa-attempts-<identifier>"
//     and, when a code is emailed, "2fa-otp-<identifier>". Only the challenge
//     is keyed by the user, so deleting by value leaves the other two behind.
//     They are derived from the challenge row instead.
//
// The final statement is the one place this file deletes by pattern rather
// than by recorded id, and it is deliberate. Completing a challenge CONSUMES
// the challenge row, which orphans its attempts/otp rows and takes the only
// link to the user with them. An orphan is already unusable - the verify step
// refuses outright when the challenge row is gone - so this removes rows that
// are dead whoever created them.
//
// Runs BEFORE the user row goes, because actor_user_id is ON DELETE SET NULL:
// afterwards there would be nothing left to match on.
// -------------------------------------------------------------------
export async function deleteAuthTrail(
  client: Client,
  userIds: string[],
  emails: string[],
): Promise<void> {
  await client.query(
    `DELETE FROM audit_logs
      WHERE actor_user_id = ANY($1::text[])
         OR subject_user_id = ANY($1::text[])
         OR metadata->>'email' = ANY($2::text[])`,
    [userIds, emails],
  );

  await client.query(
    `DELETE FROM verifications
      WHERE identifier IN (
            SELECT prefixes.prefix || challenge.identifier
              FROM verifications challenge
              CROSS JOIN (VALUES ('2fa-attempts-'), ('2fa-otp-')) AS prefixes(prefix)
             WHERE challenge.value = ANY($1::text[])
          )`,
    [userIds],
  );
  await client.query("DELETE FROM verifications WHERE value = ANY($1::text[])", [userIds]);
  await client.query(
    `DELETE FROM verifications
      WHERE identifier ~ '^2fa-(attempts|otp)-'
        AND NOT EXISTS (
            SELECT 1
              FROM verifications challenge
             WHERE challenge.identifier = regexp_replace(verifications.identifier, '^2fa-(attempts|otp)-', '')
          )`,
  );
}

// -------------------------------------------------------------------
// One audit row this suite produces cannot be matched by id or by address.
// Signing out with a session that has ALREADY been revoked - which is what the
// change-email flow ends with - leaves the hook that audits it nothing to
// resolve, so the row it writes carries no actor, no subject and no address:
// "A user signed out", and that is all it says.
//
// WHEN it happened is the only thing left to identify it by, so the caller
// passes the window around the request it made and awaited. Both ends are the
// test's own instants, and the row is written before the sign-out response is
// returned, so the window is the request rather than a period of time in which
// somebody else might also have signed out.
// -------------------------------------------------------------------
export async function deleteAnonymousSignOutsBetween(from: Date, to: Date): Promise<void> {
  return withClient(async (client) => {
    await client.query(
      `DELETE FROM audit_logs
        WHERE action = 'auth.signed_out'
          AND actor_user_id IS NULL
          AND subject_user_id IS NULL
          AND created_at BETWEEN $1 AND $2`,
      [from, to],
    );
  });
}

// -------------------------------------------------------------------
// Remove a user and all of its related rows. Used by the specs that seed an
// account straight through the sign-up endpoint rather than through the
// Seeder, so there is a single id to clean up and nothing else.
// -------------------------------------------------------------------
export async function deleteUserByEmail(email: string): Promise<void> {
  return withClient(async (client) => {
    const result = await client.query("SELECT id FROM users WHERE email = $1", [email]);
    const userId: string | undefined = result.rows[0]?.id;

    // Cleared by address as well as by id, so a run still collects the
    // failed-sign-in trail for an address whose account has already gone (or
    // never existed, which is what a rejected sign-in usually means).
    await deleteAuthTrail(client, userId ? [userId] : [], [email]);

    if (!userId) {
      return;
    }

    // Delete children first (accounts/sessions reference users via FK)
    await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM accounts WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM two_factor WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM users WHERE id = $1", [userId]);
  });
}
