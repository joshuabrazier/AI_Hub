// -------------------------------------------------------------------
// Report which migrations a database has, and which it is missing.
//
// WHY THIS EXISTS. There is no migration runner in this repo on purpose -
// migrations are applied by hand, deliberately, so nobody can deploy a
// schema change by accident. The cost of that is having to remember, and
// forgetting has taken a page down in production more than once: the code
// ships expecting a table, the database does not have it, and the failure
// arrives as a generic "A server error occurred" with nothing on screen
// naming the missing table.
//
// This only READS. It applies nothing, so it is safe to point at
// production, and it is the thing to run before every deploy.
//
// Exits 1 when anything is pending, so it can gate a deploy step rather
// than just printing.
//
// Run:
//   pnpm db:check                                  (uses .env)
//   $env:DATABASE_URL = "..."; node scripts/check-migrations.mjs
// -------------------------------------------------------------------
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const migrationsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "lib",
  "data",
  "sql",
  "migrations",
);

const onDisk = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const { rows } = await client.query("SELECT filename FROM schema_migrations ORDER BY filename");
  const applied = new Set(rows.map((row) => row.filename));

  const pending = onDisk.filter((name) => !applied.has(name));

  // Recorded as applied but no longer in the repository. Usually means a
  // branch that has not been merged yet - somebody applied its migration to
  // the shared development database before the file existed here. Worth
  // knowing, because a fresh environment cannot be rebuilt from the repo
  // while it is true.
  const orphaned = [...applied].filter((name) => !onDisk.includes(name)).sort();

  // Two files claiming the same number. Both may well have run without
  // incident, but the order they would run in on a fresh database is now
  // undefined - which matters the moment two of them touch the same table.
  const byNumber = new Map();
  for (const name of onDisk) {
    const number = name.slice(0, name.indexOf("_"));
    byNumber.set(number, [...(byNumber.get(number) ?? []), name]);
  }
  const collisions = [...byNumber.values()].filter((names) => names.length > 1);

  for (const name of onDisk) {
    console.log(`${applied.has(name) ? "  applied " : "  PENDING "} ${name}`);
  }

  if (orphaned.length > 0) {
    console.log("");
    console.log("Applied but not in this repository (an unmerged branch, probably):");
    for (const name of orphaned) console.log(`  ${name}`);
  }

  if (collisions.length > 0) {
    console.log("");
    console.log("Duplicate migration numbers - the order on a fresh database is undefined:");
    for (const names of collisions) console.log(`  ${names.join("  ")}`);
  }

  console.log("");

  if (pending.length === 0) {
    console.log(`Up to date. ${onDisk.length} migration(s) applied.`);
  } else {
    console.log(`${pending.length} migration(s) NOT APPLIED to this database:`);
    for (const name of pending) console.log(`  src/lib/data/sql/migrations/${name}`);
    console.log("");
    console.log("Run these before deploying the code that expects them.");
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
