import os from "node:os";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";
import { readEnvVar, readEnvVarOptional } from "./tests/e2e/helpers/env";

// Where Playwright writes run artefacts. Keep this OFF a OneDrive-synced path:
// OneDrive locks files while syncing, so Playwright clearing its output dir
// in-place fails with EPERM. Each dev can set E2E_OUTPUT_DIR in .env to a
// local (non-synced) path; otherwise we default to the OS temp dir.
const outputDir = readEnvVarOptional("E2E_OUTPUT_DIR") ?? path.join(os.tmpdir(), "portal-e2e-results");

const baseURL = readEnvVar("NEXT_PUBLIC_APP_URL");

// -------------------------------------------------------------------
// Playwright config - end-to-end tests (critical auth flows)
// Playwright builds the app and serves it with `next start` (see webServer
// below), so there is no separate server to start first.
// -------------------------------------------------------------------
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // The "list" reporter prints one clean line per test - but only in its
  // non-animated mode. Its live mode repaints with cursor-move ANSI codes that
  // some Windows terminals mangle. Run the tests via `pnpm test:e2e`, which
  // sets PLAYWRIGHT_FORCE_TTY=0 to force the non-animated output everywhere.
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  // -----------------------------------------------------------------
  // Run E2E against a PRODUCTION build, not the dev server. `next build`
  // precompiles every route, so there is no slow on-demand compilation (and
  // no dev file-watcher recompiles from OneDrive syncing) to make navigations
  // flaky. Playwright builds, starts `next start`, waits for it to respond,
  // then shuts it down when the run finishes. `pnpm start` listens on the same
  // port as `pnpm dev`, so stop the dev server before running the suite.
  // -----------------------------------------------------------------
  webServer: {
    command: "pnpm build && pnpm start",
    url: baseURL,
    reuseExistingServer: false,
    // Generous: a cold `next build` (slower on the OneDrive path) plus start.
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
