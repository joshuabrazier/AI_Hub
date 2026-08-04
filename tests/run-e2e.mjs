// -------------------------------------------------------------------
// E2E launcher
//
// Two jobs.
//
// 1. Refuse to run against anything that looks like a real environment. The
//    suite creates and deletes users, teams and notifications in whatever database
//    .env points at. Copying a production .env into this project to "get it
//    running" is an easy mistake and one that writes to live data, so the run
//    stops unless MODE is development or test AND the database host looks
//    local. Set E2E_ALLOW_REMOTE_DB=true to override deliberately.
//
// 2. Force Playwright's plain, append-only output. Its live reporters repaint
//    the terminal with cursor-move ANSI codes, which some terminals (notably
//    the Windows console host) mangle into garbled text. PLAYWRIGHT_FORCE_TTY=0
//    disables that live rendering. It must be set BEFORE Playwright starts,
//    since the value is read before playwright.config.ts is evaluated.
// -------------------------------------------------------------------
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

function readEnvFile() {
  try {
    const raw = readFileSync(path.resolve(process.cwd(), ".env"), "utf8");
    return Object.fromEntries(
      raw
        .split(/\r?\n/)
        .filter((line) => line && !line.trimStart().startsWith("#") && line.includes("="))
        .map((line) => {
          const at = line.indexOf("=");
          return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}

const env = readEnvFile();
const mode = env.MODE ?? process.env.MODE ?? "development";
const databaseUrl = env.DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const override = (env.E2E_ALLOW_REMOTE_DB ?? process.env.E2E_ALLOW_REMOTE_DB) === "true";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "host.docker.internal"];

function hostOf(url) {
  try {
    return url ? new URL(url).hostname : "unset";
  } catch {
    return "unparseable";
  }
}

if (!override) {
  const problems = [];
  if (mode === "production") problems.push(`MODE is "${mode}"`);
  if (!LOCAL_HOSTS.includes(hostOf(databaseUrl))) {
    problems.push(`DATABASE_URL host is "${hostOf(databaseUrl)}", which is not local`);
  }

  if (problems.length > 0) {
    console.error("\nRefusing to run the end-to-end suite.\n");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      "\nThese tests create and delete users, teams and notifications in whatever database\n" +
        ".env points at. Point DATABASE_URL at a local test database, or set\n" +
        "E2E_ALLOW_REMOTE_DB=true if you are certain this database is disposable.\n",
    );
    process.exit(1);
  }
}

process.env.PLAYWRIGHT_FORCE_TTY = "0";

const child = spawn("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => process.exit(code ?? 1));
