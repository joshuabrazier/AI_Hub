// -------------------------------------------------------------------
// Apply pending migrations to a database, safely.
//
// The companion to check-migrations.mjs. That one reports; this one can
// also apply. They are separate on purpose - a script that only reads is
// one you can point at production without thinking, and that property is
// worth keeping for the common case.
//
// IT REPORTS BY DEFAULT AND APPLIES ONLY WHEN TOLD. Running it with no
// flags changes nothing. That is the right default for a script whose
// whole reason for existing is being pointed at production.
//
// WHAT MAKES IT SAFE TO RUN WHEN YOU DO NOT KNOW WHAT IS IN THERE:
//
//   1. It skips anything already recorded in schema_migrations.
//   2. For everything NOT recorded, it PROBES the database first and tells
//      you whether the tables, types and columns that migration creates are
//      already present. That is the case the recorded list cannot tell you
//      about, and it is the one that bites: a database built straight from
//      database-schema.sql has the objects but none of the rows saying so.
//   3. Each migration runs inside its own transaction (the files carry
//      their own BEGIN/COMMIT), so a failure leaves nothing half-applied.
//   4. It STOPS at the first failure rather than carrying on. A later
//      migration usually assumes an earlier one worked.
//   5. The one destructive migration is refused unless named explicitly.
//
// Run:
//   $env:DATABASE_URL = "..."
//   node scripts/apply-migrations.mjs                    report only
//   node scripts/apply-migrations.mjs --apply            apply what is safe
//   node scripts/apply-migrations.mjs --apply --include-destructive
//   node scripts/apply-migrations.mjs --mark-applied=007_staff_rate.sql
//
// --mark-applied is the escape hatch for point 2: when the objects already
// exist but the row does not, record it as done without running it. It is
// deliberately one file at a time and deliberately explicit, because
// guessing that automatically is how a half-applied migration gets buried.
// -------------------------------------------------------------------
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import pg from "pg";

// -------------------------------------------------------------------
// Migrations that destroy data. Never applied unless named.
//
// This one drops the timesheet summary and report tables. That is correct
// for any environment running current code - the features were removed -
// but "correct" and "reversible" are different things, and the rows in
// those tables cannot be reconstructed.
// -------------------------------------------------------------------
const DESTRUCTIVE = new Set(["010_drop_timesheet_summary_and_report.sql"]);

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  console.error('  $env:DATABASE_URL = "postgres://..."');
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const includeDestructive = args.includes("--include-destructive");
const markApplied = args.find((a) => a.startsWith("--mark-applied="))?.split("=")[1];

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "lib",
  "data",
  "sql",
  "migrations",
);

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

// -------------------------------------------------------------------
// What a migration creates, read out of the SQL itself.
//
// Only used to PROBE, never to decide - the answer is shown to a human who
// then chooses. A regex over SQL is not a parser and does not need to be:
// missing an object makes the report less complete, not wrong.
// -------------------------------------------------------------------
function objectsCreatedBy(sql) {
  const tables = [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)].map(
    (m) => m[1],
  );
  const types = [...sql.matchAll(/CREATE\s+TYPE\s+([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]);
  const columns = [
    ...sql.matchAll(/ALTER\s+TABLE\s+([a-z_][a-z0-9_]*)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi),
  ].map((m) => ({ table: m[1], column: m[2] }));

  return { tables, types, columns };
}

async function probe(client, sql) {
  const { tables, types, columns } = objectsCreatedBy(sql);
  const present = [];
  const absent = [];

  for (const table of tables) {
    const { rows } = await client.query("SELECT to_regclass($1) IS NOT NULL AS ok", [table]);
    (rows[0].ok ? present : absent).push(`table ${table}`);
  }

  for (const type of types) {
    const { rows } = await client.query("SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = $1) AS ok", [type]);
    (rows[0].ok ? present : absent).push(`type ${type}`);
  }

  for (const { table, column } of columns) {
    const { rows } = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = $1 AND column_name = $2
       ) AS ok`,
      [table, column],
    );
    (rows[0].ok ? present : absent).push(`column ${table}.${column}`);
  }

  return { present, absent };
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  // -----------------------------------------------------------------
  // No schema_migrations means the base schema was never applied. That is
  // a different and much larger problem than a few pending migrations, and
  // running 001 against an empty database would fail on the first foreign
  // key anyway. Say so rather than start.
  // -----------------------------------------------------------------
  const { rows: hasTable } = await client.query("SELECT to_regclass('schema_migrations') IS NOT NULL AS ok");

  if (!hasTable[0].ok) {
    console.error("There is no schema_migrations table in this database.");
    console.error("That means the base schema has never been applied. Apply");
    console.error("src/lib/data/sql/database-schema.sql first, then re-run this.");
    process.exit(1);
  }

  const { rows: appliedRows } = await client.query("SELECT filename FROM schema_migrations");
  const applied = new Set(appliedRows.map((r) => r.filename));

  // ---- the escape hatch, handled before anything else
  if (markApplied) {
    if (!files.includes(markApplied)) {
      console.error(`No such migration: ${markApplied}`);
      process.exit(1);
    }
    if (applied.has(markApplied)) {
      console.log(`${markApplied} is already recorded as applied. Nothing to do.`);
      process.exit(0);
    }

    await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [markApplied]);
    console.log(`Recorded ${markApplied} as applied WITHOUT running it.`);
    console.log("Only correct if its objects were already in the database.");
    process.exit(0);
  }

  const pending = files.filter((f) => !applied.has(f));

  console.log(`\n${applied.size} migration(s) recorded, ${pending.length} pending.\n`);

  if (pending.length === 0) {
    console.log("Nothing to do - this database is up to date.\n");
    process.exit(0);
  }

  // ---- report, always, before doing anything
  const plan = [];

  for (const file of pending) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    const { present, absent } = await probe(client, sql);
    const destructive = DESTRUCTIVE.has(file);

    // Objects already there but no row saying so. Applying would fail on
    // "already exists"; --mark-applied is the answer, not a retry.
    const conflict = present.length > 0 && absent.length === 0;

    plan.push({ file, sql, present, absent, destructive, conflict });

    const flag = destructive ? "  [DESTRUCTIVE]" : conflict ? "  [ALREADY PRESENT]" : "";
    console.log(`  ${file}${flag}`);
    if (present.length) console.log(`      already there: ${present.join(", ")}`);
    if (absent.length) console.log(`      will create:   ${absent.join(", ")}`);
  }

  console.log("");

  if (!apply) {
    console.log("Report only - nothing was changed. Re-run with --apply to apply.\n");
    const destructivePending = plan.filter((p) => p.destructive);
    if (destructivePending.length) {
      console.log("Destructive migrations are skipped even with --apply unless you also");
      console.log("pass --include-destructive:");
      for (const p of destructivePending) console.log(`  ${p.file}`);
      console.log("");
    }
    const conflicts = plan.filter((p) => p.conflict);
    if (conflicts.length) {
      console.log("These already exist in the database but are not recorded as applied.");
      console.log("Running them would fail. If they really are already applied, record them:");
      for (const p of conflicts) console.log(`  node scripts/apply-migrations.mjs --mark-applied=${p.file}`);
      console.log("");
    }
    process.exit(0);
  }

  // ---- apply
  let count = 0;

  for (const item of plan) {
    if (item.destructive && !includeDestructive) {
      console.log(`SKIPPED  ${item.file}  (destructive, needs --include-destructive)`);
      continue;
    }

    if (item.conflict) {
      console.log(`SKIPPED  ${item.file}  (its objects already exist - use --mark-applied)`);
      continue;
    }

    process.stdout.write(`APPLY    ${item.file} ... `);

    try {
      // The file carries its own BEGIN/COMMIT and its own INSERT into
      // schema_migrations, so this is one atomic unit and there is no
      // bookkeeping to get wrong here.
      await client.query(item.sql);
      console.log("ok");
      count += 1;
    } catch (error) {
      console.log("FAILED");
      console.error(`\n  ${error.message}\n`);
      console.error("Stopped. Nothing from this migration was applied, and later");
      console.error("migrations were not attempted - they usually assume this one worked.");
      process.exit(1);
    }
  }

  console.log(`\nApplied ${count} migration(s).\n`);
} finally {
  await client.end();
}
