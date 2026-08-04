// -------------------------------------------------------------------
// Demo data seeder
//
// Populates a coherent dataset so every screen has something real in it:
// teams with managers and members, a pending invitation, notification types, a
// broadcast with unread copies, and a signable document.
//
// Everything it creates is namespaced - ids are prefixed `demo_` and emails use
// the @demo.test domain - so re-running it removes its own previous rows first
// and never touches anything else in the database.
//
// Run:  node --env-file=.env scripts/seed-demo.mjs
//
// Optional env:
//   DEMO_PASSWORD   password for every demo login (a random one is generated
//                   and printed if unset)
//   DEMO_CLEAN      "true" to remove the demo data and exit without reseeding
// -------------------------------------------------------------------
import { randomBytes } from "node:crypto";
import pg from "pg";
import { hashPassword } from "better-auth/crypto";

const PREFIX = "demo_";
const EMAIL_DOMAIN = "demo.test";
const PASSWORD = process.env.DEMO_PASSWORD || `Demo-${randomBytes(9).toString("base64url")}`;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set (check --env-file or your environment).");
}

const id = (name) => PREFIX + name;

// A timestamp `days` either side of now, for the invitation expiry.
const daysFromNow = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();

async function removeDemoData() {
  // Child rows first. Everything is matched on the demo_ prefix or the demo
  // email domain, so nothing outside the demo set can be caught.
  const demoUserIds = `(SELECT id FROM users WHERE email LIKE '%@${EMAIL_DOMAIN}')`;

  await db.query(`DELETE FROM notifications    WHERE id LIKE '${PREFIX}%' OR user_id IN ${demoUserIds}`);
  await db.query(`DELETE FROM notification_broadcasts WHERE id LIKE '${PREFIX}%'`);
  await db.query(`DELETE FROM notification_templates  WHERE id LIKE '${PREFIX}%'`);
  await db.query(`DELETE FROM notification_types      WHERE id LIKE '${PREFIX}%'`);
  await db.query(`DELETE FROM document_signatures     WHERE id LIKE '${PREFIX}%' OR user_id IN ${demoUserIds}`);
  await db.query(`DELETE FROM documents        WHERE id LIKE '${PREFIX}%'`);
  await db.query(`DELETE FROM team_members     WHERE id LIKE '${PREFIX}%' OR user_id IN ${demoUserIds}`);
  await db.query(`DELETE FROM teams            WHERE id LIKE '${PREFIX}%'`);
  await db.query(`DELETE FROM user_invitations WHERE id LIKE '${PREFIX}%' OR email LIKE '%@${EMAIL_DOMAIN}'`);
  await db.query(`DELETE FROM audit_logs       WHERE actor_user_id IN ${demoUserIds} OR subject_user_id IN ${demoUserIds}`);
  await db.query(`DELETE FROM sessions         WHERE user_id IN ${demoUserIds}`);
  await db.query(`DELETE FROM two_factor       WHERE user_id IN ${demoUserIds}`);
  await db.query(`DELETE FROM accounts         WHERE user_id IN ${demoUserIds}`);
  await db.query(`DELETE FROM users            WHERE email LIKE '%@${EMAIL_DOMAIN}'`);
}

try {
  await db.query("BEGIN");
  await removeDemoData();

  if (process.env.DEMO_CLEAN === "true") {
    await db.query("COMMIT");
    console.log("\nDemo data removed. Nothing reseeded (DEMO_CLEAN=true).\n");
    process.exit(0);
  }

  const passwordHash = await hashPassword(PASSWORD);

  // ---- people -----------------------------------------------------------
  // Staff have two_factor_enabled = false so they can sign in and enrol
  // through the real flow. Setting the flag without an enrolled secret would
  // lock the account out: sign-in would return a challenge nothing can answer.
  const people = [
    { key: "manager_alex", name: "Alex Rahman", role: "manager" },
    { key: "manager_jo", name: "Jo Okafor", role: "manager" },
    { key: "member_priya", name: "Priya Sharma", role: "member" },
    { key: "member_tom", name: "Tom Whitfield", role: "member" },
    { key: "member_ines", name: "Ines Moreau", role: "member" },
    { key: "member_sam", name: "Sam Doyle", role: "member" },
    { key: "member_leah", name: "Leah Nguyen", role: "member" },
  ];

  for (const person of people) {
    person.id = id(person.key);
    person.email = `${person.key.replace(/_/g, ".")}@${EMAIL_DOMAIN}`;
    await db.query(
      `INSERT INTO users (id, name, email, email_verified, role, is_active, phone_number)
       VALUES ($1,$2,$3,true,$4,true,$5)`,
      [person.id, person.name, person.email, person.role, "0400 000 000"],
    );
    await db.query(
      `INSERT INTO accounts (id, account_id, provider_id, user_id, password)
       VALUES ($1,$2,'credential',$3,$4)`,
      [id(`acct_${person.key}`), person.id, person.id, passwordHash],
    );
  }

  const by = (key) => people.find((p) => p.key === key).id;

  // ---- teams ------------------------------------------------------------
  const teams = [
    { key: "team_onboarding", name: "Onboarding cohort", description: "New starters working through induction." },
    { key: "team_analytics", name: "Advanced analytics", description: "Practitioners on the analytics track." },
    { key: "team_pilot", name: "Pilot group", description: "Trialling the next iteration. No manager yet." },
  ];

  for (const team of teams) {
    team.id = id(team.key);
    await db.query(`INSERT INTO teams (id, name, description, is_active) VALUES ($1,$2,$3,true)`, [
      team.id,
      team.name,
      team.description,
    ]);
  }

  // Alex manages Onboarding, Jo manages Analytics. Nobody manages Pilot, so the
  // "a team with no manager" case is visible on the admin screen.
  const memberships = [
    ["team_onboarding", "manager_alex", "manager"],
    ["team_onboarding", "member_priya", "member"],
    ["team_onboarding", "member_tom", "member"],
    ["team_onboarding", "member_sam", "member"],
    ["team_analytics", "manager_jo", "manager"],
    ["team_analytics", "member_ines", "member"],
    // Priya is in two teams: the many-to-many case the model exists for.
    ["team_analytics", "member_priya", "member"],
    ["team_pilot", "member_leah", "member"],
  ];

  for (const [teamKey, personKey, teamRole] of memberships) {
    await db.query(
      `INSERT INTO team_members (id, team_id, user_id, team_role) VALUES ($1,$2,$3,$4)`,
      [id(`tm_${teamKey}_${personKey}`), id(teamKey), by(personKey), teamRole],
    );
  }

  // ---- a pending invitation ---------------------------------------------
  // Placed on a team, which is what the accept flow reads to put the new
  // account into it - never the request.
  await db.query(
    `INSERT INTO user_invitations (id, name, email, role, status, expires_at, inviter_id, team_id, team_role)
     VALUES ($1,$2,$3,'member','pending',$4,$5,$6,'member')`,
    [
      id("invite_pending"),
      "Nadia Haddad",
      `invitee.nadia@${EMAIL_DOMAIN}`,
      daysFromNow(14),
      by("manager_alex"),
      id("team_onboarding"),
    ],
  );

  // ---- notification types, a broadcast, and unread copies ---------------
  await db.query(
    `INSERT INTO notification_types (id, key, name, description, order_by, is_active) VALUES
      ($1,'general','General','Anything that does not fit another type.',1,true),
      ($2,'account','Account','Account and access changes.',2,true)
     ON CONFLICT (key) DO NOTHING`,
    [id("ntype_general"), id("ntype_account")],
  );

  const broadcastTitle = "Welcome to the portal";
  const broadcastBody = "<p>Have a look around when you get a moment, and let us know if anything is missing.</p>";

  await db.query(
    `INSERT INTO notification_broadcasts (id, created_by, type, audience_type, audience_label, title, body)
     VALUES ($1,$2,'general','teams','Onboarding cohort',$3,$4)`,
    [id("bc_1"), by("manager_alex"), broadcastTitle, broadcastBody],
  );

  // Priya and Sam have left theirs unread so the nav badge has something to show.
  const recipients = [
    ["member_priya", null],
    ["member_tom", new Date()],
    ["member_sam", null],
  ];
  let n = 0;
  for (const [memberKey, readAt] of recipients) {
    await db.query(
      `INSERT INTO notifications (id, user_id, broadcast_id, type, title, body, read_at)
       VALUES ($1,$2,$3,'general',$4,$5,$6)`,
      [id(`note_${n++}`), by(memberKey), id("bc_1"), broadcastTitle, broadcastBody, readAt],
    );
  }

  // A second, unread, standalone notification for Priya.
  await db.query(
    `INSERT INTO notifications (id, user_id, type, title, body)
     VALUES ($1,$2,'account',$3,$4)`,
    [
      id("note_solo"),
      by("member_priya"),
      "Two-factor is available",
      "<p>You can turn on two-factor authentication from Settings whenever you like.</p>",
    ],
  );

  // ---- a signable document ---------------------------------------------
  await db.query(
    `INSERT INTO documents (id, key, title, version, content_key, is_required, order_by, is_active)
     VALUES ($1,'terms','Terms and Conditions','1.0','terms_and_conditions',true,1,true)
     ON CONFLICT (key) DO NOTHING`,
    [id("doc_terms")],
  );

  await db.query("COMMIT");

  console.log("\nDemo data seeded.\n");
  console.log("  Teams      3 (one with no manager)");
  console.log("  People     7 demo logins, plus your existing admin");
  console.log("  Extras     a pending invitation, a broadcast with unread copies, a signable document\n");
  console.log("  Every demo login uses the password:  " + PASSWORD + "\n");
  console.log("  manager.alex@demo.test    manager of Onboarding cohort");
  console.log("  manager.jo@demo.test      manager of Advanced analytics");
  console.log("  member.priya@demo.test    member of TWO teams, has unread notifications");
  console.log("  member.tom@demo.test      member of Onboarding cohort");
  console.log("  member.leah@demo.test     member of the team nobody manages\n");
  console.log("  Remove it again with:  DEMO_CLEAN=true node --env-file=.env scripts/seed-demo.mjs\n");
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  db.release();
  await pool.end();
}
