// -------------------------------------------------------------------
// Create the first admin account (bootstrap)
//
// Onboarding is invite-based, but the very first admin has nobody to invite
// them — this script creates that starting account directly. Unlike the demo
// seeder, it is meant to run against a real (incl. production) database, so
// nothing is hardcoded: the email/name/password come from the operator, and a
// strong password is generated (and printed once) when you don't supply one.
//
// It is idempotent: if a user with that email already exists it makes NO
// changes (so it can never silently reset an existing admin's password).
//
// After it runs: sign in with the printed credentials, complete the mandatory
// staff 2FA setup, then change your password in Settings.
//
// Run:  ADMIN_EMAIL=you@school.com [ADMIN_NAME="Your Name"] [ADMIN_PASSWORD=...] \
//         node --env-file=.env scripts/create-admin.mjs
// -------------------------------------------------------------------

import { randomBytes } from "node:crypto";
import pg from "pg";
import { hashPassword } from "better-auth/crypto";

const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
if (!email || !email.includes("@")) {
  throw new Error("Set ADMIN_EMAIL to the admin's email address, e.g. ADMIN_EMAIL=you@school.com");
}

const name = (process.env.ADMIN_NAME ?? "Administrator").trim();

// Use the supplied password, or generate a strong random one to print once.
const suppliedPassword = process.env.ADMIN_PASSWORD;
const password = suppliedPassword || randomBytes(12).toString("base64url");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set (check --env-file or your environment).");
}

// A unique 32-char TEXT id, matching the app's id length.
const newId = () => randomBytes(16).toString("hex");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");

  const existing = await client.query(`SELECT id, role FROM users WHERE lower(email) = $1`, [email]);
  if (existing.rows.length > 0) {
    await client.query("ROLLBACK");
    console.log(`A user with ${email} already exists (role: ${existing.rows[0].role}). No changes made.`);
    process.exit(0);
  }

  const userId = newId();
  await client.query(
    `INSERT INTO users (id, name, email, email_verified, role, is_active)
     VALUES ($1, $2, $3, true, 'admin', true)`,
    [userId, name, email],
  );

  // Better Auth stores the email/password login in `accounts` under the
  // 'credential' provider, with account_id == user_id and a hashed password.
  const passwordHash = await hashPassword(password);
  await client.query(
    `INSERT INTO accounts (id, account_id, provider_id, user_id, password)
     VALUES ($1, $2, 'credential', $3, $4)`,
    [newId(), userId, userId, passwordHash],
  );

  await client.query("COMMIT");

  console.log("\nAdmin account created.\n");
  console.log(`  Email:    ${email}`);
  console.log(`  Name:     ${name}`);
  if (suppliedPassword) {
    console.log("  Password: (the ADMIN_PASSWORD you provided)");
  } else {
    console.log(`  Password: ${password}`);
    console.log("            ^ randomly generated — save it now; it is not stored anywhere else.");
  }
  console.log("\nNext: sign in, complete the mandatory 2FA setup, then change your password in Settings.\n");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
