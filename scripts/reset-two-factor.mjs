// -------------------------------------------------------------------
// Clear two-factor enrolment so somebody sets it up again from scratch.
//
// WHY THIS EXISTS. Somebody loses their phone, or gets stuck part-way
// through enrolment, and there is no in-app way to reset it - deliberately,
// because a screen that clears your own second factor is a screen an
// attacker with a session would use. So it lives here, behind direct
// database access.
//
// THREE PIECES OF STATE, and missing any one of them leaves a worse mess
// than doing nothing:
//
//   two_factor          the secret and backup codes. While this exists and
//                       is verified, enrolment refuses outright and never
//                       shows a QR.
//   session_two_factor  the per-session "has passed" record. Left behind,
//                       an existing session sails through the gate and the
//                       person never reaches the enrolment screen.
//   users.two_factor_enabled
//                       what the gate reads as "enrolled". Left true with
//                       no secret, the gate believes they are enrolled and
//                       there is nothing to verify against - which locks
//                       them out rather than resetting them.
//
// All three go together, in one transaction.
//
// Run:
//   $env:DATABASE_URL = "..."
//   node scripts/reset-two-factor.mjs somebody@example.com
//   node scripts/reset-two-factor.mjs --all
// -------------------------------------------------------------------
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
const target = (process.argv[2] ?? "").trim();

if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

if (!target) {
  console.error("Pass an email address, or --all to reset every account.");
  console.error("");
  console.error("  node scripts/reset-two-factor.mjs somebody@example.com");
  console.error("  node scripts/reset-two-factor.mjs --all");
  process.exit(1);
}

// --all has to be typed in full. Resetting everybody is a legitimate thing
// to do after a botched rollout, and a bad thing to do by accident when the
// email argument was forgotten - which is why a missing argument refuses
// above rather than defaulting to everyone.
const everyone = target === "--all";
const email = everyone ? null : target.toLowerCase();

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  if (!everyone) {
    const { rows } = await client.query("SELECT id, name FROM users WHERE lower(email) = $1", [email]);

    if (rows.length === 0) {
      console.error(`No account exists for ${email}.`);
      process.exit(1);
    }

    console.log(`Resetting two-factor for ${rows[0].name ?? email}.`);
  } else {
    console.log("Resetting two-factor for EVERY account.");
  }

  const scope = everyone ? "" : " WHERE user_id = (SELECT id FROM users WHERE lower(email) = $1)";
  const params = everyone ? [] : [email];

  await client.query("BEGIN");

  const secrets = await client.query(`DELETE FROM two_factor${scope}`, params);

  const sessions = await client.query(
    everyone
      ? "DELETE FROM session_two_factor"
      : "DELETE FROM session_two_factor WHERE session_id IN (SELECT id FROM sessions WHERE user_id = (SELECT id FROM users WHERE lower(email) = $1))",
    params,
  );

  // updated_at is set explicitly - nothing in this schema has a trigger for
  // it, so a hand-written update that omits it leaves the row claiming it
  // was last changed whenever it was created.
  const flags = await client.query(
    everyone
      ? "UPDATE users SET two_factor_enabled = false, updated_at = now() WHERE two_factor_enabled"
      : "UPDATE users SET two_factor_enabled = false, updated_at = now() WHERE lower(email) = $1",
    params,
  );

  await client.query("COMMIT");

  console.log(
    `Removed ${secrets.rowCount} enrolment(s), ${sessions.rowCount} session record(s), cleared the flag on ${flags.rowCount} account(s).`,
  );
  console.log("");
  console.log("They will be sent to set it up again on their next request.");
  console.log("APP_TWO_FACTOR_ENABLED must be true in this environment, or nothing will prompt them.");
} catch (error) {
  await client.query("ROLLBACK");
  console.error("ROLLED BACK, nothing changed:", error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
