// -------------------------------------------------------------------
// Create (or re-password) a LOCAL DEVELOPMENT account with a password.
//
// WHY THIS EXISTS. Sign-in is Microsoft only, so with no Entra app
// registration the sign-in page has no button on it and the app cannot be
// run at all. DEV_PASSWORD_SIGN_IN=true opens a password door for
// non-production MODE; this is what puts an account behind it.
//
// It is the mirror of promote-admin.mjs, which deliberately cannot create an
// account because a hand-made row has no linked Entra identity. That
// reasoning still holds for production. It does not hold locally, where
// there is no Entra at all - which is exactly the gap this fills.
//
// WHAT IT WRITES: a `users` row and a `credential` row in `accounts` holding
// the password hash, using better-auth's own hashPassword so the hash is in
// the format the sign-in endpoint expects. Re-running it for an address that
// already exists updates the password and the role rather than failing, so
// it doubles as a password reset (there is no reset flow in the app).
//
// It REFUSES to run when MODE is production. That is the same condition
// isPasswordSignInEnabled applies, so this script cannot create an account
// that only works in an environment where the door is shut.
//
// Run:
//   node --env-file=.env scripts/create-dev-user.mjs
//
// Env:
//   DEV_USER_EMAIL     required
//   DEV_USER_PASSWORD  optional - a random one is generated and printed
//   DEV_USER_ROLE      admin | manager | member   (default admin)
//   DEV_USER_NAME      optional - defaults to the local part of the address
// -------------------------------------------------------------------
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { hashPassword } from "better-auth/crypto";

const ROLES = ["admin", "manager", "member"];

const mode = (process.env.MODE ?? "development").trim().toLowerCase();
const databaseUrl = process.env.DATABASE_URL;
const email = (process.env.DEV_USER_EMAIL ?? "").trim().toLowerCase();
const role = (process.env.DEV_USER_ROLE ?? "admin").trim().toLowerCase();
const password = process.env.DEV_USER_PASSWORD || `Dev-${randomBytes(9).toString("base64url")}`;
const generated = !process.env.DEV_USER_PASSWORD;

if (mode === "production") {
  console.error("MODE is production. This script only creates local development accounts.");
  console.error("Production accounts are created by signing in with Microsoft.");
  process.exit(1);
}

if (!databaseUrl) {
  console.error("DATABASE_URL is not set (check --env-file or your environment).");
  process.exit(1);
}

if (!email || !email.includes("@")) {
  console.error("DEV_USER_EMAIL is not set to an email address.");
  process.exit(1);
}

if (!ROLES.includes(role)) {
  console.error(`DEV_USER_ROLE must be one of: ${ROLES.join(", ")}`);
  process.exit(1);
}

// The app's own bound, kept in step with PASSWORD_MIN_LENGTH rather than
// guessed: Better Auth rejects a short password at sign-in, and a hash
// written here for one it will not accept is a confusing dead end.
const minLength = Number(process.env.NEXT_PUBLIC_PASSWORD_MIN_LENGTH ?? 12);

if (password.length < minLength) {
  console.error(`DEV_USER_PASSWORD must be at least ${minLength} characters.`);
  process.exit(1);
}

// The same check the app applies at account creation. Enforced here too so
// the script cannot produce an account the app would have refused - a row
// that exists and cannot sign in is the worst of both.
const allowedDomains = (process.env.AUTH_ALLOWED_EMAIL_DOMAINS ?? "")
  .split(",")
  .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
  .filter(Boolean);

if (allowedDomains.length > 0 && !allowedDomains.includes(email.split("@")[1])) {
  console.error(`${email} is not on AUTH_ALLOWED_EMAIL_DOMAINS (${allowedDomains.join(", ")}).`);
  console.error("Add its domain there, or use an address on one that is already listed.");
  process.exit(1);
}

const newId = () => randomUUID().replace(/-/g, "");
const name = (process.env.DEV_USER_NAME ?? "").trim() || email.split("@")[0];
const passwordHash = await hashPassword(password);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const { rows } = await client.query(`SELECT id, role FROM users WHERE lower(email) = $1`, [email]);

  let userId = rows[0]?.id;
  const existed = Boolean(userId);

  if (existed) {
    // Role and password only. Leaving the name alone means re-running this to
    // reset a password does not undo anything set through the app.
    await client.query(`UPDATE users SET role = $2, is_active = TRUE, updated_at = now() WHERE id = $1`, [
      userId,
      role,
    ]);
  } else {
    userId = newId();

    // email_verified TRUE on purpose: this address was never verified by
    // anybody, but the flag is also what account linking requires before an
    // Entra identity may be linked into an existing row. Setting it means
    // this account keeps working if Entra is configured later at the same
    // address, instead of becoming an orphan that blocks its own sign-in.
    //
    // profile_completed_at stays NULL, which is the real first-run path: the
    // guards send them to /welcome to confirm their details, exactly as a
    // new Microsoft account would be.
    await client.query(
      `INSERT INTO users (id, name, email, email_verified, role, is_active)
       VALUES ($1, $2, $3, TRUE, $4, TRUE)`,
      [userId, name, email, role],
    );
  }

  // One credential row per user (accounts has a unique index on
  // user_id + provider_id), so this is an upsert rather than an insert.
  await client.query(
    `INSERT INTO accounts (id, account_id, provider_id, user_id, password)
     VALUES ($1, $2, 'credential', $3, $4)
     ON CONFLICT (user_id, provider_id)
     DO UPDATE SET password = EXCLUDED.password, updated_at = now()`,
    [newId(), userId, userId, passwordHash],
  );

  // Any existing session predates this password change; drop them so the
  // account is only reachable with the credentials just printed.
  await client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);

  console.log("");
  console.log(existed ? `Updated ${email}` : `Created ${email}`);
  console.log(`  role      ${role}`);
  console.log(`  password  ${generated ? password : "(as supplied in DEV_USER_PASSWORD)"}`);
  console.log("");
  console.log("Set DEV_PASSWORD_SIGN_IN=true in .env, restart the dev server, then sign in at /sign-in.");

  if (role !== "member") {
    console.log("");
    console.log("NOTE: staff land on /welcome first to complete their profile.");
  }
} finally {
  await client.end();
}
