// -------------------------------------------------------------------
// Promote an existing account to admin.
//
// WHY THIS REPLACED create-admin.mjs
//
// Sign-in is Microsoft only, and accounts are created by Better Auth when
// somebody signs in for the first time - with the Entra identity linked in
// the `accounts` table. A row inserted here by hand would have no such link,
// so it could never be signed into. The old script created exactly that: a
// password account, on an app with no password sign-in.
//
// So the order is now the other way round. The person signs in first, which
// creates their account as a member; this then promotes them.
//
// THE BOOTSTRAP PROBLEM THIS SOLVES. New accounts are always members, so on
// a fresh deployment nobody can reach /admin and there is no in-app way to
// make the first admin. This script is that way, and it needs direct
// database access - which is the point: it is deliberately not something the
// application can do to itself.
//
// Run:
//   $env:DATABASE_URL = "..."
//   $env:ADMIN_EMAIL  = "you@example.com"
//   node scripts/promote-admin.mjs
// -------------------------------------------------------------------
import pg from "pg";

const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

if (!email) {
  console.error("ADMIN_EMAIL is not set.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const { rows } = await client.query(
    `SELECT id, name, role, is_active, profile_completed_at FROM users WHERE lower(email) = $1`,
    [email],
  );

  const user = rows[0];

  // The most likely reason to land here, so it gets a useful answer rather
  // than "not found": they have not signed in yet, and until they do there
  // is no account to promote.
  if (!user) {
    console.error(`No account exists for ${email}.`);
    console.error("");
    console.error("Accounts are created on first Microsoft sign-in. Ask them to sign in once,");
    console.error("then run this again. If sign-in refused them, check that their domain is on");
    console.error("AUTH_ALLOWED_EMAIL_DOMAINS.");
    process.exit(1);
  }

  if (user.role === "admin") {
    console.log(`${email} is already an admin. No changes made.`);
    process.exit(0);
  }

  await client.query(`UPDATE users SET role = 'admin', updated_at = now() WHERE id = $1`, [user.id]);

  console.log(`Promoted ${user.name} <${email}> from ${user.role} to admin.`);

  if (!user.is_active) {
    console.warn("NOTE: this account is deactivated, so it still cannot sign in.");
  }

  if (!user.profile_completed_at) {
    console.warn("NOTE: they have not finished first-run setup; they will be sent to /welcome.");
  }
} finally {
  await client.end();
}
