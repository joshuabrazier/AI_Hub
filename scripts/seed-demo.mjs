// -------------------------------------------------------------------
// Demo data seeder
//
// Populates a coherent dataset so every screen has something real in it:
// teams with managers and members, programs, locations, classes with dated
// sessions and rosters, notifications (some unread) and a signable document.
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

// Match src/lib/data/kysely-database-client.ts: DATE columns come back as
// 'YYYY-MM-DD' strings, not Date objects.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

const PREFIX = "demo_";
const EMAIL_DOMAIN = "demo.test";
const PASSWORD = process.env.DEMO_PASSWORD || `Demo-${randomBytes(9).toString("base64url")}`;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set (check --env-file or your environment).");
}

const id = (name) => PREFIX + name;

// Calendar helpers. Dates are plain strings end to end, matching the app.
const isoDate = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();

async function removeDemoData() {
  // Child rows first. Everything is matched on the demo_ prefix or the demo
  // email domain, so nothing outside the demo set can be caught.
  const demoUserIds = `(SELECT id FROM users WHERE email LIKE '%@${EMAIL_DOMAIN}')`;

  await db.query(`DELETE FROM session_attendees WHERE id LIKE '${PREFIX}%' OR user_id IN ${demoUserIds}`);
  await db.query(`DELETE FROM class_members    WHERE id LIKE '${PREFIX}%' OR user_id IN ${demoUserIds}`);
  await db.query(`DELETE FROM class_sessions   WHERE id LIKE '${PREFIX}%'`);
  await db.query(`DELETE FROM classes          WHERE id LIKE '${PREFIX}%'`);
  await db.query(`DELETE FROM programs         WHERE id LIKE '${PREFIX}%'`);
  await db.query(`DELETE FROM locations        WHERE id LIKE '${PREFIX}%'`);
  await db.query(`DELETE FROM closure_days     WHERE id LIKE '${PREFIX}%'`);
  await db.query(`DELETE FROM notifications    WHERE id LIKE '${PREFIX}%' OR user_id IN ${demoUserIds}`);
  await db.query(`DELETE FROM notification_broadcasts WHERE id LIKE '${PREFIX}%'`);
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

  // ---- delivery ---------------------------------------------------------
  await db.query(
    `INSERT INTO programs (id, name, description, is_active) VALUES
      ($1,'Induction','Everything a new starter needs in their first month.',true),
      ($2,'Analytics practice','Applied sessions for the analytics track.',true),
      ($3,'Archived pilot','Kept for reference. No longer offered.',false)`,
    [id("prog_induction"), id("prog_analytics"), id("prog_archived")],
  );

  await db.query(
    `INSERT INTO locations (id, name, address, is_active) VALUES
      ($1,'Training room 1','Level 2, 100 Example Street',true),
      ($2,'Training room 2','Level 2, 100 Example Street',true),
      ($3,'Online','Video call',true)`,
    [id("loc_room1"), id("loc_room2"), id("loc_online")],
  );

  const classes = [
    {
      key: "class_induction",
      program: "prog_induction",
      location: "loc_room1",
      team: "team_onboarding",
      lead: "manager_alex",
      name: "Induction, Monday mornings",
      schedule: [{ day: "monday", startTime: "09:00", endTime: "10:30" }],
      capacity: 12,
      start: isoDate(-28),
      end: isoDate(35),
    },
    {
      key: "class_analytics",
      program: "prog_analytics",
      location: "loc_online",
      team: "team_analytics",
      lead: "manager_jo",
      name: "Analytics practice, Wednesdays",
      schedule: [{ day: "wednesday", startTime: "14:00", endTime: "15:30" }],
      capacity: 8,
      start: isoDate(-14),
      end: isoDate(42),
    },
    {
      key: "class_open",
      program: "prog_induction",
      location: "loc_room2",
      team: null, // no team: admin-only, and invisible to every manager
      lead: null,
      name: "Open drop-in, Fridays",
      schedule: [{ day: "friday", startTime: "12:00", endTime: "13:00" }],
      capacity: 20,
      start: isoDate(-7),
      end: isoDate(56),
    },
  ];

  const DAY_INDEX = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

  for (const cls of classes) {
    cls.id = id(cls.key);
    await db.query(
      `INSERT INTO classes (id, program_id, location_id, team_id, lead_user_id, name, description,
                            schedule, capacity, start_date, end_date, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,true)`,
      [
        cls.id,
        id(cls.program),
        id(cls.location),
        cls.team ? id(cls.team) : null,
        cls.lead ? by(cls.lead) : null,
        cls.name,
        "",
        JSON.stringify(cls.schedule),
        cls.capacity,
        cls.start,
        cls.end,
      ],
    );

    // Generate the dated occurrences across the class's own range, which is
    // what replaced the old term concept.
    const slot = cls.schedule[0];
    const wanted = DAY_INDEX[slot.day];
    let sessionNumber = 0;
    for (let cursor = new Date(cls.start); cursor <= new Date(cls.end); cursor.setDate(cursor.getDate() + 1)) {
      if (cursor.getDay() !== wanted) continue;
      const date = cursor.toISOString().slice(0, 10);
      const sessionId = id(`sess_${cls.key}_${sessionNumber++}`);
      const past = date < isoDate(0);
      await db.query(
        `INSERT INTO class_sessions (id, class_id, lead_user_id, session_date, session_start, session_end, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          sessionId,
          cls.id,
          cls.lead ? by(cls.lead) : null,
          date,
          `${slot.startTime}:00`,
          `${slot.endTime}:00`,
          past ? "completed" : "scheduled",
        ],
      );
      cls.sessionIds = cls.sessionIds || [];
      cls.sessionIds.push({ id: sessionId, past });
    }
  }

  // ---- who is in which class, and their roster rows ---------------------
  const enrolments = [
    ["class_induction", ["member_priya", "member_tom", "member_sam"]],
    ["class_analytics", ["member_ines", "member_priya"]],
    ["class_open", ["member_leah"]],
  ];

  for (const [classKey, memberKeys] of enrolments) {
    const cls = classes.find((c) => c.key === classKey);
    for (const memberKey of memberKeys) {
      await db.query(`INSERT INTO class_members (id, class_id, user_id) VALUES ($1,$2,$3)`, [
        id(`cm_${classKey}_${memberKey}`),
        cls.id,
        by(memberKey),
      ]);

      for (const session of cls.sessionIds ?? []) {
        // Past sessions get a real attendance mark; upcoming ones stay booked.
        // One member cancelled a past session, so the cancelled state is visible.
        let status = session.past ? "attended" : "booked";
        if (session.past && memberKey === "member_tom" && Math.random() < 0.25) status = "absent";
        await db.query(
          `INSERT INTO session_attendees (id, class_session_id, user_id, attendance_status)
           VALUES ($1,$2,$3,$4)`,
          [id(`sa_${session.id}_${memberKey}`), session.id, by(memberKey), status],
        );
      }
    }
  }

  // A cancelled upcoming booking, so the "place freed" path has an example.
  const upcoming = classes[0].sessionIds.find((s) => !s.past);
  if (upcoming) {
    await db.query(
      `UPDATE session_attendees SET attendance_status = 'cancelled'
       WHERE class_session_id = $1 AND user_id = $2`,
      [upcoming.id, by("member_sam")],
    );
  }

  // ---- a closure day ----------------------------------------------------
  await db.query(
    `INSERT INTO closure_days (id, day_date, reason, created_by) VALUES ($1,$2,$3,$4)`,
    [id("closure_1"), isoDate(10), "Public holiday", by("manager_alex")],
  );

  // ---- notification types, a broadcast, and unread copies ---------------
  await db.query(
    `INSERT INTO notification_types (id, key, name, description, order_by, is_active) VALUES
      ($1,'general','General','Anything that does not fit another type.',1,true),
      ($2,'schedule','Schedule','Changes to sessions and times.',2,true),
      ($3,'account','Account','Account and access changes.',3,true)
     ON CONFLICT (key) DO NOTHING`,
    [id("ntype_general"), id("ntype_schedule"), id("ntype_account")],
  );

  await db.query(
    `INSERT INTO notification_broadcasts (id, created_by, type, audience_type, audience_label, title, body)
     VALUES ($1,$2,'schedule','teams','Onboarding cohort',$3,$4)`,
    [
      id("bc_1"),
      by("manager_alex"),
      "Room change for next Monday",
      "<p>Next Monday's session moves to Training room 2. Same time.</p>",
    ],
  );

  // Priya has left hers unread so the nav badge has something to show.
  const recipients = [
    ["member_priya", null],
    ["member_tom", new Date()],
    ["member_sam", null],
  ];
  let n = 0;
  for (const [memberKey, readAt] of recipients) {
    await db.query(
      `INSERT INTO notifications (id, user_id, broadcast_id, type, title, body, read_at)
       VALUES ($1,$2,$3,'schedule',$4,$5,$6)`,
      [
        id(`note_${n++}`),
        by(memberKey),
        id("bc_1"),
        "Room change for next Monday",
        "<p>Next Monday's session moves to Training room 2. Same time.</p>",
        readAt,
      ],
    );
  }

  // A second, unread, standalone notification for Priya.
  await db.query(
    `INSERT INTO notifications (id, user_id, type, title, body)
     VALUES ($1,$2,'general',$3,$4)`,
    [id("note_solo"), by("member_priya"), "Welcome to the portal", "<p>Have a look around when you get a moment.</p>"],
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
  console.log("  Classes    3 (one with no team, so it is admin-only)");
  console.log("  Sessions   generated across each class's own date range");
  console.log("  Extras     a closure day, a broadcast with unread copies, a signable document\n");
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
