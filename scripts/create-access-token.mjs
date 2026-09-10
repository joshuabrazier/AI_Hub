// -------------------------------------------------------------------
// Mint a personal access token for somebody, from the command line.
//
// WHY A SCRIPT AND NOT A SCREEN, for now. The same reason promote-admin.mjs
// is one: this is the credential you need in order to use the thing before
// there is a screen to manage it from, and a first token has to come from
// somewhere. A screen is worth building once more than one person wants one.
//
// IT PRINTS THE TOKEN ONCE. Nothing stores it - only a SHA-256 of it goes in
// the database - so a token lost here is a token to revoke and replace,
// which is the correct and only answer.
//
// WHAT THIS HANDS SOMEBODY. A token acts as its owner, with their role, and
// it SKIPS THE SECOND FACTOR because there is no session for one to sit on.
// That is the standard trade for a bearer credential and the mitigations are
// real - it expires, it can be revoked, and it only opens the one route that
// opts into its scope - but do not mint one for an admin casually.
//
// Run:
//   node scripts/create-access-token.mjs louis@example.com "my laptop"
//   node scripts/create-access-token.mjs louis@example.com "ci" --days 30
//   node scripts/create-access-token.mjs louis@example.com "forever" --no-expiry
// -------------------------------------------------------------------
import { createHash, randomBytes } from "node:crypto";

import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const [email, name, ...rest] = process.argv.slice(2);

if (!email || !name) {
  console.error('Usage: node scripts/create-access-token.mjs <email> "<name>" [--days N | --no-expiry]');
  process.exit(1);
}

const daysFlag = rest.indexOf("--days");
const days = rest.includes("--no-expiry")
  ? null
  : daysFlag >= 0
    ? Number(rest[daysFlag + 1])
    : 90;

if (days !== null && (!Number.isFinite(days) || days <= 0)) {
  console.error("--days needs a positive number.");
  process.exit(1);
}

// Kept in step with src/lib/auth/access-token.ts by hand, which is a real
// cost and the reason this file is short: a script that cannot import the
// app's TypeScript has to restate the format, so it restates as little as
// possible. If the prefix or the length ever changes, change it here too -
// a token minted in the old shape is refused by looksLikeAccessToken before
// it reaches a lookup, so the failure is at least loud.
const TOKEN_PREFIX = "aih_pat_";
const SCOPE = "delivery:write";

const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
const prefix = token.slice(0, TOKEN_PREFIX.length + 8);

const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  const { rows } = await pool.query(
    `select id, name, role, is_active from users where lower(email) = lower($1)`,
    [email],
  );

  const user = rows[0];

  if (!user) {
    console.error(`No account for ${email}. They have to sign in once before they can hold a token.`);
    process.exit(1);
  }

  if (!user.is_active) {
    console.error(`${email} is deactivated. A token for them would be refused on every call.`);
    process.exit(1);
  }

  if (user.role !== "admin") {
    // Not fatal: the scope is checked at the route and the role at the
    // service, so a member's token is simply refused later. Said here so
    // nobody spends an afternoon on it.
    console.warn(
      `Warning: ${email} is a ${user.role}. Creating a project is admin-only, so this token will be` +
        " refused by the service even though it authenticates.",
    );
  }

  const expiresAt = days === null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  await pool.query(
    `insert into personal_access_tokens (id, user_id, name, token_hash, prefix, scope, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [randomBytes(16).toString("hex"), user.id, name, tokenHash, prefix, SCOPE, expiresAt],
  );

  console.log("");
  console.log(`Token for ${user.name ?? email} (${user.role})`);
  console.log(`Scope    ${SCOPE}`);
  console.log(`Expires  ${expiresAt ? expiresAt.toISOString() : "never"}`);
  console.log("");
  console.log(token);
  console.log("");
  console.log("This is the only time it is shown. Nothing stores it.");
} finally {
  await pool.end();
}
