// -------------------------------------------------------------------
// Runs the full test suite (Vitest unit + Playwright E2E) and prints a
// combined pass/fail summary at the end.
//
// Each runner also writes a JSON results file (to the OS temp dir) that we
// parse for exact counts - more reliable than scraping the console text.
// Both suites always run so the summary is complete; the overall exit code
// is non-zero if either suite had a failure.
// -------------------------------------------------------------------
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const unitResultsFile = path.join(os.tmpdir(), "portal-unit-results.json");
const e2eResultsFile = path.join(os.tmpdir(), "portal-e2e-results.json");

// Remove stale result files so a crashed run can't report old counts
for (const file of [unitResultsFile, e2eResultsFile]) {
  if (existsSync(file)) rmSync(file);
}

// -------------------------------------------------------------------
// Unit tests (Vitest) - normal console output + JSON for counts
// -------------------------------------------------------------------
const unit = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "--reporter=default", "--reporter=json", `--outputFile=${unitResultsFile}`],
  { stdio: "inherit", shell: true },
);

// -------------------------------------------------------------------
// E2E (Playwright), launched THROUGH run-e2e.mjs rather than by calling
// Playwright directly.
//
// That indirection is the point. run-e2e.mjs refuses to run against anything
// that is not a local, disposable database, and the suite creates and deletes
// users, teams and notifications in whatever .env points at. Spawning Playwright
// here would route around that check, so `pnpm test:all` would happily do to a
// real database what `pnpm test:e2e` is written to prevent.
//
// It also sets PLAYWRIGHT_FORCE_TTY=0 for us (plain append-only output, since
// the live cursor-repaint garbles some terminals) and forwards these arguments
// straight to Playwright.
// -------------------------------------------------------------------
const e2e = spawnSync("node", ["tests/run-e2e.mjs", "--reporter=list,json"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: e2eResultsFile },
});

// -------------------------------------------------------------------
// Parse counts
// -------------------------------------------------------------------
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const unitData = readJson(unitResultsFile);
const unitPassed = unitData?.numPassedTests ?? 0;
const unitTotal = unitData?.numTotalTests ?? 0;

const e2eStats = readJson(e2eResultsFile)?.stats;
const e2ePassed = e2eStats ? e2eStats.expected : 0;
const e2eTotal = e2eStats
  ? e2eStats.expected + e2eStats.unexpected + e2eStats.flaky + e2eStats.skipped
  : 0;

// -------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------
const unitOk = unit.status === 0;
const e2eOk = e2e.status === 0;
const label = (ok) => (ok ? "PASS" : "FAIL");
const separator = "=".repeat(44);

console.log("\n" + separator);
console.log("  Test summary");
console.log(separator);
console.log(`  Unit (Vitest):     ${unitPassed}/${unitTotal} passed   [${label(unitOk)}]`);
console.log(`  E2E  (Playwright): ${e2ePassed}/${e2eTotal} passed   [${label(e2eOk)}]`);
console.log(separator + "\n");

process.exit(unitOk && e2eOk ? 0 : 1);
